import { MessageTriggerRecipientType, MessageTriggerTemplateKey } from "domain/constants/message-trigger-catalog";
import { MessageTriggerJobEntity } from "domain/entities/message-trigger-job.entity";
import { ReceiptLinkDeliveryEnricher } from "application/services/receipt-link-delivery-enricher.service";
import { SmsTriggerPayloadEnricherRegistry } from "application/services/sms-trigger-payload-enricher.registry";

function makeJob(dedupeKey: string, receiptUrl?: string) {
    return MessageTriggerJobEntity.create({
        branchId: "11111111-1111-1111-1111-111111111111",
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

        expect(issueService.issue).toHaveBeenCalledWith({ branchId: "11111111-1111-1111-1111-111111111111", clientId: 7, source: "auto_trigger", jobId: "job-9" });
        expect(job.payload.templateVariables["receiptUrl"]).toBe("https://m.admin.example/receipt/efr_1");
        expect(job.payload.buttonUrl).toBe("https://m.admin.example/receipt/efr_1");
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
});
