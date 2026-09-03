import { Logger } from "@nestjs/common";

import { EformsignWebhookEventWriter } from "application/services/eformsign-webhook-event.service";
import { EFORMSIGN_WEBHOOK_OUTCOME } from "domain/constants/eformsign-webhook-outcome.constants";

describe("EformsignWebhookEventWriter", () => {
    const create = jest.fn();
    const groupBy = jest.fn();
    const deleteMany = jest.fn();
    const prisma = { eformsign_webhook_event: { create, groupBy, deleteMany } };

    let writer: EformsignWebhookEventWriter;

    beforeEach(() => {
        jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
        writer = new EformsignWebhookEventWriter(prisma as never);
        create.mockResolvedValue(undefined);
    });

    afterEach(() => {
        jest.clearAllMocks();
        jest.restoreAllMocks();
    });

    /**
     * The ledger exists to explain webhooks, never to cost one. eformsign
     * retries or fails a delivery it cannot get a 200 for, so a bookkeeping
     * error must not reach the caller.
     */
    it("never throws when the insert fails", async () => {
        create.mockRejectedValue(new Error("relation does not exist"));

        await expect(
            writer.append({ documentId: "doc-1", outcome: EFORMSIGN_WEBHOOK_OUTCOME.APPLIED }),
        ).resolves.toBeUndefined();
    });

    /**
     * outcome_reason is VARCHAR(500) and append swallows throws, so an
     * over-long reason would silently cost the whole row rather than its tail.
     */
    it("clips values to their column widths instead of losing the row", async () => {
        await writer.append({
            documentId: "doc-1",
            outcome: EFORMSIGN_WEBHOOK_OUTCOME.ERROR,
            outcomeReason: "x".repeat(900),
            rawStatus: "y".repeat(400),
        });

        const data = create.mock.calls[0][0].data;
        expect(data.outcomeReason).toHaveLength(500);
        expect(data.rawStatus).toHaveLength(120);
    });

    it("stores blank and missing values as null", async () => {
        await writer.append({
            documentId: "  ",
            webhookId: undefined,
            outcome: EFORMSIGN_WEBHOOK_OUTCOME.MISSING_DOCUMENT_ID,
        });

        const data = create.mock.calls[0][0].data;
        expect(data.documentId).toBeNull();
        expect(data.webhookId).toBeNull();
        expect(data.sourceUpdatedDate).toBeNull();
    });

    it("counts every outcome as received and only the dropped ones as dropped", async () => {
        groupBy.mockResolvedValue([
            { outcome: EFORMSIGN_WEBHOOK_OUTCOME.APPLIED, _count: { _all: 7 } },
            { outcome: EFORMSIGN_WEBHOOK_OUTCOME.COMPLETION_CLAIMED, _count: { _all: 2 } },
            { outcome: EFORMSIGN_WEBHOOK_OUTCOME.IGNORED_STALE_MIRROR, _count: { _all: 3 } },
            { outcome: EFORMSIGN_WEBHOOK_OUTCOME.DOCUMENT_NOT_FOUND, _count: { _all: 1 } },
        ]);

        await expect(writer.countSince(new Date("2026-09-02T00:00:00.000Z")))
            .resolves.toEqual({ received: 13, dropped: 4 });
    });

    /** The settings page must render even when this query cannot run. */
    it("reports zeroes rather than throwing when the count fails", async () => {
        groupBy.mockRejectedValue(new Error("timeout"));

        await expect(writer.countSince(new Date())).resolves.toEqual({ received: 0, dropped: 0 });
    });

    it("purges by created_at and reports how many rows went", async () => {
        deleteMany.mockResolvedValue({ count: 42 });
        const cutoff = new Date("2026-06-05T00:00:00.000Z");

        await expect(writer.purgeOlderThan(cutoff)).resolves.toBe(42);
        expect(deleteMany).toHaveBeenCalledWith({ where: { createdAt: { lt: cutoff } } });
    });
});
