import { MessageTriggerRecipientType, MessageTriggerTemplateKey } from "domain/constants/message-trigger-catalog";
import { MessageTriggerJobEntity } from "domain/entities/message-trigger-job.entity";
import {
    SMS_DELIVERY_SNAPSHOT_VARIABLE,
    SmsTriggerDeliveryService,
} from "application/services/sms-trigger-delivery.service";
import {
    SmsTriggerDeliverySkipError,
    SmsTriggerPayloadEnricherRegistry,
} from "application/services/sms-trigger-payload-enricher.registry";
import { ReceiptLinkDeliveryEnricher } from "application/services/receipt-link-delivery-enricher.service";
import { MessageModule } from "module/message.module";
import { MessageTriggerSchedulerService } from "application/services/message-trigger-scheduler.service";

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

type SendSmsJobSpy = { sendSmsJob: (job: MessageTriggerJobEntity, config?: unknown) => Promise<boolean> };

function makeService(registry: SmsTriggerPayloadEnricherRegistry) {
    const aligo = { sendSms: jest.fn() };
    const templates = { getByKey: jest.fn() };
    const logRepository = { create: jest.fn(), update: jest.fn() };
    const service = new SmsTriggerDeliveryService(aligo as never, templates as never, logRepository as never, undefined, registry);
    const sendSmsJob = jest.spyOn(service as unknown as SendSmsJobSpy, "sendSmsJob").mockResolvedValue(true);
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

        // Order-sensitive: capture the value sendSmsJob actually sees at call time, not
        // just the job's final state after sendJob resolves. A naive "call sendSmsJob
        // first, then run the enricher fire-and-forget" implementation would also leave
        // receiptUrl set by the time the outer promise resolves, so asserting only the
        // post-resolution state would pass even with the wrong order.
        let receiptUrlAtSendTime: string | undefined;
        sendSmsJob.mockImplementation(async (jobArg) => {
            receiptUrlAtSendTime = jobArg.payload.templateVariables["receiptUrl"];
            return true;
        });

        await expect(service.sendJob(job)).resolves.toBe(true);
        expect(receiptUrlAtSendTime).toBe("https://m.admin.example/receipt/efr_x");
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

    // F3: pin per-template routing. registry.get(job.templateKey) must dispatch by the JOB's
    // own template key, never a hardcoded one — a mutant that hardcodes SERVICE_END_NOTICE
    // would still pass every other test in this file (they all dispatch SERVICE_END_NOTICE
    // jobs) but would wrongly run the SERVICE_END_NOTICE enricher for a THANKS-keyed job.
    it("does not invoke an enricher registered under a different template key than the job's own", async () => {
        const registry = new SmsTriggerPayloadEnricherRegistry();
        const enrich = jest.fn();
        registry.register(MessageTriggerTemplateKey.SERVICE_END_NOTICE, { enrich });
        const { service, sendSmsJob } = makeService(registry);

        const thanksJob = MessageTriggerJobEntity.create({
            branchId: "11111111-1111-1111-1111-111111111111",
            ruleId: "system:thanks",
            scheduledFor: new Date(),
            clientId: 7,
            recipientType: MessageTriggerRecipientType.CLIENT,
            recipientPhone: "01012345678",
            templateKey: MessageTriggerTemplateKey.THANKS,
            dedupeKey: "system:thanks:client:7",
            payload: { memberId: "client:7", recipientName: "김산모", recipientPhone: "01012345678", templateVariables: {} },
        });

        await expect(service.sendJob(thanksJob)).resolves.toBe(true);

        expect(enrich).not.toHaveBeenCalled();
        expect(sendSmsJob).toHaveBeenCalledTimes(1);
    });

    // Fix round 1, item (A): an agent-approved retry (message-external-agent-capabilities.provider.ts)
    // stages a serialized, already-approved snapshot into templateVariables[SMS_DELIVERY_SNAPSHOT_VARIABLE]
    // with no template-key filter (findRetryableJob applies none). Enriching such a job would mutate
    // templateVariables after that snapshot was hashed and approved, making resolveDeliverySnapshot's
    // staged-vs-canonical hash comparison reject with "changed after staging" and the provider never
    // called. Mutating enrichment must not run for a staged snapshot, but the exact approved
    // receipt capability still needs a read-only liveness check immediately before dispatch.
    it("skips mutating enrichment and validates a staged delivery snapshot", async () => {
        const registry = new SmsTriggerPayloadEnricherRegistry();
        const enrich = jest.fn(async (job: MessageTriggerJobEntity) => {
            job.payload.templateVariables["receiptUrl"] = "https://should-not-run.example/receipt";
        });
        const validateStagedSnapshot = jest.fn().mockResolvedValue(undefined);
        registry.register(MessageTriggerTemplateKey.SERVICE_END_NOTICE, { enrich, validateStagedSnapshot });
        const { service, sendSmsJob } = makeService(registry);
        const job = makeJob();
        job.payload.templateVariables[SMS_DELIVERY_SNAPSHOT_VARIABLE] = JSON.stringify({ staged: true });

        await expect(service.sendJob(job)).resolves.toBe(true);

        expect(enrich).not.toHaveBeenCalled();
        expect(validateStagedSnapshot).toHaveBeenCalledWith(job);
        expect(job.payload.templateVariables["receiptUrl"]).toBeUndefined();
        expect(sendSmsJob).toHaveBeenCalledTimes(1);
    });

    it("cancels a staged SERVICE_END_NOTICE retry when its approved receipt link was revoked", async () => {
        const registry = new SmsTriggerPayloadEnricherRegistry();
        const tokenService = { getStatus: jest.fn().mockResolvedValue({ ok: false, reason: "revoked" }) };
        const enricher = new ReceiptLinkDeliveryEnricher(
            registry,
            { issue: jest.fn() } as never,
            tokenService as never,
        );
        enricher.onModuleInit();
        const { service, sendSmsJob, aligo } = makeService(registry);
        const job = makeJob();
        job.payload.templateVariables["receiptUrl"] = "https://m.admin.example/receipt/efr_revoked";
        job.payload.templateVariables[SMS_DELIVERY_SNAPSHOT_VARIABLE] = JSON.stringify({ staged: true });

        await expect(service.sendJob(job)).resolves.toBe(false);

        expect(tokenService.getStatus).toHaveBeenCalledWith("efr_revoked", expect.any(Date));
        expect(job.status).toBe("canceled");
        expect(sendSmsJob).not.toHaveBeenCalled();
        expect(aligo.sendSms).not.toHaveBeenCalled();
    });

    it("cancels a staged SERVICE_END_NOTICE retry when receipt validation is unavailable", async () => {
        const { service, sendSmsJob, aligo } = makeService(new SmsTriggerPayloadEnricherRegistry());
        const job = makeJob();
        job.payload.templateVariables["receiptUrl"] = "https://m.admin.example/receipt/efr_unchecked";
        job.payload.templateVariables[SMS_DELIVERY_SNAPSHOT_VARIABLE] = JSON.stringify({ staged: true });

        await expect(service.sendJob(job)).resolves.toBe(false);

        expect(job.status).toBe("canceled");
        expect(sendSmsJob).not.toHaveBeenCalled();
        expect(aligo.sendSms).not.toHaveBeenCalled();
    });
});

// Fix round 1, item (B): the enricher hook runs before sendSmsJob's duplicate-dispatch convergence
// check (the acceptance-service race where a second concurrent dispatch for the same job converges
// on an already-accepted durable row instead of crossing the provider boundary again). That
// convergence check requires a fully resolved delivery snapshot (buildSmsLog needs snapshot.message,
// snapshot.receiver, etc. to construct the MessageLogEntity that prepare()/prepareProviderAttempt
// converges on), and resolving the snapshot is exactly what enrichment feeds into (e.g. receiptUrl is
// a required template variable) — so the convergence decision cannot be made without first resolving
// what the enricher produces. No cheaper, snapshot-independent "has this job.id already converged"
// lookup exists on IMessageLogRepository, and adding one is outside this task's Paths (registry file,
// this delivery service's constructor/sendJob/one helper, message.module.ts, this spec only).
// Chosen branch: (b) — leave the order as-is (enrich() runs before the convergence check can be
// evaluated) and require enrich() to be idempotent per job.id instead (documented on the
// SmsTriggerPayloadEnricher interface). This test pins that chosen behaviour: the enricher runs even
// for a dispatch that ultimately converges onto an earlier accepted attempt and never reaches the
// provider. Task 2.4's enricher must make its own side effect idempotent per job.id (e.g. upsert /
// find-or-create the receipt link), not conditional on whether the SMS is actually sent.
describe("SmsTriggerDeliveryService.sendJob enricher vs duplicate-dispatch convergence", () => {
    it("still invokes the enricher for a dispatch that converges onto an already-accepted attempt", async () => {
        const registry = new SmsTriggerPayloadEnricherRegistry();
        const enrich = jest.fn(async (job: MessageTriggerJobEntity) => {
            job.payload.templateVariables["receiptUrl"] = "https://m.admin.example/receipt/efr_x";
        });
        registry.register(MessageTriggerTemplateKey.SERVICE_END_NOTICE, { enrich });

        const aligo = { sendSms: jest.fn() };
        // No override configured: resolveSystemTemplate falls back to the registry default
        // content/required-variable set for SERVICE_END_NOTICE (name, receiptUrl).
        const templates = { getByKey: jest.fn().mockRejectedValue(new Error("no template override in this test")) };
        const logRepository = {
            // Simulates a concurrent dispatch that already converged: the persisted row comes
            // back as a different object (already "accepted") rather than the same pendingAttempt
            // reference, which is exactly the signal sendSmsJob's convergence check reads.
            save: jest.fn().mockImplementation(async (log: Record<string, unknown>) => ({
                ...log,
                providerAcceptanceState: "accepted",
            })),
            update: jest.fn(),
        };
        const service = new SmsTriggerDeliveryService(aligo as never, templates as never, logRepository as never, undefined, registry);
        const job = makeJob();

        await expect(service.sendJob(job)).resolves.toBe(true);

        expect(enrich).toHaveBeenCalledTimes(1);
        expect(aligo.sendSms).not.toHaveBeenCalled();
    });
});

describe("MessageModule providers/exports", () => {
    // MessageModule cannot be compiled in isolation with Test.createTestingModule without heavy
    // overrides: it transitively needs SchedulerLeaseModule, DatabaseModule, and a TenantContext
    // provider (from a global guard chain) that this unit test has no reason to stand up. Asserting
    // the module's own @Module metadata instead still catches the regression this test exists for:
    // deleting SmsTriggerPayloadEnricherRegistry from providers/exports, or MessageTriggerSchedulerService
    // from exports, cannot pass silently.
    it("declares SmsTriggerPayloadEnricherRegistry as a provider and export, and MessageTriggerSchedulerService as an export", () => {
        const providers = Reflect.getMetadata("providers", MessageModule) as unknown[];
        const moduleExports = Reflect.getMetadata("exports", MessageModule) as unknown[];

        expect(providers).toContain(SmsTriggerPayloadEnricherRegistry);
        expect(providers).toContain(SmsTriggerDeliveryService);
        expect(moduleExports).toContain(SmsTriggerPayloadEnricherRegistry);
        expect(moduleExports).toContain(MessageTriggerSchedulerService);
    });
});
