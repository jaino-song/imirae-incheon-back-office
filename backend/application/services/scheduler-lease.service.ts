import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";

import {
    ISchedulerLeaseRepository,
    SCHEDULER_LEASE_REPOSITORY,
    SchedulerLeaseAcquireOptions,
    SchedulerLeaseAcquireResult,
    SchedulerLeaseIdentity,
} from "domain/repositories/scheduler-lease.repository.interface";
import { resolveSchedulerModuleOptions } from "infrastructure/config/scheduler-config";
import {
    isTransientPrismaConnectivityError,
    summarizePrismaError,
} from "infrastructure/database/prisma-error.utils";

export const SCHEDULER_LEASE_NAME = "background-owner";
export const LEASE_TTL_SECONDS = 90;
export const LEASE_RENEW_INTERVAL_MS = 20_000;
/** Local "still held" window after the last successful renew. */
export const LEASE_HOLD_GRACE_MS = 60_000;
/**
 * Same-holder, different-instance takeover (a recreated container). MUST exceed
 * LEASE_HOLD_GRACE_MS: a stalled predecessor still answers holdsLease() true until the
 * grace lapses, so admitting its successor any earlier lets two processes of one host
 * both believe they own the lease. Kept under the TTL so a same-host restart still
 * beats waiting for expiry.
 */
export const LEASE_TAKEOVER_AFTER_SECONDS = 70;
/**
 * A single acquire/renew round trip that has not settled by now is treated as failed so
 * the renew loop never wedges on a black-holed connection. Strictly shorter than the
 * renew interval so the next tick always retries.
 */
export const LEASE_RENEW_TIMEOUT_MS = 15_000;
export const LEASE_STARTUP_TIMEOUT_MS = 5_000;
export const LEASE_SHUTDOWN_TIMEOUT_MS = 2_000;

const MAX_IDENTITY_LENGTH = 64;

export type SchedulerLeaseMode = "required" | "off" | "standby";

export interface SchedulerLeaseSnapshot {
    mode: SchedulerLeaseMode;
    holderId: string;
    instanceId: string;
    held: boolean;
    lastRenewOkAgoMs: number | null;
}

/**
 * Resolves the operating mode from already-normalised inputs. Pure and Nest-free so the
 * decision table can be unit tested directly, with no Logger dependency.
 *
 * Precedence:
 * 1. `schedulersEnabled === false` -> "standby". A passive host (`SCHEDULERS_ENABLED=false`)
 *    must NEVER acquire the lease no matter what `SCHEDULER_LEASE_MODE` says, otherwise it
 *    steals the lease from the active host and nobody runs schedulers.
 * 2. `SCHEDULER_LEASE_MODE` is exactly "required" or "off" (case-insensitive, trimmed) -> that
 *    mode.
 * 3. Anything else (unset, empty-after-trim, or an invalid non-empty value) -> "required" in
 *    production, "off" otherwise. Logging an invalid non-empty value is the caller's
 *    responsibility (the service constructor), since this function has no Logger.
 */
export function resolveSchedulerLeaseMode(input: {
    leaseMode?: string;
    nodeEnv?: string;
    schedulersEnabled: boolean;
}): SchedulerLeaseMode {
    if (!input.schedulersEnabled) {
        return "standby";
    }

    const normalizedMode = input.leaseMode?.trim().toLowerCase();
    if (normalizedMode === "required" || normalizedMode === "off") {
        return normalizedMode;
    }

    const normalizedNodeEnv = input.nodeEnv?.trim().toLowerCase();
    return normalizedNodeEnv === "production" ? "required" : "off";
}

type AwaitOutcome<T> =
    | { outcome: "resolved"; value: T }
    | { outcome: "rejected"; error: unknown }
    | { outcome: "timeout" };

/**
 * Process-wide answer to "am I the host that runs background schedulers right now?".
 *
 * Two backend hosts (AWS Lightsail and the LightNode fallback) may both run against one
 * Postgres; exactly one may hold the `background-owner` lease at a time. Callers (the 17
 * `@Cron`/`@Interval` entry points, and `/health/lease`) gate on `holdsLease()`.
 */
@Injectable()
export class SchedulerLeaseService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(SchedulerLeaseService.name);

    readonly mode: SchedulerLeaseMode;
    readonly holderId: string;
    readonly instanceId: string;

    private held = false;
    private stopped = false;
    private lastRenewOkAt: number | null = null;
    private renewTimer: NodeJS.Timeout | null = null;
    private renewInFlight: Promise<void> | null = null;

    constructor(
        @Inject(SCHEDULER_LEASE_REPOSITORY) private readonly repository: ISchedulerLeaseRepository,
        private readonly configService: ConfigService,
        @Optional() schedulersEnabled: boolean = resolveSchedulerModuleOptions(process.env).cronJobs ?? true,
    ) {
        const leaseModeRaw = this.configService.get<string>("SCHEDULER_LEASE_MODE")?.trim().toLowerCase();
        const nodeEnv = this.configService.get<string>("NODE_ENV")?.trim().toLowerCase();

        this.mode = resolveSchedulerLeaseMode({ leaseMode: leaseModeRaw, nodeEnv, schedulersEnabled });

        if (schedulersEnabled && leaseModeRaw && leaseModeRaw !== "required" && leaseModeRaw !== "off") {
            this.logger.error(
                `Invalid SCHEDULER_LEASE_MODE="${leaseModeRaw}"; falling back to nodeEnv default ("${this.mode}")`,
            );
        }

        const holderIdRaw = this.configService.get<string>("SCHEDULER_LEASE_HOLDER_ID")?.trim();
        this.holderId = (holderIdRaw && holderIdRaw.length > 0 ? holderIdRaw : hostname()).slice(
            0,
            MAX_IDENTITY_LENGTH,
        );
        this.instanceId = randomUUID().slice(0, MAX_IDENTITY_LENGTH);
    }

    async onModuleInit(): Promise<void> {
        this.logger.log(
            `Scheduler lease service starting: mode=${this.mode} holderId=${this.holderId} instanceId=${this.instanceId}`,
        );

        // @nestjs/schedule mounts crons in onApplicationBootstrap, which runs after every
        // module's onModuleInit, so the first tick sees a settled answer. In "off" and
        // "standby" this must NEVER call the repository or create a timer: a dev/preview host
        // in "off" mode pointed at the shared DB must not be able to evict production, and a
        // passive host in "standby" must never acquire the lease at all.
        if (this.mode !== "required") {
            return;
        }

        await this.attemptStartupAcquire();

        // onModuleDestroy may have run while the startup acquire was in flight (a SIGTERM
        // during boot); creating the interval now would leave a renewer nothing can stop.
        if (this.stopped) {
            return;
        }

        const timer = setInterval(() => {
            void this.startRenew();
        }, LEASE_RENEW_INTERVAL_MS);
        timer.unref();
        this.renewTimer = timer;
    }

    async onModuleDestroy(): Promise<void> {
        // The raw flag, not holdsLease() — grace may have lapsed while the DB row still names
        // this instance, and releasing it early helps the other host take over sooner.
        const wasHeld = this.held;
        this.stopped = true;

        if (this.renewTimer) {
            clearInterval(this.renewTimer);
            this.renewTimer = null;
        }

        this.held = false;

        // A slow renew that commits after release would re-extend the row by 90s for a dead
        // process. Bound the wait; if it settles after we've moved on, handleAcquireResult's
        // stopped-guard releases whatever it acquired.
        await this.waitForInFlightRenew();

        if (wasHeld) {
            // SchedulerLeaseModule sits directly after DatabaseModule in app.module.ts, so
            // Nest's reverse-order destroy runs this before PrismaService.$disconnect() and the
            // release normally succeeds.
            await this.releaseOnShutdown();
        }
    }

    holdsLease(): boolean {
        if (this.mode === "off") {
            return true;
        }
        if (this.mode === "standby") {
            return false;
        }
        return (
            this.held &&
            this.lastRenewOkAt !== null &&
            performance.now() - this.lastRenewOkAt < LEASE_HOLD_GRACE_MS
        );
    }

    snapshot(): SchedulerLeaseSnapshot {
        return {
            mode: this.mode,
            holderId: this.holderId,
            instanceId: this.instanceId,
            held: this.holdsLease(),
            lastRenewOkAgoMs: this.lastRenewOkAt === null ? null : performance.now() - this.lastRenewOkAt,
        };
    }

    private async attemptStartupAcquire(): Promise<void> {
        const renewPromise = this.startRenew();
        const result = await this.awaitWithTimeout(renewPromise, LEASE_STARTUP_TIMEOUT_MS);

        if (result.outcome === "timeout") {
            this.logger.warn(
                `Scheduler lease startup acquire did not complete within ${LEASE_STARTUP_TIMEOUT_MS}ms: name=${SCHEDULER_LEASE_NAME} holderId=${this.holderId} instanceId=${this.instanceId}`,
            );
        } else if (result.outcome === "rejected") {
            // startRenew()'s returned promise is designed to never reject (both branches of
            // acquireOrRenew() are handled internally by handleAcquireResult/handleRenewError);
            // guarded here only so boot can never fail because of the lease.
            this.logger.warn(
                `Scheduler lease startup acquire failed unexpectedly: ${summarizePrismaError(result.error)}`,
            );
        }
    }

    private async waitForInFlightRenew(): Promise<void> {
        if (!this.renewInFlight) {
            return;
        }
        await this.awaitWithTimeout(this.renewInFlight, LEASE_SHUTDOWN_TIMEOUT_MS);
    }

    private async releaseOnShutdown(): Promise<void> {
        const identity: SchedulerLeaseIdentity = { holderId: this.holderId, instanceId: this.instanceId };
        const releasePromise = this.repository.release(SCHEDULER_LEASE_NAME, identity);
        // Attach before racing against the shutdown timeout so a late rejection is never
        // unhandled.
        releasePromise.catch(() => {});

        const result = await this.awaitWithTimeout(releasePromise, LEASE_SHUTDOWN_TIMEOUT_MS);

        if (result.outcome === "timeout") {
            this.logger.warn(
                `Scheduler lease release timed out after ${LEASE_SHUTDOWN_TIMEOUT_MS}ms: name=${SCHEDULER_LEASE_NAME} holderId=${this.holderId} instanceId=${this.instanceId}`,
            );
        } else if (result.outcome === "rejected") {
            this.logger.warn(
                `Scheduler lease release failed: name=${SCHEDULER_LEASE_NAME} holderId=${this.holderId} instanceId=${this.instanceId} ${summarizePrismaError(result.error)}`,
            );
        }
    }

    /**
     * Acquires or renews the lease, skipping (returning the existing in-flight promise) if a
     * previous call has not settled yet. Never rejects: both the success and failure paths of
     * the repository call are handled internally so callers (the renew interval, and the
     * startup acquire above) never need their own try/catch.
     */
    private startRenew(): Promise<void> {
        if (this.renewInFlight) {
            return this.renewInFlight;
        }

        const options: SchedulerLeaseAcquireOptions = {
            name: SCHEDULER_LEASE_NAME,
            holderId: this.holderId,
            instanceId: this.instanceId,
            ttlSeconds: LEASE_TTL_SECONDS,
            takeoverAfterSeconds: LEASE_TAKEOVER_AFTER_SECONDS,
        };

        const repoPromise = this.repository.acquireOrRenew(options);
        // Attach before racing anything against a timeout downstream (attemptStartupAcquire),
        // so a rejection that arrives after a caller has already given up waiting is never
        // unhandled.
        repoPromise.catch(() => {});

        const tracked: Promise<void> = this.awaitWithTimeout(repoPromise, LEASE_RENEW_TIMEOUT_MS).then(
            (outcome) => {
                if (outcome.outcome === "resolved") {
                    this.handleAcquireResult(outcome.value);
                } else if (outcome.outcome === "rejected") {
                    this.handleRenewError(outcome.error);
                } else {
                    this.handleRenewTimeout(repoPromise);
                }
            },
        );

        // `.finally()` returns a *new* promise distinct from `tracked`, so the field must be
        // compared/cleared against this local `inFlight` binding (the one actually stored),
        // never against `tracked` itself — otherwise the identity check below never matches and
        // renewInFlight is never cleared, permanently blocking every later renew.
        const inFlight: Promise<void> = tracked.finally(() => {
            if (this.renewInFlight === inFlight) {
                this.renewInFlight = null;
            }
        });
        this.renewInFlight = inFlight;

        return inFlight;
    }

    private handleAcquireResult(result: SchedulerLeaseAcquireResult): void {
        // A renew that settles after onModuleDestroy has already run must not resurrect held
        // or lastRenewOkAt for a process that is shutting down — and if it acquired, the row
        // now names a dead process for a full TTL, so give it back.
        if (this.stopped) {
            if (result.acquired) {
                this.releaseLateAcquire();
            }
            return;
        }

        if (result.acquired) {
            const wasHeld = this.held;
            this.lastRenewOkAt = performance.now();
            this.held = true;
            if (!wasHeld) {
                this.logger.log(
                    `Scheduler lease acquired: name=${SCHEDULER_LEASE_NAME} holderId=${this.holderId} instanceId=${this.instanceId} expiresAt=${result.expiresAt?.toISOString() ?? "unknown"} dbNow=${result.dbNow?.toISOString() ?? "unknown"}`,
                );
            }
            return;
        }

        // Another holder owns a live lease: drop held immediately, do not wait for the grace
        // window to lapse.
        const wasHeld = this.held;
        this.held = false;
        if (wasHeld) {
            this.logger.warn(
                `Scheduler lease lost: name=${SCHEDULER_LEASE_NAME} holderId=${this.holderId} instanceId=${this.instanceId}`,
            );
            this.logCurrentHolder();
        }
    }

    private handleRenewError(error: unknown): void {
        if (this.stopped) {
            return;
        }

        const message = `Scheduler lease renew failed: name=${SCHEDULER_LEASE_NAME} holderId=${this.holderId} instanceId=${this.instanceId} ${summarizePrismaError(error)}`;
        if (isTransientPrismaConnectivityError(error)) {
            this.logger.warn(message);
        } else {
            this.logger.error(message);
        }
        // `held` is intentionally left untouched here: holdsLease() falls back to false on its
        // own once the grace window since the last successful renew elapses, so two consecutive
        // failed renews are tolerated and the third is not.
    }

    /**
     * The round trip did not settle in time: treat it like a failed renew (held is left to
     * the grace window) and stop tracking it so the next tick retries. A result that
     * arrives later is stale and ignored — except that an acquire landing after shutdown
     * must be released, exactly as in handleAcquireResult.
     */
    private handleRenewTimeout(abandoned: Promise<SchedulerLeaseAcquireResult>): void {
        abandoned
            .then((result) => {
                if (result.acquired && this.stopped) {
                    this.releaseLateAcquire();
                }
            })
            .catch(() => {});

        if (this.stopped) {
            return;
        }
        this.logger.warn(
            `Scheduler lease renew did not settle within ${LEASE_RENEW_TIMEOUT_MS}ms; treating as failed: name=${SCHEDULER_LEASE_NAME} holderId=${this.holderId} instanceId=${this.instanceId}`,
        );
    }

    private releaseLateAcquire(): void {
        const identity: SchedulerLeaseIdentity = { holderId: this.holderId, instanceId: this.instanceId };
        this.logger.warn(
            `Scheduler lease acquired after shutdown began; releasing: name=${SCHEDULER_LEASE_NAME} holderId=${this.holderId} instanceId=${this.instanceId}`,
        );
        this.repository.release(SCHEDULER_LEASE_NAME, identity).catch(() => {});
    }

    private logCurrentHolder(): void {
        this.repository
            .read(SCHEDULER_LEASE_NAME)
            .then((record) => {
                if (record) {
                    this.logger.warn(
                        `Scheduler lease now held by holderId=${record.holderId} instanceId=${record.instanceId}`,
                    );
                }
            })
            .catch(() => {});
    }

    private awaitWithTimeout<T>(promise: Promise<T>, ms: number): Promise<AwaitOutcome<T>> {
        return new Promise((resolve) => {
            let settled = false;
            const timer = setTimeout(() => {
                if (!settled) {
                    settled = true;
                    resolve({ outcome: "timeout" });
                }
            }, ms);

            promise.then(
                (value) => {
                    if (!settled) {
                        settled = true;
                        clearTimeout(timer);
                        resolve({ outcome: "resolved", value });
                    }
                },
                (error) => {
                    if (!settled) {
                        settled = true;
                        clearTimeout(timer);
                        resolve({ outcome: "rejected", error });
                    }
                },
            );
        });
    }
}
