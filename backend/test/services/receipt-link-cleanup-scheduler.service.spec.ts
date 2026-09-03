import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ReceiptLinkCleanupSchedulerService } from "application/services/receipt-link-cleanup-scheduler.service";

function makeService(holdsLease = true) {
    const tokenService = {
        collectExpired: jest.fn().mockResolvedValue({ ids: ["a", "b"], orphanStoragePaths: ["receipts/x/1/a.png", "receipts/x/2/b.png"] }),
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
        expect(storage.delete.mock.calls).toEqual([["receipts/x/1/a.png"], ["receipts/x/2/b.png"]]);
        expect(tokenService.deleteByIds).toHaveBeenCalledWith(["a", "b"]);
        // Objects before rows: a crash between the two must leave rows for the next sweep to retry.
        const [storageOrder] = storage.delete.mock.invocationCallOrder;
        const [rowsOrder] = tokenService.deleteByIds.mock.invocationCallOrder;
        expect(storageOrder).toBeDefined();
        expect(rowsOrder).toBeDefined();
        expect(storageOrder!).toBeLessThan(rowsOrder!);
    });

    // M3: a storage-delete failure must not orphan the PNG by deleting its row anyway — the
    // row(s) referencing the still-undeleted object must linger so the next sweep can retry.
    // collectExpired() exposes no per-id storagePath, so a failure cannot be attributed to a
    // single id; the whole batch is withheld instead of deleted.
    // The fixture carries two paths and only the SECOND delete fails, so this test can tell
    // "withhold on any failure" apart from "withhold only when nothing was deleted": a partial
    // success must still withhold every row.
    it("keeps going when one storage delete fails, and withholds the batch's rows so the next sweep retries", async () => {
        const { service, tokenService, storage } = makeService();
        storage.delete.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("not found"));
        const logSpy = jest.spyOn(service["logger"], "log").mockImplementation(() => undefined);
        await service.cleanupExpiredLinks(new Date());
        expect(storage.delete.mock.calls).toEqual([["receipts/x/1/a.png"], ["receipts/x/2/b.png"]]);
        expect(tokenService.deleteByIds).toHaveBeenCalledWith([]);
        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("1 images"));
    });

    it("does nothing without the scheduler lease", async () => {
        const { service, tokenService } = makeService(false);
        await service.cleanupExpiredLinks(new Date());
        expect(tokenService.collectExpired).not.toHaveBeenCalled();
    });

    // M6: pin the cron schedule (nightly 04:30 KST) — consistent with
    // scheduler-lease.drift.spec.ts's source-text approach for scheduler declarations.
    it("runs on the literal schedule 30 4 * * * in Asia/Seoul", () => {
        const source = readFileSync(
            join(__dirname, "../../application/services/receipt-link-cleanup-scheduler.service.ts"),
            "utf8",
        );
        expect(source).toContain('@Cron("30 4 * * *", { timeZone: "Asia/Seoul" })');
    });
});
