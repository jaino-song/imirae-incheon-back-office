import { Prisma } from "@prisma/client";

import { tenantContextStore, type TenantStoreState } from "../tenant/tenant-context.store";
import { TENANT_MODELS } from "../tenant/tenant-models.generated";
import {
    recordTenantIsolationBypass,
    recordTenantIsolationSystemScope,
    reportRawOpInHttpContext,
    reportTenantIsolationViolation,
    resolveTenantIsolationMode,
    TenantIsolationViolationError,
    type TenantIsolationMode,
    type TenantIsolationViolationKind,
} from "../tenant/tenant-isolation.reporter";

/**
 * Prisma Client extension enforcing branch-tenant isolation on every query
 * against a model in `TENANT_MODELS`, consulting the ambient
 * `tenantContextStore` (AsyncLocalStorage) set up by `TenantAlsMiddleware` /
 * `TenantGuard` / `runSystemScope`. Applied in `database.module.ts` via
 * `.$extends(tenantIsolationExtension())`.
 *
 * Policy matrix (see Task 3.3 brief for the authoritative spec):
 *   1. No ALS store active                          -> bypass (+ counter)   [scheduler/cron/bootstrap]
 *   2. store.systemScope === true                    -> bypass (+ counter)
 *   3. store.origin === "http" && !store.branchId     -> VIOLATION http_no_tenant
 *   4. store.branchId present:
 *        write ops   -> check ARGS before execution (unpinned_write / branch_mutation / unpinned_create)
 *        read ops    -> execute, then check RESULTS (cross_branch_read / unpinned_aggregate)
 *   Raw ops ($queryRaw, $queryRawUnsafe, $executeRaw, $executeRawUnsafe) are
 *   never blocked; only logged when the active store is HTTP-origin
 *   (`raw_op_in_http_context`).
 *
 * The decision functions below (`decidePreExecution`, `checkReadResult`,
 * `checkWriteArgs`) are pure and exported so they can be unit-tested with a
 * stubbed `query`/args harness, without a real PrismaClient.
 *
 * Documented limitation: only TOP-LEVEL args are inspected. A nested
 * relation write (e.g. `client.update({ data: { messages: { create: {...} } } })`)
 * is not walked into — the nested `message` row's own `branchId` is not
 * checked by this extension.
 */

const WRITE_OPERATIONS = new Set([
    "create",
    "createMany",
    "createManyAndReturn",
    "update",
    "updateMany",
    "updateManyAndReturn",
    "upsert",
    "delete",
    "deleteMany",
]);

const AGGREGATE_READ_OPERATIONS = new Set(["count", "aggregate", "groupBy"]);

const ROW_READ_OPERATIONS = new Set([
    "findUnique",
    "findUniqueOrThrow",
    "findFirst",
    "findFirstOrThrow",
    "findMany",
]);

const READ_OPERATIONS = new Set<string>([...ROW_READ_OPERATIONS, ...AGGREGATE_READ_OPERATIONS]);

const WHERE_PIN_REQUIRED_WRITE_OPERATIONS = new Set([
    "update",
    "updateMany",
    "updateManyAndReturn",
    "delete",
    "deleteMany",
    "upsert",
]);

const MAX_SCANNED_ROWS = 100;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Matches `where.branchId === branchId`, accepting the `{ equals: branchId }` object form. */
function whereIsPinnedToBranch(where: unknown, branchId: string): boolean {
    if (!isPlainRecord(where)) return false;
    const value = where["branchId"];
    if (typeof value === "string") return value === branchId;
    if (isPlainRecord(value) && "equals" in value) return value["equals"] === branchId;
    return false;
}

/**
 * Checks a single write payload's `branchId` field.
 * - `requirePresence` true (create/createMany rows, upsert.create): absence is `unpinned_create`.
 * - `requirePresence` false (update/updateMany.data, upsert.update): absence is fine, a present
 *   mismatch is still `branch_mutation`.
 */
function checkDataBranchId(
    data: unknown,
    branchId: string,
    requirePresence: boolean,
): TenantIsolationViolationKind | null {
    if (!isPlainRecord(data)) {
        return requirePresence ? "unpinned_create" : null;
    }
    const value = data["branchId"];
    if (value === undefined) {
        return requirePresence ? "unpinned_create" : null;
    }
    return value === branchId ? null : "branch_mutation";
}

/** Pure, testable pre-execution check for write-op args. Exported for unit tests. */
export function checkWriteArgs(
    operation: string,
    args: unknown,
    branchId: string,
): TenantIsolationViolationKind | null {
    const a = isPlainRecord(args) ? args : {};

    if (WHERE_PIN_REQUIRED_WRITE_OPERATIONS.has(operation) && !whereIsPinnedToBranch(a["where"], branchId)) {
        return "unpinned_write";
    }

    switch (operation) {
        case "create":
            return checkDataBranchId(a["data"], branchId, true);
        case "createMany":
        case "createManyAndReturn": {
            // Prisma accepts a single object or an array for createMany data.
            const rows = Array.isArray(a["data"]) ? a["data"] : [a["data"]];
            for (const row of rows) {
                const violation = checkDataBranchId(row, branchId, true);
                if (violation) return violation;
            }
            return null;
        }
        case "update":
        case "updateMany":
        case "updateManyAndReturn":
            return checkDataBranchId(a["data"], branchId, false);
        case "upsert": {
            const createViolation = checkDataBranchId(a["create"], branchId, true);
            if (createViolation) return createViolation;
            return checkDataBranchId(a["update"], branchId, false);
        }
        default:
            // delete/deleteMany: where-pin already checked above, no data payload to inspect.
            return null;
    }
}

/** Normalizes a read result (single row | null | array) into a bounded row list. */
function extractRows(result: unknown): unknown[] {
    if (result === null || result === undefined) return [];
    return Array.isArray(result) ? result : [result];
}

export interface ReadResultViolation {
    kind: TenantIsolationViolationKind;
    offendingBranchIds?: string[];
}

/**
 * Pure, testable post-execution check for read-op results/args. Exported
 * for unit tests. Row-shaped ops scan at most `MAX_SCANNED_ROWS`; a row's
 * `branchId` counts as offending only when non-null and different from the
 * expected branch. Aggregate ops (`count`/`aggregate`/`groupBy`) have no row
 * identity to scan, so they're checked by args: `where.branchId` absent is
 * `unpinned_aggregate` (a present-but-different value is not separately
 * classified — this mirrors the brief's literal wording).
 */
export function checkReadResult(
    operation: string,
    args: unknown,
    result: unknown,
    branchId: string,
): ReadResultViolation | null {
    if (AGGREGATE_READ_OPERATIONS.has(operation)) {
        const a = isPlainRecord(args) ? args : {};
        const where = isPlainRecord(a["where"]) ? a["where"] : undefined;
        if (!where || where["branchId"] === undefined) {
            return { kind: "unpinned_aggregate" };
        }
        return null;
    }

    const rows = extractRows(result).slice(0, MAX_SCANNED_ROWS);
    const offending = new Set<string>();
    for (const row of rows) {
        if (!isPlainRecord(row)) continue;
        const rowBranchId = row["branchId"];
        if (rowBranchId !== null && rowBranchId !== undefined && rowBranchId !== branchId) {
            offending.add(String(rowBranchId));
        }
    }
    if (offending.size > 0) {
        return { kind: "cross_branch_read", offendingBranchIds: [...offending] };
    }
    return null;
}

export type PreExecutionDecision =
    | { action: "bypass" }
    | { action: "violation"; kind: TenantIsolationViolationKind }
    | { action: "proceed" };

/**
 * Pure, testable decision for what to do BEFORE calling `query(args)`,
 * covering policy-matrix cases 1-4 (write-arg checks included). Read-op
 * results are checked separately, after execution, via `checkReadResult`.
 * Exported for unit tests.
 */
export function decidePreExecution(
    operation: string,
    args: unknown,
    store: TenantStoreState | undefined,
): PreExecutionDecision {
    if (!store) {
        return { action: "bypass" }; // case 1: no ALS store active (scheduler/cron/bootstrap)
    }
    if (store.systemScope) {
        return { action: "bypass" }; // case 2: explicit system-scope bypass
    }
    if (store.origin === "http" && !store.branchId) {
        return { action: "violation", kind: "http_no_tenant" }; // case 3
    }
    if (!store.branchId) {
        // Store exists, not systemScope, not http-origin-without-branchId, and still no
        // branchId. In practice this is unreachable: `origin: "system"` is only ever produced
        // by `runSystemScope`, which always also sets `systemScope: true`. The policy matrix
        // does not define a violation kind for this combination, so treat it like cases 1/2
        // rather than inventing one.
        return { action: "bypass" };
    }

    // case 4: store has a branchId.
    if (WRITE_OPERATIONS.has(operation)) {
        const kind = checkWriteArgs(operation, args, store.branchId);
        if (kind) return { action: "violation", kind };
    }

    return { action: "proceed" };
}

function isTenantModel(model: string | undefined): model is string {
    return model !== undefined && TENANT_MODELS.has(model);
}

/**
 * Orchestrates one model-operation interception: resolves mode + ambient
 * store, runs `decidePreExecution`, executes (or blocks/throws), and for
 * read ops runs `checkReadResult` on the fetched data. Exported (alongside
 * `handleRawOperation`) so tests can drive the full mode/reporting/counter
 * behavior with a stubbed `query` callback, without a real PrismaClient —
 * `tenantIsolationExtension()` is a thin `Prisma.defineExtension` wrapper
 * around this function and `handleRawOperation`.
 */
export async function handleModelOperation(params: {
    model: string | undefined;
    operation: string;
    args: unknown;
    query: (args: unknown) => Promise<unknown>;
}): Promise<unknown> {
    const { model, operation, args, query } = params;

    if (!isTenantModel(model)) {
        return query(args);
    }

    const mode = resolveTenantIsolationMode();
    if (mode === "off") {
        return query(args);
    }

    const store = tenantContextStore.get();
    const decision = decidePreExecution(operation, args, store);

    if (decision.action === "bypass") {
        if (store?.systemScope) {
            recordTenantIsolationSystemScope();
        } else {
            recordTenantIsolationBypass();
        }
        return query(args);
    }

    if (decision.action === "violation") {
        reportTenantIsolationViolation({
            kind: decision.kind,
            model,
            action: operation,
            expectedBranchId: store?.branchId,
            mode,
        });
        if (mode === "enforce") {
            throw new TenantIsolationViolationError(decision.kind, model, operation);
        }
        // observe: execute normally, only the violation was logged.
        return query(args);
    }

    // decision.action === "proceed"
    const branchId = store?.branchId as string; // decidePreExecution only reaches "proceed" with a branchId present
    const result = await query(args);

    if (!READ_OPERATIONS.has(operation)) {
        return result; // write op already arg-checked pre-execution
    }

    const readViolation = checkReadResult(operation, args, result, branchId);
    if (!readViolation) {
        return result;
    }

    reportTenantIsolationViolation({
        kind: readViolation.kind,
        model,
        action: operation,
        expectedBranchId: branchId,
        offendingBranchIds: readViolation.offendingBranchIds,
        mode,
    });

    if (mode === "enforce") {
        // Data was already fetched (required to detect a row-level violation) but must not
        // reach the caller.
        throw new TenantIsolationViolationError(readViolation.kind, model, operation);
    }
    return result;
}

/** Exported for the same testability reason as `handleModelOperation`. */
export function handleRawOperation(operation: string): void {
    if (resolveTenantIsolationMode() === "off") return;
    const store = tenantContextStore.get();
    if (store?.origin === "http") {
        reportRawOpInHttpContext(operation);
    }
}

export function tenantIsolationExtension() {
    return Prisma.defineExtension({
        name: "tenant-isolation",
        query: {
            $allModels: {
                async $allOperations({ model, operation, args, query }) {
                    return handleModelOperation({ model, operation, args, query });
                },
            },
            async $queryRaw({ args, query }) {
                handleRawOperation("$queryRaw");
                return query(args);
            },
            async $queryRawUnsafe({ args, query }) {
                handleRawOperation("$queryRawUnsafe");
                return query(args);
            },
            async $executeRaw({ args, query }) {
                handleRawOperation("$executeRaw");
                return query(args);
            },
            async $executeRawUnsafe({ args, query }) {
                handleRawOperation("$executeRawUnsafe");
                return query(args);
            },
        },
    });
}

export type { TenantIsolationMode, TenantIsolationViolationKind };
