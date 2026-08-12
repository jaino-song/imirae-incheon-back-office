import {
    EformsignOperationAlreadyRunningError,
    EformsignOperationLockService,
    EformsignOperationLockUnavailableError,
} from "infrastructure/locking/eformsign-operation-lock.service";

describe("EformsignOperationLockService", () => {
    it("serializes the same operation key when Valkey is unavailable locally", async () => {
        const service = new EformsignOperationLockService(null);
        let releaseFirst: (() => void) | undefined;
        const blocker = new Promise<void>((resolve) => {
            releaseFirst = resolve;
        });
        const first = service.runExclusive("create:branch-1:client-1", async (lease) => {
            expect(lease.isHeld()).toBe(true);
            await blocker;
            return "first";
        });

        await expect(service.runExclusive(
            "create:branch-1:client-1",
            async () => "duplicate",
        )).rejects.toBeInstanceOf(EformsignOperationAlreadyRunningError);

        releaseFirst?.();
        await expect(first).resolves.toBe("first");
        await expect(service.runExclusive(
            "create:branch-1:client-1",
            async () => "next",
        )).resolves.toBe("next");
    });

    it("allows unrelated operation keys to run independently", async () => {
        const service = new EformsignOperationLockService(null);

        await expect(Promise.all([
            service.runExclusive("create:branch-1:client-1", async () => "create"),
            service.runExclusive("finalize:doc-1", async () => "finalize"),
        ])).resolves.toEqual(["create", "finalize"]);
    });

    it("rejects a duplicate operation held by another server", async () => {
        const redis = {
            status: "ready",
            connect: jest.fn(),
            disconnect: jest.fn(),
            set: jest.fn().mockResolvedValue(null),
            eval: jest.fn(),
        };
        const service = new EformsignOperationLockService(redis);

        await expect(service.runExclusive(
            "finalize:doc-1",
            async () => "duplicate",
        )).rejects.toBeInstanceOf(EformsignOperationAlreadyRunningError);
    });

    it("fails closed when the distributed lock cannot be acquired", async () => {
        const redis = {
            status: "ready",
            connect: jest.fn(),
            disconnect: jest.fn(),
            set: jest.fn().mockRejectedValue(new Error("connection reset")),
            eval: jest.fn(),
        };
        const service = new EformsignOperationLockService(redis);

        await expect(service.runExclusive(
            "create:branch-1:client-1",
            async () => "unsafe-create",
        )).rejects.toBeInstanceOf(EformsignOperationLockUnavailableError);
    });
});
