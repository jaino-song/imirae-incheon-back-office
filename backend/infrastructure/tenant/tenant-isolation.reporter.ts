import { Logger } from "@nestjs/common";
import * as Sentry from "@sentry/nestjs";

/**
 * Env-switched enforcement level for the tenant-isolation Prisma extension
 * (`infrastructure/database/tenant-isolation.extension.ts`). Default is
 * `observe`: log/report violations but never block a query.
 */
export type TenantIsolationMode = "off" | "observe" | "enforce";

export function resolveTenantIsolationMode(): TenantIsolationMode {
    const raw = process.env["TENANT_ISOLATION_MODE"];
    return raw === "off" || raw === "enforce" ? raw : "observe";
}

/**
 * The policy-matrix violation kinds the extension can detect. See the
 * extension module's header comment for the full decision table.
 */
export type TenantIsolationViolationKind =
    | "http_no_tenant"
    | "unpinned_write"
    | "branch_mutation"
    | "unpinned_create"
    | "cross_branch_read"
    | "unpinned_aggregate";

/**
 * Thrown by the extension in `enforce` mode after a violation has already
 * been reported (logged + sent to Sentry). Carries enough structure for
 * callers/tests to assert on the specific policy branch that fired.
 */
export class TenantIsolationViolationError extends Error {
    readonly kind: TenantIsolationViolationKind;
    readonly model: string;
    readonly action: string;

    constructor(kind: TenantIsolationViolationKind, model: string, action: string) {
        super(`Tenant isolation violation: ${kind} on ${model}.${action}`);
        this.name = "TenantIsolationViolationError";
        this.kind = kind;
        this.model = model;
        this.action = action;
    }
}

interface TenantIsolationViolationEvent {
    event: "tenant_isolation_violation";
    kind: TenantIsolationViolationKind;
    model: string;
    action: string;
    expectedBranchId: string | undefined;
    offendingBranchIds?: string[];
    mode: TenantIsolationMode;
    stack: string;
}

const logger = new Logger("TenantIsolation");

/** In-memory counters, reset per process. Exposed for tests via `getTenantIsolationStats()`. */
interface TenantIsolationStats {
    bypass: number;
    systemScope: number;
    violations: number;
    violationsByKind: Record<string, number>;
}

const stats: TenantIsolationStats = {
    bypass: 0,
    systemScope: 0,
    violations: 0,
    violationsByKind: {},
};

export function getTenantIsolationStats(): TenantIsolationStats {
    return {
        bypass: stats.bypass,
        systemScope: stats.systemScope,
        violations: stats.violations,
        violationsByKind: { ...stats.violationsByKind },
    };
}

/** Test-only helper: resets the module-level counters between spec cases. */
export function resetTenantIsolationStats(): void {
    stats.bypass = 0;
    stats.systemScope = 0;
    stats.violations = 0;
    stats.violationsByKind = {};
}

/**
 * F1-f: Sentry de-dup window. `reportTenantIsolationViolation` always structured-logs every
 * occurrence, but a hot violation path (e.g. one bad query fired per request) can flood Sentry
 * with an unsampled `captureMessage` per call. Cap Sentry reporting to at most once per
 * `(kind, model, action)` triple per `SENTRY_DEDUP_WINDOW_MS`; the in-memory `Map` records the
 * last-sent timestamp per key.
 */
const SENTRY_DEDUP_WINDOW_MS = 5 * 60 * 1000;
const sentryLastSentAt = new Map<string, number>();

function sentryDedupKey(kind: TenantIsolationViolationKind, model: string, action: string): string {
    return `${kind}|${model}|${action}`;
}

/** Test-only helper: clears the Sentry de-dup window state between spec cases. */
export function resetTenantIsolationSentryDedup(): void {
    sentryLastSentAt.clear();
}

export function recordTenantIsolationBypass(): void {
    stats.bypass += 1;
}

export function recordTenantIsolationSystemScope(): void {
    stats.systemScope += 1;
}

/** `new Error().stack` from this call site, capped to ~8 frames. */
function truncatedStack(maxFrames = 8): string {
    const stack = new Error().stack ?? "";
    return stack.split("\n").slice(0, maxFrames + 1).join("\n");
}

export interface ReportViolationParams {
    kind: TenantIsolationViolationKind;
    model: string;
    action: string;
    expectedBranchId: string | undefined;
    offendingBranchIds?: string[];
    mode: TenantIsolationMode;
}

/**
 * Reports a policy-matrix violation: always structured-logs a warning, and
 * bumps the in-memory violation counters. Also sends a Sentry message
 * (following the `Sentry.withScope` + tags pattern used by
 * `infrastructure/observability/service-record-sentry.ts`), but at most once
 * per `(kind, model, action)` per `SENTRY_DEDUP_WINDOW_MS` — see F1-f above;
 * every occurrence still gets its own `logger.warn`, only Sentry reporting
 * is deduped. Does NOT throw — the extension decides whether to throw
 * `TenantIsolationViolationError` based on mode.
 */
export function reportTenantIsolationViolation(params: ReportViolationParams): void {
    stats.violations += 1;
    stats.violationsByKind[params.kind] = (stats.violationsByKind[params.kind] ?? 0) + 1;

    const event: TenantIsolationViolationEvent = {
        event: "tenant_isolation_violation",
        kind: params.kind,
        model: params.model,
        action: params.action,
        expectedBranchId: params.expectedBranchId,
        offendingBranchIds: params.offendingBranchIds,
        mode: params.mode,
        stack: truncatedStack(),
    };

    logger.warn(JSON.stringify(event));

    const dedupKey = sentryDedupKey(params.kind, params.model, params.action);
    const now = Date.now();
    const lastSentAt = sentryLastSentAt.get(dedupKey);
    if (lastSentAt !== undefined && now - lastSentAt < SENTRY_DEDUP_WINDOW_MS) {
        return;
    }
    sentryLastSentAt.set(dedupKey, now);

    Sentry.withScope((scope) => {
        scope.setLevel("warning");
        scope.setTag("feature", "tenant-isolation");
        scope.setTag("kind", params.kind);
        scope.setTag("model", params.model);
        scope.setTag("action", params.action);
        scope.setTag("mode", params.mode);
        scope.setContext("tenantIsolation", {
            expectedBranchId: params.expectedBranchId ?? null,
            offendingBranchIds: params.offendingBranchIds ?? [],
        });
        Sentry.captureMessage(`tenant_isolation_violation:${params.kind}`);
    });
}

/**
 * Logs (never blocks, never counts toward `violations`) a raw SQL operation
 * (`$queryRaw`/`$queryRawUnsafe`/`$executeRaw`/`$executeRawUnsafe`) issued
 * while an HTTP-origin tenant store is active. Raw SQL bypasses the
 * model-level arg/result checks entirely, so this is a visibility signal
 * only, fired identically in observe and enforce mode.
 */
export function reportRawOpInHttpContext(operation: string): void {
    logger.warn(JSON.stringify({
        event: "raw_op_in_http_context",
        operation,
        stack: truncatedStack(),
    }));
}
