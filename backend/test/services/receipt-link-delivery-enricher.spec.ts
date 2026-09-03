import { MessageTriggerRecipientType, MessageTriggerTemplateKey } from "domain/constants/message-trigger-catalog";
import { MessageTriggerJobEntity } from "domain/entities/message-trigger-job.entity";
import { ReceiptLinkDeliveryEnricher } from "application/services/receipt-link-delivery-enricher.service";
import { ReceiptLinkSkipError } from "application/services/receipt-link-issue.service";
import { SmsTriggerPayloadEnricherRegistry } from "application/services/sms-trigger-payload-enricher.registry";

function makeJob(dedupeKey: string, receiptUrl?: string, branchId: string | null = "11111111-1111-1111-1111-111111111111") {
    return MessageTriggerJobEntity.create({
        // `create()` treats an omitted branchId as null (see message-trigger-job.entity.ts),
        // so passing `null` here (distinct from the default parameter's "not provided")
        // maps to `undefined` to reach that path — used by the no-branchId test below.
        branchId: branchId ?? undefined,
        ruleId: "system:service_end_notice",
        scheduledFor: new Date(),
        clientId: 7,
        recipientType: MessageTriggerRecipientType.CLIENT,
        recipientPhone: "01012345678",
        templateKey: MessageTriggerTemplateKey.SERVICE_END_NOTICE,
        dedupeKey,
        payload: {
            memberId: "client:7",
            recipientName: "김산모",
            recipientPhone: "01012345678",
            templateVariables: {
                name: "김산모",
                ...(receiptUrl ? { receiptUrl } : {}),
            },
        },
    });
}

describe("ReceiptLinkDeliveryEnricher", () => {
    it("registers itself for SERVICE_END_NOTICE on module init", () => {
        const registry = new SmsTriggerPayloadEnricherRegistry();
        const enricher = new ReceiptLinkDeliveryEnricher(registry, { issue: jest.fn() } as never);
        enricher.onModuleInit();
        expect(registry.get(MessageTriggerTemplateKey.SERVICE_END_NOTICE)).toBe(enricher);
    });

    it("issues a link for the job's client and writes receiptUrl into the payload", async () => {
        const issueService = { issue: jest.fn().mockResolvedValue({ url: "https://m.admin.example/receipt/efr_1", tokenId: "t", expiresAt: new Date() }) };
        const enricher = new ReceiptLinkDeliveryEnricher(new SmsTriggerPayloadEnricherRegistry(), issueService as never);
        const job = makeJob("rule-1:client:7");
        Object.defineProperty(job, "id", { value: "job-9" });

        await enricher.enrich(job);

        expect(issueService.issue).toHaveBeenCalledWith({ branchId: "11111111-1111-1111-1111-111111111111", clientId: 7, source: "auto_trigger", jobId: "job-9", createdBy: null });
        expect(job.payload.templateVariables["receiptUrl"]).toBe("https://m.admin.example/receipt/efr_1");
        expect(job.payload.buttonUrl).toBe("https://m.admin.example/receipt/efr_1");
    });

    it("passes the payload's sentByUserId through as createdBy when present", async () => {
        const issueService = { issue: jest.fn().mockResolvedValue({ url: "u", tokenId: "t", expiresAt: new Date() }) };
        const enricher = new ReceiptLinkDeliveryEnricher(new SmsTriggerPayloadEnricherRegistry(), issueService as never);
        const job = makeJob("rule-1:client:7");
        job.payload.sentByUserId = "user-1";

        await enricher.enrich(job);

        expect(issueService.issue).toHaveBeenCalledWith(expect.objectContaining({ createdBy: "user-1" }));
    });

    it("marks manual sends by their dedupe key", async () => {
        const issueService = { issue: jest.fn().mockResolvedValue({ url: "u", tokenId: "t", expiresAt: new Date() }) };
        const enricher = new ReceiptLinkDeliveryEnricher(new SmsTriggerPayloadEnricherRegistry(), issueService as never);
        await enricher.enrich(makeJob("system:service_end_notice:client:7:manual:abc"));
        expect(issueService.issue).toHaveBeenCalledWith(expect.objectContaining({ source: "manual" }));
    });

    it("passes the payload's existing receiptUrl so a re-run reuses the live token", async () => {
        const issueService = { issue: jest.fn().mockResolvedValue({ url: "https://x/receipt/efr_old", tokenId: "t", expiresAt: new Date() }) };
        const enricher = new ReceiptLinkDeliveryEnricher(new SmsTriggerPayloadEnricherRegistry(), issueService as never);
        const job = makeJob("rule-1:client:7", "https://x/receipt/efr_old");
        Object.defineProperty(job, "id", { value: "job-9" });

        await enricher.enrich(job);

        expect(issueService.issue).toHaveBeenCalledWith(
            expect.objectContaining({ existingUrl: "https://x/receipt/efr_old" }),
        );
    });

    it("rejects with ReceiptLinkSkipError(no_contract_document) when the job has no branchId", async () => {
        const issueService = { issue: jest.fn() };
        const enricher = new ReceiptLinkDeliveryEnricher(new SmsTriggerPayloadEnricherRegistry(), issueService as never);
        const job = makeJob("rule-1:client:7", undefined, null);

        const error: unknown = await enricher.enrich(job).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(ReceiptLinkSkipError);
        expect((error as ReceiptLinkSkipError).skipReason).toBe("no_contract_document");
        expect(issueService.issue).not.toHaveBeenCalled();
    });

    it("propagates issueService.issue failures instead of swallowing them", async () => {
        const issueService = { issue: jest.fn().mockRejectedValue(new Error("boom")) };
        const enricher = new ReceiptLinkDeliveryEnricher(new SmsTriggerPayloadEnricherRegistry(), issueService as never);

        await expect(enricher.enrich(makeJob("rule-1:client:7"))).rejects.toThrow("boom");
    });
});
