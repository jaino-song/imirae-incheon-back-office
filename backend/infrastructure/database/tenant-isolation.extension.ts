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

/**
 * Matches `where.branchId === branchId`, accepting the `{ equals: branchId }` and
 * `{ in: [...branchId only...] }` object forms, and also accepting the compound-unique-key
 * shape Prisma generates for `@@unique([branchId, ...])` (e.g. `branchId_phoneNormalized: {
 * branchId, phoneNormalized }`): any top-level where key whose value is a plain object itself
 * carrying `branchId === branchId` counts as a pin, even when the top-level `where.branchId`
 * key is absent.
 */
function whereIsPinnedToBranch(where: unknown, branchId: string): boolean {
    if (!isPlainRecord(where)) return false;

    const value = where["branchId"];
    if (typeof value === "string") return value === branchId;
    if (isPlainRecord(value)) {
        if (value["equals"] === branchId) return true;
        const inValues = value["in"];
        if (Array.isArray(inValues) && inValues.length > 0 && inValues.every((v) => v === branchId)) {
            return true;
        }
    }

    for (const nested of Object.values(where)) {
        if (isPlainRecord(nested) && nested["branchId"] === branchId) return true;
    }

    return false;
}

/**
 * Resolves the target branch id out of a `data.branch` relation-write payload, i.e. Prisma's
 * relation spelling for pinning/moving the `branch` foreign key instead of the plain
 * `data.branchId` scalar. Recognizes `connect.id`, `connectOrCreate.where.id`, and `create.id`;
 * `disconnect: true` resolves to `{ id: null }` so it always compares unequal to a real branch
 * id. Returns `null` when `branch` is absent or its shape carries no recognizable id (e.g. a
 * `create` with no explicit `id`, left to Prisma's default generation) — the caller falls back
 * to `data.branchId`-only behavior in that case.
 */
function resolveRelationBranchId(branch: unknown): { id: string | null } | null {
    if (!isPlainRecord(branch)) return null;
    if (branch["disconnect"] === true) return { id: null };

    const connect = branch["connect"];
    if (isPlainRecord(connect) && typeof connect["id"] === "string") {
        return { id: connect["id"] };
    }

    const connectOrCreate = branch["connectOrCreate"];
    if (isPlainRecord(connectOrCreate)) {
        const where = connectOrCreate["where"];
        if (isPlainRecord(where) && typeof where["id"] === "string") {
            return { id: where["id"] };
        }
    }

    const create = branch["create"];
    if (isPlainRecord(create) && typeof create["id"] === "string") {
        return { id: create["id"] };
    }

    return null;
}

/**
 * Checks a single write payload's branch pin, across both the plain `data.branchId` scalar and
 * the `data.branch` relation-write spelling (`connect`/`connectOrCreate`/`create`/`disconnect`).
 * - Either form resolving to a different branch (or a `branch.disconnect`) is `branch_mutation`,
 *   regardless of `requirePresence` — moving/detaching a row from its branch is never allowed.
 * - If BOTH forms are present, both must match; a mismatch in either is `branch_mutation`.
 * - `requirePresence` true (create/createMany rows, upsert.create): the row must be pinned by
 *   EITHER form — a matching `branch.connect`/`connectOrCreate`/`create` id satisfies presence
 *   just as a matching `data.branchId` does. Absence of both is `unpinned_create`.
 * - `requirePresence` false (update/updateMany.data, upsert.update): absence of both is fine.
 */
function checkDataBranchId(
    data: unknown,
    branchId: string,
    requirePresence: boolean,
): TenantIsolationViolationKind | null {
    if (!isPlainRecord(data)) {
        return requirePresence ? "unpinned_create" : null;
    }

    const relation = resolveRelationBranchId(data["branch"]);
    if (relation && relation.id !== branchId) {
        return "branch_mutation";
    }

    const value = data["branchId"];
    if (value !== undefined) {
        return value === branchId ? null : "branch_mutation";
    }

    if (relation) {
        // No direct `data.branchId`, but a matching `branch` relation connect/create satisfies
        // presence (relation.id === branchId here — a mismatch already returned above).
        return null;
    }

    return requirePresence ? "unpinned_create" : null;
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
 * for unit tests. Row-shaped ops scan at most `MAX_SCANNED_ROWS` (rows plus
 * one level of `include`/nested-`select` relation children — see the F1-e
 * scan below — share this one budget); a row's (or relation child's)
 * `branchId` counts as offending only when non-null and different from the
 * expected branch. Aggregate ops (`count`/`aggregate`/`groupBy`) have no row
 * identity to scan, so they're checked by args via `whereIsPinnedToBranch`:
 * a missing, mismatched, or otherwise-unpinned `where.branchId` is
 * `unpinned_aggregate`.
 */
export function checkReadResult(
    operation: string,
    args: unknown,
    result: unknown,
    branchId: string,
): ReadResultViolation | null {
    if (AGGREGATE_READ_OPERATIONS.has(operation)) {
        const a = isPlainRecord(args) ? args : {};
        if (!whereIsPinnedToBranch(a["where"], branchId)) {
            return { kind: "unpinned_aggregate" };
        }
        return null;
    }

    const offending = new Set<string>();
    let scanned = 0;

    const recordIfOffending = (candidate: Record<string, unknown>): void => {
        const candidateBranchId = candidate["branchId"];
        if (candidateBranchId !== null && candidateBranchId !== undefined && candidateBranchId !== branchId) {
            offending.add(String(candidateBranchId));
        }
    };

    rowLoop: for (const row of extractRows(result)) {
        if (scanned >= MAX_SCANNED_ROWS) break;
        if (!isPlainRecord(row)) continue;
        scanned += 1;
        recordIfOffending(row);

        // F1-e: one-level nested scan. Rows pulled via `include`/nested `select` on this
        // tenant-root query carry their own `branchId` that the top-level check above never
        // sees; walk each row's direct child properties (a relation object, or an array of
        // relation objects) and apply the same non-null-mismatch check. Nested relations are
        // not walked recursively — only this one level. Shares `scanned` (and therefore
        // MAX_SCANNED_ROWS) with the parent row scan as a single total budget.
        for (const value of Object.values(row)) {
            if (scanned >= MAX_SCANNED_ROWS) break rowLoop;
            if (Array.isArray(value)) {
                for (const child of value) {
                    if (scanned >= MAX_SCANNED_ROWS) break rowLoop;
                    if (!isPlainRecord(child)) continue;
                    scanned += 1;
                    recordIfOffending(child);
                }
            } else if (isPlainRecord(value)) {
                scanned += 1;
                recordIfOffending(value);
            }
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

export interface ReadArgsPreparation {
    args: unknown;
    /** True when `select` lacked a truthy `branchId` and we injected `branchId: true`. */
    injectedSelectBranchId: boolean;
    /** True when `omit` carried `branchId` and we deleted that key. */
    deletedOmitBranchId: boolean;
}

/**
 * F1-a: `select`/`omit` projection blinds `checkReadResult` — a caller-supplied
 * `select`/`omit` that excludes `branchId` makes every fetched row's `rowBranchId` come back
 * `undefined`, which the read check (correctly) treats as "no identity to check", so a
 * cross-branch row sails through undetected even in `enforce` mode. FIX: for row-shaped read
 * ops, force `branchId` into the fetched shape — inject `select.branchId: true` when a `select`
 * is present but lacks a truthy `branchId`, and drop `branchId` out of `omit` when present —
 * so `checkReadResult` always has real row identity to scan. The caller-visible shape is
 * restored afterward by stripping the injected field back out of the result (see
 * `stripInjectedBranchId`), so this mutation is invisible to callers when there's no
 * violation. Only the top-level `select`/`omit` object is touched — nested selects for
 * relations are out of scope, matching the module's documented top-level-only limitation.
 */
export function prepareReadArgsForBranchScan(operation: string, args: unknown): ReadArgsPreparation {
    if (!ROW_READ_OPERATIONS.has(operation) || !isPlainRecord(args)) {
        return { args, injectedSelectBranchId: false, deletedOmitBranchId: false };
    }

    let nextArgs: Record<string, unknown> = args;
    let injectedSelectBranchId = false;
    let deletedOmitBranchId = false;

    const select = args["select"];
    if (isPlainRecord(select) && !select["branchId"]) {
        nextArgs = { ...nextArgs, select: { ...select, branchId: true } };
        injectedSelectBranchId = true;
    }

    const omit = args["omit"];
    if (isPlainRecord(omit) && "branchId" in omit) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars -- named only to drop it
        const { branchId: _omittedBranchId, ...restOmit } = omit;
        nextArgs = { ...nextArgs, omit: restOmit };
        deletedOmitBranchId = true;
    }

    if (!injectedSelectBranchId && !deletedOmitBranchId) {
        return { args, injectedSelectBranchId: false, deletedOmitBranchId: false };
    }
    return { args: nextArgs, injectedSelectBranchId, deletedOmitBranchId };
}

/** Deletes a top-level `branchId` key from a single row, leaving non-plain-object rows as-is. */
function stripBranchIdField(row: unknown): unknown {
    if (!isPlainRecord(row)) return row;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- named only to drop it
    const { branchId: _rowBranchId, ...rest } = row;
    return rest;
}

/** Undoes `prepareReadArgsForBranchScan`'s injection on the fetched result (single row or array). */
function stripInjectedBranchId(result: unknown): unknown {
    return Array.isArray(result) ? result.map(stripBranchIdField) : stripBranchIdField(result);
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

    // F1-a: force branchId into the fetched shape for row-shaped reads so checkReadResult has
    // real row identity to scan, even when the caller's select/omit tried to exclude it.
    const preparedRead = prepareReadArgsForBranchScan(operation, args);
    const needsStrip = preparedRead.injectedSelectBranchId || preparedRead.deletedOmitBranchId;
    const result = await query(preparedRead.args);

    if (!READ_OPERATIONS.has(operation)) {
        return result; // write op already arg-checked pre-execution
    }

    const readViolation = checkReadResult(operation, preparedRead.args, result, branchId);
    if (!readViolation) {
        return needsStrip ? stripInjectedBranchId(result) : result;
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
    return needsStrip ? stripInjectedBranchId(result) : result;
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
