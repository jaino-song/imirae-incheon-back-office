import { ReceiptLinkCleanupSchedulerService } from "application/services/receipt-link-cleanup-scheduler.service";

function makeService(holdsLease = true) {
    const tokenService = {
        collectExpired: jest.fn().mockResolvedValue({ ids: ["a", "b"], orphanStoragePaths: ["receipts/x/1/a.png"] }),
        deleteByIds: jest.fn().mockResolvedValue(2),
    };
    const storage = { delete: jest.fn().mockResolvedValue(undefined) };
    const lease = { holdsLease: () => holdsLease };
    const service = new ReceiptLinkCleanupSchedulerService(tokenService as never, storage as never, lease as never);
    return { service, tokenService, storage };
}

describe("ReceiptLinkCleanupSchedulerService", () => {
    it("deletes orphaned images then the expired rows, using a 1-day cutoff", async () => {
        const { service, tokenService, storage } = makeService();
        const now = new Date("2026-09-03T04:30:00+09:00");
        await service.cleanupExpiredLinks(now);
        expect(tokenService.collectExpired).toHaveBeenCalledWith(new Date(now.getTime() - 24 * 60 * 60 * 1000));
        expect(storage.delete).toHaveBeenCalledWith("receipts/x/1/a.png");
        expect(tokenService.deleteByIds).toHaveBeenCalledWith(["a", "b"]);
    });

    it("keeps going when one storage delete fails", async () => {
        const { service, tokenService, storage } = makeService();
        storage.delete.mockRejectedValueOnce(new Error("not found"));
        await service.cleanupExpiredLinks(new Date());
        expect(tokenService.deleteByIds).toHaveBeenCalled();
    });

    it("does nothing without the scheduler lease", async () => {
        const { service, tokenService } = makeService(false);
        await service.cleanupExpiredLinks(new Date());
        expect(tokenService.collectExpired).not.toHaveBeenCalled();
    });
});
