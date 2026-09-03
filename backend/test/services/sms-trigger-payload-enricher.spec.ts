import { MessageTriggerRecipientType, MessageTriggerTemplateKey } from "domain/constants/message-trigger-catalog";
import { MessageTriggerJobEntity } from "domain/entities/message-trigger-job.entity";
import { SmsTriggerDeliveryService } from "application/services/sms-trigger-delivery.service";
import {
    SmsTriggerDeliverySkipError,
    SmsTriggerPayloadEnricherRegistry,
} from "application/services/sms-trigger-payload-enricher.registry";

function makeJob(): MessageTriggerJobEntity {
    return MessageTriggerJobEntity.create({
        branchId: "11111111-1111-1111-1111-111111111111",
        ruleId: "system:service_end_notice",
        scheduledFor: new Date(),
        clientId: 7,
        recipientType: MessageTriggerRecipientType.CLIENT,
        recipientPhone: "01012345678",
        templateKey: MessageTriggerTemplateKey.SERVICE_END_NOTICE,
        dedupeKey: "system:service_end_notice:client:7",
        payload: { memberId: "client:7", recipientName: "김산모", recipientPhone: "01012345678", templateVariables: { name: "김산모" } },
    });
}

function makeService(registry: SmsTriggerPayloadEnricherRegistry) {
    const aligo = { sendSms: jest.fn() };
    const templates = { getByKey: jest.fn() };
    const logRepository = { create: jest.fn(), update: jest.fn() };
    const service = new SmsTriggerDeliveryService(aligo as never, templates as never, logRepository as never, undefined, registry);
    const sendSmsJob = jest.spyOn(service as unknown as { sendSmsJob: () => Promise<boolean> }, "sendSmsJob").mockResolvedValue(true);
    return { service, sendSmsJob, aligo };
}

describe("SmsTriggerPayloadEnricherRegistry", () => {
    it("registers one enricher per template key", () => {
        const registry = new SmsTriggerPayloadEnricherRegistry();
        const enricher = { enrich: jest.fn() };
        registry.register(MessageTriggerTemplateKey.SERVICE_END_NOTICE, enricher);
        expect(registry.get(MessageTriggerTemplateKey.SERVICE_END_NOTICE)).toBe(enricher);
        expect(registry.get(MessageTriggerTemplateKey.THANKS)).toBeNull();
        expect(() => registry.register(MessageTriggerTemplateKey.SERVICE_END_NOTICE, enricher)).toThrow(/already registered/);
    });
});

describe("SmsTriggerDeliveryService.sendJob with enrichers", () => {
    it("runs the enricher before sending so it can fill template variables", async () => {
        const registry = new SmsTriggerPayloadEnricherRegistry();
        registry.register(MessageTriggerTemplateKey.SERVICE_END_NOTICE, {
            enrich: async (job) => {
                job.payload.templateVariables["receiptUrl"] = "https://m.admin.example/receipt/efr_x";
            },
        });
        const { service, sendSmsJob } = makeService(registry);
        const job = makeJob();

        await expect(service.sendJob(job)).resolves.toBe(true);
        expect(job.payload.templateVariables["receiptUrl"]).toBe("https://m.admin.example/receipt/efr_x");
        expect(sendSmsJob).toHaveBeenCalledTimes(1);
    });

    it("cancels the job with the skip reason when the enricher throws SmsTriggerDeliverySkipError", async () => {
        const registry = new SmsTriggerPayloadEnricherRegistry();
        registry.register(MessageTriggerTemplateKey.SERVICE_END_NOTICE, {
            enrich: async () => {
                throw new SmsTriggerDeliverySkipError("not_voucher_client", "바우처 이용 산모가 아닙니다");
            },
        });
        const { service, sendSmsJob, aligo } = makeService(registry);
        const job = makeJob();

        await expect(service.sendJob(job)).resolves.toBe(false);
        expect(job.status).toBe("canceled");
        expect(job.cancelReason).toBe("메시지 발송 건너뜀: 바우처 이용 산모가 아닙니다");
        expect(sendSmsJob).not.toHaveBeenCalled();
        expect(aligo.sendSms).not.toHaveBeenCalled();
    });

    it("sends normally when no enricher is registered for the template", async () => {
        const { service, sendSmsJob } = makeService(new SmsTriggerPayloadEnricherRegistry());
        await expect(service.sendJob(makeJob())).resolves.toBe(true);
        expect(sendSmsJob).toHaveBeenCalledTimes(1);
    });
});
