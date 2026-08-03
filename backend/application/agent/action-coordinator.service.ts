import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { Cron, CronExpression } from "@nestjs/schedule";

import type { AgentActionRisk, AgentActionStatus } from "@babyjamjam/shared";
import type { BjjUIMessage } from "@babyjamjam/shared";
import type { AgentActionEntity, AgentActionOwner } from "domain/entities/agent-action.entity";
import type { VerifiedTenantPrincipal } from "infrastructure/tenant/tenant.context";
import { PrismaService } from "infrastructure/database/prisma.service";
import { CapabilityRegistryService } from "./capability-registry.service";
import { AgentFlagsService } from "./agent-flags.service";
import { AgentActionSweepLockService } from "infrastructure/locking/agent-action-sweep-lock.service";
import { AgentSessionService } from "./agent-session.service";
import type { AgentReconciliationOutcome } from "./capability.types";

const APPROVAL_PENDING_STATUSES: AgentActionStatus[] = ["proposed", "approved"];
const TERMINAL_STATUSES: AgentActionStatus[] = ["succeeded", "failed", "uncertain", "rejected", "expired", "cancelled"];
const DEDUPE_RESERVED_STATUSES: AgentActionStatus[] = ["executing", "uncertain"];
const DEFAULT_ACTION_TTL_MS = 15 * 60 * 1000;
const REQUEST_DEDUPE_WINDOW_MS = 15 * 60 * 1000;
const EXECUTION_STALE_AFTER_MS = 30 * 60 * 1000;

export class AgentActionUncertainError extends Error {
    constructor(message: string, readonly details?: Record<string, unknown>) {
        super(message);
        this.name = AgentActionUncertainError.name;
    }
}

/** Use only when a capability can prove that no mutation or provider call began. */
export class AgentActionCertainFailureError extends Error {
    constructor(message: string) {
        super(message);
        this.name = AgentActionCertainFailureError.name;
    }
}

export interface AgentActionProposalInput {
    sessionId: string;
    principal: VerifiedTenantPrincipal;
    capability: string;
    input: unknown;
    locale: string;
    traceId?: string;
    title?: string;
    summary?: string;
    targetSnapshot?: Record<string, unknown>;
    targetVersion?: string;
    expiresAt?: Date;
}

export interface AgentActionExecutionResult {
    action: AgentActionEntity;
    result: unknown;
}

type ActionRecord = Prisma.agent_actionGetPayload<Prisma.agent_actionDefaultArgs>;

function stableJson(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
    if (value && typeof value === "object") {
        return `{${Object.entries(value as Record<string, unknown>)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`)
            .join(",")}}`;
    }
    return JSON.stringify(value) ?? "null";
}

function jsonObject(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return value as Record<string, unknown>;
}

function uncertaintyDetails(value: unknown): Record<string, unknown> | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const source = value as Record<string, unknown>;
    const allowed = ["remoteDocumentId", "providerRequestId", "providerCode", "status", "jobId", "notificationId"];
    const details = Object.fromEntries(allowed
        .filter((key) => typeof source[key] === "string" || typeof source[key] === "number")
        .map((key) => [key, source[key]]));
    return Object.keys(details).length > 0 ? details : undefined;
}

function toEntity(record: ActionRecord): AgentActionEntity {
    return {
        id: record.id,
        sessionId: record.sessionId,
        userId: record.userId,
        branchId: record.branchId,
        capability: record.capability,
        capabilityVersion: record.capabilityVersion,
        risk: record.risk as AgentActionRisk,
        status: record.status as AgentActionStatus,
        proposal: jsonObject(record.proposal),
        proposalRevision: record.proposalRevision,
        inputHash: record.inputHash,
        targetSnapshot: record.targetSnapshot ? jsonObject(record.targetSnapshot) : null,
        targetVersion: record.targetVersion,
        authorizationContext: jsonObject(record.authorizationContext),
        approvedBy: record.approvedBy,
        approvedAt: record.approvedAt,
        rejectedBy: record.rejectedBy,
        rejectedAt: record.rejectedAt,
        expiresAt: record.expiresAt,
        idempotencyKey: record.idempotencyKey,
        requestDedupeKey: record.requestDedupeKey,
        dedupeExpiresAt: record.dedupeExpiresAt,
        result: record.result,
        error: record.error ? jsonObject(record.error) : null,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        executedAt: record.executedAt,
        executionAttemptCount: record.executionAttemptCount,
        resultPartPersistedAt: record.resultPartPersistedAt,
    };
}

@Injectable()
export class ActionCoordinatorService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly registry: CapabilityRegistryService,
        private readonly flags: AgentFlagsService,
        private readonly sweepLock: AgentActionSweepLockService,
        private readonly sessions: AgentSessionService,
    ) {}

    async propose(input: AgentActionProposalInput): Promise<AgentActionEntity> {
        const capability = this.registry.get(input.capability);
        if (capability.meta.risk === "read" || !capability.meta.sideEffect) {
            throw new BadRequestException("Read capabilities cannot create actions");
        }
        if (!await this.flags.isCapabilityEnabled(capability.meta, input.principal)) {
            throw new ForbiddenException("Capability disabled");
        }
        const parsedInput = capability.inputSchema.parse(input.input);
        const inputHash = createHash("sha256").update(stableJson(parsedInput)).digest("hex");
        const now = new Date();
        const expiresAt = input.expiresAt ?? new Date(now.getTime() + DEFAULT_ACTION_TTL_MS);
        const requestDedupeKey = createHash("sha256")
            .update(`${input.sessionId}:${input.principal.userId}:${input.principal.branchId}:${input.capability}:${inputHash}`)
            .digest("hex");
        const existing = await this.prisma.agent_action.findUnique({ where: { requestDedupeKey } });
        if (existing?.dedupeExpiresAt && existing.dedupeExpiresAt.getTime() > now.getTime()) return toEntity(existing);
        if (existing) {
            if (DEDUPE_RESERVED_STATUSES.includes(existing.status as AgentActionStatus)) {
                return toEntity(existing);
            }
            // Free the stable fingerprint only after its window expires. The
            // compare-and-swap plus unique index closes concurrent boundary races.
            await this.prisma.agent_action.updateMany({
                where: { id: existing.id, status: existing.status, requestDedupeKey, dedupeExpiresAt: { lte: now } },
                data: {
                    requestDedupeKey: createHash("sha256")
                        .update(`expired:${requestDedupeKey}:${existing.id}:${randomUUID()}`)
                        .digest("hex"),
                },
            });
        }

        const actionId = randomUUID();
        const idempotencyKey = `agent-action:${actionId}`;
        const dedupeExpiresAt = new Date(now.getTime() + REQUEST_DEDUPE_WINDOW_MS);
        const inspection = capability.inspect
            ? await capability.inspect({
                principal: input.principal,
                sessionId: input.sessionId,
                traceId: input.traceId ?? randomUUID(),
                locale: input.locale,
            }, parsedInput)
            : undefined;
        const parsedTargetVersion = inspection?.targetVersion ?? input.targetVersion;
        const targetSnapshot = input.targetSnapshot ?? inspection?.targetSnapshot;
        const proposal = {
            capability: input.capability,
            title: inspection?.title ?? input.title ?? capability.meta.description,
            summary: inspection?.summary ?? input.summary ?? capability.meta.description,
            input: parsedInput,
            targetSnapshot: targetSnapshot ?? null,
            targetVersion: parsedTargetVersion ?? null,
            provider: inspection?.provider ?? null,
            estimatedCost: inspection?.estimatedCost ?? null,
            locale: input.locale,
        };
        const proposalRevision = createHash("sha256").update(stableJson({
            capability: input.capability,
            capabilityVersion: capability.meta.version,
            risk: capability.meta.risk,
            proposal,
        })).digest("hex");
        const authorizationContext = {
            userId: input.principal.userId,
            branchId: input.principal.branchId,
            globalRole: input.principal.globalRole,
            branchRole: input.principal.branchRole,
            traceId: input.traceId ?? null,
        };
        try {
            const record = await this.prisma.agent_action.create({
                data: {
                    id: actionId,
                    sessionId: input.sessionId,
                    userId: input.principal.userId,
                    branchId: input.principal.branchId,
                    capability: input.capability,
                    capabilityVersion: capability.meta.version,
                    risk: capability.meta.risk,
                    status: "proposed",
                    proposal: proposal as Prisma.InputJsonValue,
                    proposalRevision,
                    inputHash,
                    targetSnapshot: targetSnapshot as Prisma.InputJsonValue | undefined,
                    targetVersion: parsedTargetVersion,
                    authorizationContext: authorizationContext as Prisma.InputJsonValue,
                    expiresAt,
                    idempotencyKey,
                    requestDedupeKey,
                    dedupeExpiresAt,
                },
            });
            return toEntity(record);
        } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
                const raced = await this.prisma.agent_action.findUnique({ where: { requestDedupeKey } });
                if (raced) return toEntity(raced);
            }
            throw error;
        }
    }

    async get(id: string, owner: AgentActionOwner): Promise<AgentActionEntity> {
        const record = await this.prisma.agent_action.findFirst({ where: { id, ...owner } });
        if (!record) throw new NotFoundException("Agent action not found");
        return toEntity(record);
    }

    async list(owner: AgentActionOwner, statuses?: AgentActionStatus[]): Promise<AgentActionEntity[]> {
        const recordStatuses = statuses?.length ? statuses : undefined;
        const records = await this.prisma.agent_action.findMany({
            where: { ...owner, ...(recordStatuses ? { status: { in: recordStatuses } } : {}) },
            orderBy: { createdAt: "desc" },
        });
        return records.map(toEntity);
    }

    async approve(
        id: string,
        principal: VerifiedTenantPrincipal,
        expectedRevision: string,
        acknowledgementToken?: string,
    ): Promise<AgentActionExecutionResult> {
        const owner = { userId: principal.userId, branchId: principal.branchId };
        const action = await this.get(id, owner);
        if (TERMINAL_STATUSES.includes(action.status)) {
            await this.persistResultPart(action.id, action, action.status as Parameters<ActionCoordinatorService["persistResultPart"]>[2]);
            return { action, result: action.result };
        }
        if (!["proposed", "approved"].includes(action.status)) throw new ConflictException("Action is no longer pending approval");
        if (action.expiresAt.getTime() <= Date.now()) {
            await this.expire(id, owner);
            throw new ConflictException("Action has expired");
        }
        const capability = this.registry.get(action.capability);
        if (expectedRevision !== action.proposalRevision) {
            throw new ConflictException("Action proposal changed; review the latest proposal");
        }
        if (capability.meta.version !== action.capabilityVersion) {
            throw new ConflictException("Capability changed; create and review a new proposal");
        }
        if (capability.meta.approvalPolicy === "strong"
            && acknowledgementToken !== this.strongAcknowledgementToken(action)) {
            throw new ConflictException("Strong acknowledgement is required for this action");
        }
        if (!await this.flags.isCapabilityEnabled(capability.meta, principal)) {
            throw new ForbiddenException("Capability disabled");
        }
        const proposal = jsonObject(action.proposal);
        const actionContext = {
            principal,
            sessionId: action.sessionId,
            actionId: action.id,
            traceId: typeof action.authorizationContext["traceId"] === "string"
                ? action.authorizationContext["traceId"]
                : randomUUID(),
            locale: typeof proposal["locale"] === "string" ? proposal["locale"] : "ko",
            ...(action.targetVersion ? { approvedTargetVersion: action.targetVersion } : {}),
            ...(action.targetSnapshot ? { approvedTargetSnapshot: action.targetSnapshot } : {}),
        };
        if (action.targetVersion) {
            if (!capability.revalidate) {
                throw new ConflictException("Target cannot be safely revalidated; create a new proposal");
            }
            const revalidation = await capability.revalidate(actionContext, proposal["input"], action.targetVersion);
            if (!revalidation.valid || (revalidation.currentVersion && revalidation.currentVersion !== action.targetVersion)) {
                throw new ConflictException(revalidation.reason ?? "Action target changed; review a new proposal");
            }
        }
        if (action.status === "proposed") {
            const approved = await this.prisma.agent_action.updateMany({
                where: { id, ...owner, status: "proposed", expiresAt: { gt: new Date() } },
                data: { status: "approved", approvedBy: principal.userId, approvedAt: new Date() },
            });
            if (approved.count !== 1) {
                const latest = await this.get(id, owner);
                if (TERMINAL_STATUSES.includes(latest.status)) return { action: latest, result: latest.result };
                throw new ConflictException("Action was approved by another request");
            }
        }
        const claimed = await this.prisma.agent_action.updateMany({
            where: { id, ...owner, status: "approved", approvedBy: principal.userId, expiresAt: { gt: new Date() } },
            data: { status: "executing", executionAttemptCount: { increment: 1 } },
        });
        if (claimed.count !== 1) {
            const latest = await this.get(id, owner);
            if (TERMINAL_STATUSES.includes(latest.status)) return { action: latest, result: latest.result };
            throw new ConflictException("Action was approved by another request");
        }

        let providerResult: unknown;
        try {
            providerResult = await capability.execute(actionContext, proposal["input"]);
        } catch (error) {
            const uncertain = !(error instanceof AgentActionCertainFailureError);
            const errorPayload = {
                code: uncertain ? "provider_uncertain" : "execution_failed",
                message: "Action execution did not complete",
                ...(error instanceof AgentActionUncertainError && uncertaintyDetails(error.details)
                    ? { details: uncertaintyDetails(error.details) }
                    : {}),
            };
            const updated = await this.transitionExecuting(id, owner, {
                    status: uncertain ? "uncertain" : "failed",
                    error: errorPayload as Prisma.InputJsonValue,
                    executedAt: new Date(),
            });
            if (!updated) {
                const latest = await this.get(id, owner);
                return { action: latest, result: latest.result };
            }
            await this.persistResultPart(updated.id, updated, uncertain ? "uncertain" : "failed");
            if (uncertain) return { action: updated, result: undefined };
            throw new ConflictException("Action execution failed");
        }

        const parsed = capability.outputSchema.safeParse(providerResult);
        if (!parsed.success) {
            const updated = await this.transitionExecuting(id, owner, {
                    status: "uncertain",
                    error: {
                        code: "result_validation_failed",
                        message: "Provider returned an invalid result after execution; reconcile before retrying",
                    },
                    executedAt: new Date(),
            });
            if (!updated) {
                const latest = await this.get(id, owner);
                return { action: latest, result: latest.result };
            }
            await this.persistResultPart(updated.id, updated, "uncertain");
            return { action: updated, result: undefined };
        }

        let outcome;
        try {
            outcome = capability.classifyOutcome?.(parsed.data) ?? { status: "succeeded" as const };
        } catch {
            const updated = await this.transitionExecuting(id, owner, {
                    status: "uncertain",
                    error: {
                        code: "result_classification_failed",
                        message: "Execution returned but its outcome could not be classified; reconcile before retrying",
                    },
                    executedAt: new Date(),
            });
            if (!updated) {
                const latest = await this.get(id, owner);
                return { action: latest, result: latest.result };
            }
            await this.persistResultPart(updated.id, updated, "uncertain");
            return { action: updated, result: undefined };
        }
        const terminalStatus = outcome.status;
        let entity: AgentActionEntity | null;
        try {
            entity = await this.transitionExecuting(id, owner, {
                    status: terminalStatus,
                    result: parsed.data as Prisma.InputJsonValue,
                    error: terminalStatus === "succeeded"
                        ? Prisma.JsonNull
                        : {
                            code: terminalStatus === "cancelled" ? "provider_cancelled" : "provider_reported_failure",
                            message: outcome.reason ?? "Provider reported that the action did not succeed",
                        },
                    executedAt: new Date(),
            });
        } catch {
            // The provider already returned after it may have committed a side effect.
            // Never rewrite that outcome as a certain failure.
            try {
                await this.prisma.agent_action.updateMany({
                    where: { id, ...owner, status: "executing" },
                    data: {
                        status: "uncertain",
                        error: {
                            code: "terminal_state_persistence_failed",
                            message: "Execution completed but its terminal state could not be recorded; reconcile before retrying",
                        },
                        executedAt: new Date(),
                    },
                });
            } catch {
                // The expiry sweep will move a stranded executing row to uncertain.
            }
            throw new ConflictException("Action outcome is uncertain; do not retry execution");
        }

        if (!entity) {
            const latest = await this.get(id, owner);
            return { action: latest, result: latest.result };
        }
        await this.persistResultPart(entity.id, entity, terminalStatus);
        if (terminalStatus === "failed") throw new ConflictException("Action execution failed");
        return { action: entity, result: parsed.data };
    }

    private async transitionExecuting(
        id: string,
        owner: AgentActionOwner,
        data: Prisma.agent_actionUpdateManyMutationInput,
    ): Promise<AgentActionEntity | null> {
        const updated = await this.prisma.agent_action.updateMany({
            where: { id, ...owner, status: "executing" },
            data,
        });
        return updated.count === 1 ? this.get(id, owner) : null;
    }

    async reject(id: string, principal: VerifiedTenantPrincipal, reason?: string): Promise<AgentActionEntity> {
        const owner = { userId: principal.userId, branchId: principal.branchId };
        const updated = await this.prisma.agent_action.updateMany({
            where: { id, ...owner, status: "proposed" },
            data: {
                status: "rejected",
                rejectedBy: principal.userId,
                rejectedAt: new Date(),
                error: reason ? ({ code: "rejected", message: reason } as Prisma.InputJsonValue) : undefined,
            },
        });
        if (updated.count !== 1) {
            const current = await this.get(id, owner);
            if (current.status === "rejected") return current;
            throw new ConflictException("Action is no longer pending approval");
        }
        const rejected = await this.get(id, owner);
        await this.persistResultPart(rejected.id, rejected, "rejected");
        return rejected;
    }

    /** Request a trusted, read-only provider status lookup. */
    async reconcile(id: string, principal: VerifiedTenantPrincipal): Promise<AgentActionEntity> {
        const owner = { userId: principal.userId, branchId: principal.branchId };
        const action = await this.get(id, owner);
        if (action.status !== "uncertain") {
            if (action.status === "succeeded" || action.status === "failed") return action;
            throw new ConflictException("Only uncertain actions can be reconciled");
        }
        const capability = this.registry.get(action.capability);
        if (!capability.reconcile) throw new ConflictException("Provider reconciliation is unavailable");
        const proposal = jsonObject(action.proposal);
        const actionContext = {
            principal,
            sessionId: action.sessionId,
            actionId: action.id,
            traceId: typeof action.authorizationContext["traceId"] === "string"
                ? action.authorizationContext["traceId"]
                : randomUUID(),
            locale: typeof proposal["locale"] === "string" ? proposal["locale"] : "ko",
        };
        const uncertainty = action.error ? jsonObject(action.error["details"]) : null;
        await capability.recover?.(actionContext, proposal["input"], uncertainty);
        const outcome = await capability.reconcile(actionContext, proposal["input"], uncertainty);
        if (outcome.status === "uncertain") return action;
        return this.applyReconciliationOutcome(action, capability, outcome);
    }

    private async applyReconciliationOutcome(
        action: AgentActionEntity,
        capability: ReturnType<CapabilityRegistryService["get"]>,
        outcome: AgentReconciliationOutcome & { status: "succeeded" | "failed" },
    ): Promise<AgentActionEntity> {
        const owner = { userId: action.userId, branchId: action.branchId };
        const parsedResult = outcome.result === undefined
            ? undefined
            : capability.outputSchema.safeParse(outcome.result);
        if (parsedResult && !parsedResult.success) {
            throw new ConflictException("Provider reconciliation result was invalid; action remains uncertain");
        }
        const result = parsedResult?.success ? parsedResult.data : undefined;
        const updated = await this.prisma.agent_action.updateMany({
            where: { id: action.id, ...owner, status: "uncertain" },
            data: {
                status: outcome.status,
                ...(result === undefined ? {} : { result: result as Prisma.InputJsonValue }),
                ...(outcome.status === "failed"
                    ? { error: { code: "provider_reconciled_failed", message: outcome.reason ?? "Provider reported failure" } as Prisma.InputJsonValue }
                    : { error: Prisma.JsonNull }),
                executedAt: new Date(),
                resultPartPersistedAt: null,
            },
        });
        if (updated.count !== 1) {
            const latest = await this.get(action.id, owner);
            if (TERMINAL_STATUSES.includes(latest.status)) {
                await this.persistResultPart(
                    latest.id,
                    latest,
                    latest.status as Parameters<ActionCoordinatorService["persistResultPart"]>[2],
                );
            }
            return latest;
        }
        const reconciled = await this.get(action.id, owner);
        await this.persistResultPart(reconciled.id, reconciled, outcome.status);
        return reconciled;
    }

    async expire(id: string, owner: AgentActionOwner): Promise<boolean> {
        const updated = await this.prisma.agent_action.updateMany({
            where: { id, ...owner, status: { in: APPROVAL_PENDING_STATUSES }, expiresAt: { lte: new Date() } },
            data: { status: "expired" },
        });
        if (updated.count !== 1) return false;
        const expired = await this.get(id, owner);
        await this.persistResultPart(expired.id, expired, "expired");
        return true;
    }

    async expirePending(now = new Date()): Promise<number> {
        const candidates = await this.prisma.agent_action.findMany({
            where: { status: { in: APPROVAL_PENDING_STATUSES }, expiresAt: { lte: now } },
            orderBy: { expiresAt: "asc" },
            take: 100,
        });
        let expiredCount = 0;
        for (const candidate of candidates) {
            const owner = { userId: candidate.userId, branchId: candidate.branchId };
            const updated = await this.prisma.agent_action.updateMany({
                where: { id: candidate.id, ...owner, status: { in: APPROVAL_PENDING_STATUSES }, expiresAt: { lte: now } },
                data: { status: "expired" },
            });
            if (updated.count !== 1) continue;
            const expired = await this.get(candidate.id, owner);
            await this.persistResultPart(expired.id, expired, "expired");
            expiredCount += 1;
        }
        const executionCutoff = new Date(now.getTime() - EXECUTION_STALE_AFTER_MS);
        const interrupted = await this.prisma.agent_action.findMany({
            where: { status: "executing", updatedAt: { lte: executionCutoff } },
            orderBy: { updatedAt: "asc" },
            take: 100,
        });
        for (const candidate of interrupted) {
            const owner = { userId: candidate.userId, branchId: candidate.branchId };
            const updated = await this.prisma.agent_action.updateMany({
                where: { id: candidate.id, ...owner, status: "executing", updatedAt: { lte: executionCutoff } },
                data: {
                    status: "uncertain",
                    error: { code: "execution_interrupted", message: "Execution was interrupted; reconcile before retrying" },
                },
            });
            if (updated.count !== 1) continue;
            const uncertain = await this.get(candidate.id, owner);
            await this.persistResultPart(uncertain.id, uncertain, "uncertain");
            expiredCount += 1;
        }
        return expiredCount;
    }

    /**
     * Resolve provider outcomes without replaying an external side effect. The
     * Valkey lease makes this safe across multiple backend replicas; providers
     * that cannot perform a status lookup remain visibly uncertain.
     */
    @Cron("*/5 * * * *")
    async reconcileUncertainActions(): Promise<number> {
        if (!this.sweepLock.isAvailable()) return 0;
        return this.sweepLock.runExclusive(async (lease) => {
            if (!lease.isHeld()) return 0;
            const records = await this.prisma.agent_action.findMany({
                where: { status: "uncertain" },
                orderBy: { updatedAt: "asc" },
                take: 50,
            });
            let reconciled = 0;
            for (const record of records) {
                const capability = this.registry.get(record.capability);
                if (!capability.reconcile) continue;
                const authorization = jsonObject(record.authorizationContext);
                const principal: VerifiedTenantPrincipal = {
                    userId: record.userId,
                    branchId: record.branchId,
                    globalRole: typeof authorization["globalRole"] === "string" ? authorization["globalRole"] : "user",
                    branchRole: typeof authorization["branchRole"] === "string" ? authorization["branchRole"] : "user",
                };
                try {
                    const outcome = await this.reconcile(record.id, principal);
                    if (outcome.status !== "uncertain") reconciled += 1;
                } catch {
                    // A status lookup failure leaves the action uncertain. It must
                    // never be converted to failed or retried as a side effect.
                }
            }
            return reconciled;
        });
    }

    async diagnostics(): Promise<{ pending: number; uncertain: number; succeeded: number; failed: number }> {
        const grouped = await this.prisma.agent_action.groupBy({ by: ["status"], _count: { _all: true } });
        const counts = new Map(grouped.map((item) => [item.status, item._count._all]));
        return {
            pending: (counts.get("proposed") ?? 0) + (counts.get("approved") ?? 0) + (counts.get("executing") ?? 0),
            uncertain: counts.get("uncertain") ?? 0,
            succeeded: counts.get("succeeded") ?? 0,
            failed: counts.get("failed") ?? 0,
        };
    }

    async diagnosticsActions(limit = 100) {
        const records = await this.prisma.agent_action.findMany({
            where: { status: { in: ["proposed", "approved", "executing", "uncertain"] } },
            select: {
                id: true, branchId: true, capability: true, capabilityVersion: true,
                risk: true, status: true, expiresAt: true, createdAt: true, updatedAt: true, error: true,
            },
            orderBy: { updatedAt: "desc" },
            take: Math.max(1, Math.min(limit, 200)),
        });
        return records.map((record) => ({
            ...record,
            errorCode: record.error && typeof record.error === "object" && !Array.isArray(record.error)
                && typeof (record.error as Record<string, unknown>)["code"] === "string"
                ? (record.error as Record<string, unknown>)["code"]
                : null,
            error: undefined,
        }));
    }

    strongAcknowledgementToken(action: AgentActionEntity): string {
        return createHash("sha256").update([
            action.id,
            action.proposalRevision,
            action.userId,
            action.branchId,
            action.expiresAt.toISOString(),
        ].join(":"), "utf8").digest("hex");
    }

    private async persistResultPart(
        actionId: string,
        action: AgentActionEntity,
        status: "succeeded" | "failed" | "uncertain" | "rejected" | "expired" | "cancelled",
    ): Promise<void> {
        if (action.resultPartPersistedAt) return;
        const summary = status === "succeeded"
            ? "승인된 작업이 완료되었습니다."
            : status === "uncertain"
                ? "외부 처리 결과를 확인해야 합니다. 중복 실행하지 마세요."
                : status === "rejected"
                    ? "작업 제안이 거절되었습니다."
                    : status === "expired"
                        ? "작업 제안이 만료되었습니다. 다시 검토해 제안해 주세요."
                        : status === "cancelled"
                            ? "작업이 취소되었습니다."
                            : "승인된 작업을 완료하지 못했습니다.";
        const message = {
            id: `agent-action-result:${actionId}`,
            role: "assistant",
            parts: [{
                type: "data-action-result",
                data: {
                    actionId,
                    status,
                    summary,
                    completedAt: new Date().toISOString(),
                    ...(action.result && typeof action.result === "object" && !Array.isArray(action.result)
                        ? { result: action.result }
                        : {}),
                },
            }],
        } as unknown as BjjUIMessage;
        const owner = { userId: action.userId, branchId: action.branchId };
        const persisted = await this.sessions.upsertActionResultMessage(action.sessionId, owner, message);
        if (persisted === false) throw new Error("Agent action result message was not persisted");
        await this.prisma.agent_action.updateMany({
            where: { id: actionId, ...owner, resultPartPersistedAt: null },
            data: { resultPartPersistedAt: new Date() },
        });
    }

    @Cron("*/5 * * * *")
    async repairTerminalResultParts(): Promise<number> {
        const records = await this.prisma.agent_action.findMany({
            where: { status: { in: TERMINAL_STATUSES }, resultPartPersistedAt: null },
            orderBy: { updatedAt: "asc" },
            take: 100,
        });
        let repaired = 0;
        for (const record of records) {
            const action = toEntity(record);
            await this.persistResultPart(
                action.id,
                action,
                action.status as Parameters<ActionCoordinatorService["persistResultPart"]>[2],
            );
            repaired += 1;
        }
        return repaired;
    }

    @Cron(CronExpression.EVERY_MINUTE)
    async sweepExpired(): Promise<number> {
        if (!this.sweepLock.isAvailable()) return 0;
        return this.sweepLock.runExclusive((lease) => lease.isHeld() ? this.expirePending() : Promise.resolve(0));
    }
}
