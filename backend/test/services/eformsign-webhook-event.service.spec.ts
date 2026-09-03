import { Logger } from "@nestjs/common";

import { EformsignWebhookEventWriter } from "application/services/eformsign-webhook-event.service";
import { EFORMSIGN_WEBHOOK_OUTCOME } from "domain/constants/eformsign-webhook-outcome.constants";

describe("EformsignWebhookEventWriter", () => {
    const append = jest.fn();
    const countByOutcomeSince = jest.fn();
    const deleteOlderThan = jest.fn();
    const repository = { append, countByOutcomeSince, deleteOlderThan };

    let writer: EformsignWebhookEventWriter;

    beforeEach(() => {
        jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
        writer = new EformsignWebhookEventWriter(repository);
        append.mockResolvedValue(undefined);
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
        append.mockRejectedValue(new Error("relation does not exist"));

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

        const data = append.mock.calls[0][0];
        expect(data.outcomeReason).toHaveLength(500);
        expect(data.rawStatus).toHaveLength(120);
    });

    it("stores blank and missing values as null", async () => {
        await writer.append({
            documentId: "  ",
            webhookId: undefined,
            outcome: EFORMSIGN_WEBHOOK_OUTCOME.MISSING_DOCUMENT_ID,
        });

        const data = append.mock.calls[0][0];
        expect(data.documentId).toBeNull();
        expect(data.webhookId).toBeNull();
        expect(data.sourceUpdatedDate).toBeNull();
    });

    it("counts every outcome as received and only the dropped ones as dropped", async () => {
        countByOutcomeSince.mockResolvedValue([
            { outcome: EFORMSIGN_WEBHOOK_OUTCOME.APPLIED, count: 7 },
            { outcome: EFORMSIGN_WEBHOOK_OUTCOME.COMPLETION_CLAIMED, count: 2 },
            { outcome: EFORMSIGN_WEBHOOK_OUTCOME.IGNORED_STALE_MIRROR, count: 3 },
            { outcome: EFORMSIGN_WEBHOOK_OUTCOME.DOCUMENT_NOT_FOUND, count: 1 },
        ]);

        await expect(writer.countSince(new Date("2026-09-02T00:00:00.000Z")))
            .resolves.toEqual({ received: 13, dropped: 4 });
    });

    /** The settings page must render even when this query cannot run. */
    it("reports zeroes rather than throwing when the count fails", async () => {
        countByOutcomeSince.mockRejectedValue(new Error("timeout"));

        await expect(writer.countSince(new Date())).resolves.toEqual({ received: 0, dropped: 0 });
    });

    it("reports how many rows the purge removed", async () => {
        deleteOlderThan.mockResolvedValue(42);
        const cutoff = new Date("2026-06-05T00:00:00.000Z");

        await expect(writer.purgeOlderThan(cutoff)).resolves.toBe(42);
        expect(deleteOlderThan).toHaveBeenCalledWith(cutoff);
    });
});
