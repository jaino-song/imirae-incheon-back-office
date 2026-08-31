import { tenantContextStore, type TenantStoreState } from "../tenant/tenant-context.store";
import * as reporter from "../tenant/tenant-isolation.reporter";
import { getTenantIsolationStats, resetTenantIsolationStats, TenantIsolationViolationError } from "../tenant/tenant-isolation.reporter";
import {
    checkReadResult,
    checkWriteArgs,
    decidePreExecution,
    handleModelOperation,
    handleRawOperation,
    tenantIsolationExtension,
} from "./tenant-isolation.extension";

jest.mock("@sentry/nestjs", () => ({
    withScope: (fn: (scope: unknown) => void) =>
        fn({
            setLevel: jest.fn(),
            setTag: jest.fn(),
            setContext: jest.fn(),
        }),
    captureMessage: jest.fn(),
}));

const TENANT_MODEL = "message_log"; // a real entry in TENANT_MODELS
const NON_TENANT_MODEL = "not_a_tenant_model";

function setMode(mode: "off" | "observe" | "enforce" | undefined): void {
    if (mode === undefined) {
        delete process.env["TENANT_ISOLATION_MODE"];
    } else {
        process.env["TENANT_ISOLATION_MODE"] = mode;
    }
}

function run<T>(store: TenantStoreState | undefined, fn: () => T): T {
    return store === undefined ? fn() : tenantContextStore.run(store, fn);
}

beforeEach(() => {
    resetTenantIsolationStats();
    setMode(undefined); // default: observe
    jest.clearAllMocks();
});

describe("decidePreExecution — policy matrix cases 1-4", () => {
    it("case 1: no ALS store active -> bypass", () => {
        expect(decidePreExecution("findMany", {}, undefined)).toEqual({ action: "bypass" });
    });

    it("case 2: systemScope true -> bypass", () => {
        expect(decidePreExecution("findMany", {}, { origin: "system", systemScope: true })).toEqual({
            action: "bypass",
        });
    });

    it("case 3: http origin without branchId -> violation http_no_tenant", () => {
        expect(decidePreExecution("findMany", {}, { origin: "http" })).toEqual({
            action: "violation",
            kind: "http_no_tenant",
        });
    });

    it("unreachable-in-practice edge case: no branchId, not http, not systemScope -> bypass (not a defined violation kind)", () => {
        expect(decidePreExecution("findMany", {}, { origin: "system" })).toEqual({ action: "bypass" });
    });

    it("case 4: branchId present, read op -> proceed (arg check deferred to post-execution)", () => {
        expect(decidePreExecution("findMany", {}, { origin: "http", branchId: "b1" })).toEqual({
            action: "proceed",
        });
    });
});

describe("checkWriteArgs — unpinned_write (where must pin the branch)", () => {
    it.each(["update", "updateMany", "updateManyAndReturn", "delete", "deleteMany", "upsert"])(
        "%s: missing where.branchId -> unpinned_write",
        (operation) => {
            expect(checkWriteArgs(operation, { where: { id: "x" } }, "b1")).toBe("unpinned_write");
        },
    );

    it("update: where.branchId different value -> unpinned_write", () => {
        expect(checkWriteArgs("update", { where: { branchId: "other" }, data: {} }, "b1")).toBe("unpinned_write");
    });

    it("update: where.branchId as string match -> no where violation (data absent is fine)", () => {
        expect(checkWriteArgs("update", { where: { branchId: "b1" }, data: {} }, "b1")).toBeNull();
    });

    it("update: where.branchId as { equals } object form is accepted", () => {
        expect(
            checkWriteArgs("update", { where: { branchId: { equals: "b1" } }, data: {} }, "b1"),
        ).toBeNull();
    });

    it("update: where.branchId as mismatched { equals } object form -> unpinned_write", () => {
        expect(
            checkWriteArgs("update", { where: { branchId: { equals: "other" } }, data: {} }, "b1"),
        ).toBe("unpinned_write");
    });
});

describe("checkWriteArgs — branch_mutation (data.branchId present but different)", () => {
    it("update: data.branchId different from store -> branch_mutation", () => {
        expect(
            checkWriteArgs("update", { where: { branchId: "b1" }, data: { branchId: "b2" } }, "b1"),
        ).toBe("branch_mutation");
    });

    it("update: data.branchId equal to store -> no violation", () => {
        expect(
            checkWriteArgs("update", { where: { branchId: "b1" }, data: { branchId: "b1" } }, "b1"),
        ).toBeNull();
    });

    it("updateMany: data.branchId different -> branch_mutation", () => {
        expect(
            checkWriteArgs("updateMany", { where: { branchId: "b1" }, data: { branchId: "b2" } }, "b1"),
        ).toBe("branch_mutation");
    });

    it("updateManyAndReturn: data.branchId different -> branch_mutation", () => {
        expect(
            checkWriteArgs("updateManyAndReturn", { where: { branchId: "b1" }, data: { branchId: "b2" } }, "b1"),
        ).toBe("branch_mutation");
    });
});

describe("checkWriteArgs — unpinned_create (create/createMany/upsert.create require branchId)", () => {
    it("create: data.branchId absent -> unpinned_create", () => {
        expect(checkWriteArgs("create", { data: { name: "x" } }, "b1")).toBe("unpinned_create");
    });

    it("create: data.branchId present and correct -> no violation", () => {
        expect(checkWriteArgs("create", { data: { branchId: "b1" } }, "b1")).toBeNull();
    });

    it("create: data.branchId present but wrong -> branch_mutation (not unpinned_create)", () => {
        expect(checkWriteArgs("create", { data: { branchId: "b2" } }, "b1")).toBe("branch_mutation");
    });

    it("createMany: every row checked — first row ok, second row missing branchId -> unpinned_create", () => {
        expect(
            checkWriteArgs("createMany", { data: [{ branchId: "b1" }, { name: "no-branch" }] }, "b1"),
        ).toBe("unpinned_create");
    });

    it("createMany: a row with a mismatched branchId -> branch_mutation", () => {
        expect(
            checkWriteArgs("createMany", { data: [{ branchId: "b1" }, { branchId: "b2" }] }, "b1"),
        ).toBe("branch_mutation");
    });

    it("createMany: all rows correct -> no violation", () => {
        expect(
            checkWriteArgs("createMany", { data: [{ branchId: "b1" }, { branchId: "b1" }] }, "b1"),
        ).toBeNull();
    });

    it("createMany: single-object (non-array) data is still checked -> unpinned_create", () => {
        expect(checkWriteArgs("createMany", { data: { name: "no-branch" } }, "b1")).toBe("unpinned_create");
    });

    it("createManyAndReturn: row missing branchId -> unpinned_create", () => {
        expect(
            checkWriteArgs("createManyAndReturn", { data: [{ branchId: "b1" }, { name: "no-branch" }] }, "b1"),
        ).toBe("unpinned_create");
    });

    it("createManyAndReturn: all rows correct -> no violation", () => {
        expect(
            checkWriteArgs("createManyAndReturn", { data: [{ branchId: "b1" }] }, "b1"),
        ).toBeNull();
    });
});

describe("checkWriteArgs — upsert checks all three arg positions", () => {
    it("upsert: where not pinned -> unpinned_write (checked first)", () => {
        expect(
            checkWriteArgs(
                "upsert",
                { where: { id: "x" }, create: { branchId: "b1" }, update: {} },
                "b1",
            ),
        ).toBe("unpinned_write");
    });

    it("upsert: where pinned, create.branchId absent -> unpinned_create", () => {
        expect(
            checkWriteArgs(
                "upsert",
                { where: { branchId: "b1" }, create: { name: "x" }, update: {} },
                "b1",
            ),
        ).toBe("unpinned_create");
    });

    it("upsert: where pinned, create ok, update.branchId mismatched -> branch_mutation", () => {
        expect(
            checkWriteArgs(
                "upsert",
                { where: { branchId: "b1" }, create: { branchId: "b1" }, update: { branchId: "b2" } },
                "b1",
            ),
        ).toBe("branch_mutation");
    });

    it("upsert: where pinned, create ok, update omits branchId -> no violation", () => {
        expect(
            checkWriteArgs(
                "upsert",
                { where: { branchId: "b1" }, create: { branchId: "b1" }, update: { name: "x" } },
                "b1",
            ),
        ).toBeNull();
    });
});

describe("checkReadResult — cross_branch_read (row-shaped ops)", () => {
    it("findMany: a row with a different, non-null branchId -> cross_branch_read", () => {
        const result = [{ branchId: "b1" }, { branchId: "b2" }, { branchId: "b1" }];
        expect(checkReadResult("findMany", {}, result, "b1")).toEqual({
            kind: "cross_branch_read",
            offendingBranchIds: ["b2"],
        });
    });

    it("findMany: a row with branchId === null is NOT a violation", () => {
        const result = [{ branchId: "b1" }, { branchId: null }];
        expect(checkReadResult("findMany", {}, result, "b1")).toBeNull();
    });

    it("findUnique: single-object result (not array) is checked the same way", () => {
        expect(checkReadResult("findUnique", {}, { branchId: "b2" }, "b1")).toEqual({
            kind: "cross_branch_read",
            offendingBranchIds: ["b2"],
        });
    });

    it("findUnique: null result -> no violation", () => {
        expect(checkReadResult("findUnique", {}, null, "b1")).toBeNull();
    });

    it("100-row cap: an offending row within the first 100 is detected", () => {
        const rows = Array.from({ length: 150 }, (_, i) => ({ branchId: i === 50 ? "b2" : "b1" }));
        expect(checkReadResult("findMany", {}, rows, "b1")).toEqual({
            kind: "cross_branch_read",
            offendingBranchIds: ["b2"],
        });
    });

    it("100-row cap boundary: an offending row at index 100 (the 101st row, outside the scan) is NOT detected", () => {
        const rows = Array.from({ length: 150 }, (_, i) => ({ branchId: i === 100 ? "b2" : "b1" }));
        expect(checkReadResult("findMany", {}, rows, "b1")).toBeNull();
    });

    it("100-row cap boundary: an offending row at index 99 (the 100th row, inside the scan) IS detected", () => {
        const rows = Array.from({ length: 150 }, (_, i) => ({ branchId: i === 99 ? "b2" : "b1" }));
        expect(checkReadResult("findMany", {}, rows, "b1")).toEqual({
            kind: "cross_branch_read",
            offendingBranchIds: ["b2"],
        });
    });
});

describe("checkReadResult — unpinned_aggregate (count/aggregate/groupBy)", () => {
    it.each(["count", "aggregate", "groupBy"])("%s: where.branchId absent -> unpinned_aggregate", (operation) => {
        expect(checkReadResult(operation, {}, { _count: 1 }, "b1")).toEqual({ kind: "unpinned_aggregate" });
    });

    it("count: where.branchId present -> no violation, regardless of the result shape", () => {
        expect(checkReadResult("count", { where: { branchId: "b1" } }, 5, "b1")).toBeNull();
    });

    it("count/aggregate/groupBy results are never row-scanned even when array-shaped", () => {
        // groupBy legitimately returns an array of bucket rows; those are not tenant rows and
        // must not be mistaken for a cross-branch read violation.
        expect(
            checkReadResult("groupBy", { where: { branchId: "b1" } }, [{ branchId: "b2", _count: 1 }], "b1"),
        ).toBeNull();
    });
});

describe("handleModelOperation — mode: off (no behavior change)", () => {
    it("off mode: executes normally and reports nothing, even for an obviously violating write", async () => {
        setMode("off");
        const query = jest.fn().mockResolvedValue({ id: "created" });
        const result = await run({ origin: "http", branchId: "b1" }, () =>
            handleModelOperation({ model: TENANT_MODEL, operation: "create", args: { data: {} }, query }),
        );
        expect(result).toEqual({ id: "created" });
        expect(query).toHaveBeenCalledTimes(1);
        expect(getTenantIsolationStats()).toEqual({
            bypass: 0,
            systemScope: 0,
            violations: 0,
            violationsByKind: {},
        });
    });
});

describe("handleModelOperation — non-tenant models pass through untouched, in every mode", () => {
    it.each(["off", "observe", "enforce"] as const)("%s mode: non-tenant model bypasses all checks", async (mode) => {
        setMode(mode);
        const query = jest.fn().mockResolvedValue("raw-result");
        const result = await run({ origin: "http" }, () =>
            handleModelOperation({ model: NON_TENANT_MODEL, operation: "findMany", args: {}, query }),
        );
        expect(result).toBe("raw-result");
        expect(query).toHaveBeenCalledTimes(1);
        expect(getTenantIsolationStats().violations).toBe(0);
    });
});

describe("handleModelOperation — case 1/2 bypass counters", () => {
    it("no store -> bypass counter increments, query executes", async () => {
        const query = jest.fn().mockResolvedValue([]);
        const result = await handleModelOperation({ model: TENANT_MODEL, operation: "findMany", args: {}, query });
        expect(result).toEqual([]);
        expect(query).toHaveBeenCalledTimes(1);
        expect(getTenantIsolationStats().bypass).toBe(1);
        expect(getTenantIsolationStats().systemScope).toBe(0);
    });

    it("systemScope -> systemScope counter increments, query executes", async () => {
        const query = jest.fn().mockResolvedValue([]);
        const result = await run({ origin: "system", systemScope: true }, () =>
            handleModelOperation({ model: TENANT_MODEL, operation: "findMany", args: {}, query }),
        );
        expect(result).toEqual([]);
        expect(query).toHaveBeenCalledTimes(1);
        expect(getTenantIsolationStats().systemScope).toBe(1);
        expect(getTenantIsolationStats().bypass).toBe(0);
    });
});

describe("handleModelOperation — http_no_tenant across modes", () => {
    it("observe: reports the violation but still executes and returns data", async () => {
        const query = jest.fn().mockResolvedValue([{ id: 1 }]);
        const result = await run({ origin: "http" }, () =>
            handleModelOperation({ model: TENANT_MODEL, operation: "findMany", args: {}, query }),
        );
        expect(result).toEqual([{ id: 1 }]);
        expect(query).toHaveBeenCalledTimes(1);
        expect(getTenantIsolationStats()).toMatchObject({ violations: 1, violationsByKind: { http_no_tenant: 1 } });
    });

    it("enforce: blocks BEFORE execution and throws TenantIsolationViolationError", async () => {
        setMode("enforce");
        const query = jest.fn().mockResolvedValue([{ id: 1 }]);
        await expect(
            run({ origin: "http" }, () =>
                handleModelOperation({ model: TENANT_MODEL, operation: "findMany", args: {}, query }),
            ),
        ).rejects.toThrow(TenantIsolationViolationError);
        expect(query).not.toHaveBeenCalled();
        expect(getTenantIsolationStats()).toMatchObject({ violations: 1, violationsByKind: { http_no_tenant: 1 } });
    });
});

describe("handleModelOperation — write violations across modes", () => {
    it("observe: unpinned write is reported but EXECUTES normally (never blocks in observe)", async () => {
        const query = jest.fn().mockResolvedValue({ count: 3 });
        const result = await run({ origin: "http", branchId: "b1" }, () =>
            handleModelOperation({
                model: TENANT_MODEL,
                operation: "updateMany",
                args: { where: { id: "x" }, data: {} },
                query,
            }),
        );
        expect(result).toEqual({ count: 3 });
        expect(query).toHaveBeenCalledTimes(1);
        expect(getTenantIsolationStats()).toMatchObject({ violations: 1, violationsByKind: { unpinned_write: 1 } });
    });

    it("enforce: unpinned write is blocked BEFORE execution and throws", async () => {
        setMode("enforce");
        const query = jest.fn().mockResolvedValue({ count: 3 });
        await expect(
            run({ origin: "http", branchId: "b1" }, () =>
                handleModelOperation({
                    model: TENANT_MODEL,
                    operation: "updateMany",
                    args: { where: { id: "x" }, data: {} },
                    query,
                }),
            ),
        ).rejects.toMatchObject({ kind: "unpinned_write", model: TENANT_MODEL, action: "updateMany" });
        expect(query).not.toHaveBeenCalled();
    });

    it("enforce: unpinned create is blocked BEFORE execution and throws", async () => {
        setMode("enforce");
        const query = jest.fn().mockResolvedValue({ id: "x" });
        await expect(
            run({ origin: "http", branchId: "b1" }, () =>
                handleModelOperation({ model: TENANT_MODEL, operation: "create", args: { data: {} }, query }),
            ),
        ).rejects.toMatchObject({ kind: "unpinned_create" });
        expect(query).not.toHaveBeenCalled();
    });
});

describe("handleModelOperation — read violations: execute first, then check, suppress data in enforce", () => {
    it("observe: cross-branch read is reported but the real (leaked) data is still returned", async () => {
        const leaked = [{ branchId: "b1" }, { branchId: "b2" }];
        const query = jest.fn().mockResolvedValue(leaked);
        const result = await run({ origin: "http", branchId: "b1" }, () =>
            handleModelOperation({ model: TENANT_MODEL, operation: "findMany", args: {}, query }),
        );
        expect(result).toBe(leaked);
        expect(query).toHaveBeenCalledTimes(1);
        expect(getTenantIsolationStats()).toMatchObject({
            violations: 1,
            violationsByKind: { cross_branch_read: 1 },
        });
    });

    it("enforce: cross-branch read EXECUTES the fetch (query called) but throws instead of returning data", async () => {
        setMode("enforce");
        const leaked = [{ branchId: "b1" }, { branchId: "b2" }];
        const query = jest.fn().mockResolvedValue(leaked);
        await expect(
            run({ origin: "http", branchId: "b1" }, () =>
                handleModelOperation({ model: TENANT_MODEL, operation: "findMany", args: {}, query }),
            ),
        ).rejects.toMatchObject({ kind: "cross_branch_read" });
        expect(query).toHaveBeenCalledTimes(1); // fetched before the throw
    });

    it("enforce: unpinned_aggregate also executes first, then throws", async () => {
        setMode("enforce");
        const query = jest.fn().mockResolvedValue(42);
        await expect(
            run({ origin: "http", branchId: "b1" }, () =>
                handleModelOperation({ model: TENANT_MODEL, operation: "count", args: {}, query }),
            ),
        ).rejects.toMatchObject({ kind: "unpinned_aggregate" });
        expect(query).toHaveBeenCalledTimes(1);
    });

    it("no violation: read executes and returns normally in every mode", async () => {
        const query = jest.fn().mockResolvedValue([{ branchId: "b1" }]);
        const result = await run({ origin: "http", branchId: "b1" }, () =>
            handleModelOperation({ model: TENANT_MODEL, operation: "findMany", args: {}, query }),
        );
        expect(result).toEqual([{ branchId: "b1" }]);
        expect(getTenantIsolationStats().violations).toBe(0);
    });
});

describe("handleRawOperation — raw_op_in_http_context", () => {
    it("logs when the active store is http-origin (observe)", () => {
        const spy = jest.spyOn(reporter, "reportRawOpInHttpContext");
        run({ origin: "http", branchId: "b1" }, () => handleRawOperation("$queryRaw"));
        expect(spy).toHaveBeenCalledWith("$queryRaw");
    });

    it("logs identically in enforce mode (raw ops are never blocked)", () => {
        setMode("enforce");
        const spy = jest.spyOn(reporter, "reportRawOpInHttpContext");
        run({ origin: "http", branchId: "b1" }, () => handleRawOperation("$executeRawUnsafe"));
        expect(spy).toHaveBeenCalledWith("$executeRawUnsafe");
    });

    it("does NOT log for a system-origin store", () => {
        const spy = jest.spyOn(reporter, "reportRawOpInHttpContext");
        run({ origin: "system", systemScope: true }, () => handleRawOperation("$queryRaw"));
        expect(spy).not.toHaveBeenCalled();
    });

    it("does NOT log with no active store", () => {
        const spy = jest.spyOn(reporter, "reportRawOpInHttpContext");
        handleRawOperation("$queryRaw");
        expect(spy).not.toHaveBeenCalled();
    });

    it("off mode: never logs", () => {
        setMode("off");
        const spy = jest.spyOn(reporter, "reportRawOpInHttpContext");
        run({ origin: "http", branchId: "b1" }, () => handleRawOperation("$queryRaw"));
        expect(spy).not.toHaveBeenCalled();
    });

    it("never blocks or throws, regardless of mode or store", () => {
        setMode("enforce");
        expect(() => run({ origin: "http" }, () => handleRawOperation("$executeRaw"))).not.toThrow();
    });
});

describe("concurrent stores are isolated (real AsyncLocalStorage)", () => {
    it("two concurrent handleModelOperation calls each see their own store's branchId", async () => {
        const seenBranchIds: string[] = [];
        const makeQuery = (branchId: string) =>
            jest.fn().mockImplementation(async () => {
                // Yield to the microtask queue mid-flight to prove ALS isolation survives interleaving.
                await Promise.resolve();
                seenBranchIds.push(branchId);
                return [{ branchId }];
            });

        const [resultA, resultB] = await Promise.all([
            run({ origin: "http", branchId: "branch-a" }, () =>
                handleModelOperation({
                    model: TENANT_MODEL,
                    operation: "findMany",
                    args: {},
                    query: makeQuery("branch-a"),
                }),
            ),
            run({ origin: "http", branchId: "branch-b" }, () =>
                handleModelOperation({
                    model: TENANT_MODEL,
                    operation: "findMany",
                    args: {},
                    query: makeQuery("branch-b"),
                }),
            ),
        ]);

        expect(resultA).toEqual([{ branchId: "branch-a" }]);
        expect(resultB).toEqual([{ branchId: "branch-b" }]);
        expect(seenBranchIds.sort()).toEqual(["branch-a", "branch-b"]);
        // Neither call should be misattributed as a cross-branch read of the other's store.
        expect(getTenantIsolationStats().violations).toBe(0);
    });
});

describe("$transaction passthrough (documented DB-less scope)", () => {
    // A real interactive `$transaction(async (tx) => ...)` re-runs Prisma's own extension query
    // pipeline against the transaction-bound client — that wiring is Prisma's own, not this
    // extension's, and isn't exercisable without a live database in this unit-test harness (see
    // the boot-smoke verification step for the closest we get without one). What IS this
    // extension's responsibility, and what this test proves, is that its decision logic carries
    // no PrismaClient-instance-scoped state: `handleModelOperation` depends only on its
    // parameters and the ambient `tenantContextStore`, so two calls sharing one tenant store
    // (as they would inside one interactive transaction callback) behave independently and
    // correctly — nothing here would change if `query` were transaction-bound instead of a stub.
    it("two operations sharing one tenant store behave independently, with no cross-call state leakage", async () => {
        await run({ origin: "http", branchId: "tx-branch" }, async () => {
            const readQuery = jest.fn().mockResolvedValue([{ branchId: "tx-branch" }]);
            const writeQuery = jest.fn().mockResolvedValue({ branchId: "tx-branch" });

            const readResult = await handleModelOperation({
                model: TENANT_MODEL,
                operation: "findMany",
                args: {},
                query: readQuery,
            });
            const writeResult = await handleModelOperation({
                model: TENANT_MODEL,
                operation: "update",
                args: { where: { branchId: "tx-branch" }, data: { branchId: "tx-branch" } },
                query: writeQuery,
            });

            expect(readResult).toEqual([{ branchId: "tx-branch" }]);
            expect(writeResult).toEqual({ branchId: "tx-branch" });
            expect(readQuery).toHaveBeenCalledTimes(1);
            expect(writeQuery).toHaveBeenCalledTimes(1);
        });
        expect(getTenantIsolationStats().violations).toBe(0);
    });
});

describe("tenantIsolationExtension()", () => {
    it("builds without throwing and returns a Prisma extension function", () => {
        const ext = tenantIsolationExtension();
        expect(typeof ext).toBe("function");
    });
});
