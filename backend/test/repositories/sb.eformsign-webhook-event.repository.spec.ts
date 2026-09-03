import { EFORMSIGN_WEBHOOK_OUTCOME } from "domain/constants/eformsign-webhook-outcome.constants";
import { SbEformsignWebhookEventRepository } from "infrastructure/database/repositories/sb.eformsign-webhook-event.repository";

/**
 * The date predicates live here now, not in EformsignWebhookEventWriter. The
 * writer swallows failures, so a wrong window or a wrong comparison would show
 * up as a quietly empty ledger rather than an error.
 */
describe("SbEformsignWebhookEventRepository", () => {
    const create = jest.fn();
    const groupBy = jest.fn();
    const deleteMany = jest.fn();
    const prisma = { eformsign_webhook_event: { create, groupBy, deleteMany } };

    let repository: SbEformsignWebhookEventRepository;

    beforeEach(() => {
        repository = new SbEformsignWebhookEventRepository(prisma as never);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it("inserts the row it was handed, unchanged", async () => {
        const row = {
            webhookId: "hook-1",
            eventType: "document_completed",
            companyId: "company-1",
            documentId: "doc-1",
            rawStatus: "완료",
            statusType: "060",
            statusDetail: "060",
            sourceUpdatedDate: new Date("2026-09-03T09:00:00.000Z"),
            outcome: EFORMSIGN_WEBHOOK_OUTCOME.APPLIED,
            outcomeReason: null,
        };

        await repository.append(row);

        expect(create).toHaveBeenCalledWith({ data: row });
    });

    it("tallies outcomes at or after the window start", async () => {
        const since = new Date("2026-09-02T00:00:00.000Z");
        groupBy.mockResolvedValue([
            { outcome: EFORMSIGN_WEBHOOK_OUTCOME.APPLIED, _count: { _all: 7 } },
            { outcome: EFORMSIGN_WEBHOOK_OUTCOME.DOCUMENT_NOT_FOUND, _count: { _all: 1 } },
        ]);

        await expect(repository.countByOutcomeSince(since)).resolves.toEqual([
            { outcome: EFORMSIGN_WEBHOOK_OUTCOME.APPLIED, count: 7 },
            { outcome: EFORMSIGN_WEBHOOK_OUTCOME.DOCUMENT_NOT_FOUND, count: 1 },
        ]);
        expect(groupBy).toHaveBeenCalledWith({
            by: ["outcome"],
            where: { createdAt: { gte: since } },
            _count: { _all: true },
        });
    });

    it("deletes strictly before the cutoff and reports the count", async () => {
        const cutoff = new Date("2026-06-05T00:00:00.000Z");
        deleteMany.mockResolvedValue({ count: 42 });

        await expect(repository.deleteOlderThan(cutoff)).resolves.toBe(42);

        expect(deleteMany).toHaveBeenCalledWith({ where: { createdAt: { lt: cutoff } } });
    });
});
