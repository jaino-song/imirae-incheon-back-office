import { NotFoundException } from "@nestjs/common";

import { MessageTriggerEventType, MessageTriggerOffsetType, MessageTriggerRecipientType, MessageTriggerTemplateKey } from "domain/constants/message-trigger-catalog";
import { MessageTriggerJobEntity } from "domain/entities/message-trigger-job.entity";
import { MessageTriggerRuleEntity } from "domain/entities/message-trigger-rule.entity";

import { MessageExternalAgentCapabilitiesProvider } from "./message-external-agent-capabilities.provider";

const principal = { userId: "user-a", branchId: "branch-a", globalRole: "admin", branchRole: "admin" };
const context = { principal, sessionId: "session-a", traceId: "trace-a", locale: "ko", actionId: "action-a" };

function terminalJob(overrides: Partial<MessageTriggerJobEntity> = {}): MessageTriggerJobEntity {
    const now = new Date("2026-08-03T00:00:00.000Z");
    return Object.assign(MessageTriggerJobEntity.reconstitute(
        "job-a",
        principal.branchId,
        "rule-a",
        "failed",
        now,
        null,
        null,
        "provider rejected",
        1,
        null,
        MessageTriggerRecipientType.CLIENT,
        "01012345678",
        MessageTriggerTemplateKey.INFO,
        "source-dedupe",
        {
            memberId: "client-1",
            recipientName: "수신자",
            recipientPhone: "01012345678",
            messageBody: "안내",
            templateVariables: { retrySafety: "provider-rejected", msgType: "SMS" },
        },
        now,
        now,
    ), overrides);
}

describe("MessageExternalAgentCapabilitiesProvider", () => {
    function setup(source = terminalJob()) {
        const now = new Date("2026-08-03T00:00:00.000Z");
        const rule = MessageTriggerRuleEntity.reconstitute(
            "rule-a", principal.branchId, "시작 알림", true,
            MessageTriggerEventType.SERVICE_START, MessageTriggerOffsetType.BEFORE_DAYS, 1,
            MessageTriggerRecipientType.CLIENT, MessageTriggerTemplateKey.SERVICE_START_REMINDER,
            now, now,
        );
        const repository = {
            findHistoryByBranch: jest.fn().mockResolvedValue([source]),
            findById: jest.fn().mockResolvedValue(source),
            upsertPending: jest.fn().mockImplementation(async (candidate: MessageTriggerJobEntity) => Object.assign(candidate, { id: "retry-job" })),
        };
        const delivery = {
            dispatchPendingJobNow: jest.fn().mockResolvedValue({ status: "sent" }),
            listRules: jest.fn().mockResolvedValue([rule]),
            getRule: jest.fn().mockResolvedValue(rule),
            createRule: jest.fn().mockResolvedValue(rule),
            updateRule: jest.fn().mockImplementation(async (_branchId, _id, updates) => Object.assign(rule, updates)),
            deleteRule: jest.fn().mockResolvedValue(undefined),
        };
        let effectReceipt: unknown = null;
        const prisma = {
            agent_action: {
                updateMany: jest.fn().mockImplementation(async ({ data }) => {
                    effectReceipt = data.effectReceipt;
                    return { count: 1 };
                }),
                findFirst: jest.fn().mockImplementation(async () => ({ effectReceipt })),
            },
            message_trigger_rule: { upsert: jest.fn().mockResolvedValue(undefined) },
            message_trigger_job: { findFirst: jest.fn().mockResolvedValue(null) },
        };
        const provider = new MessageExternalAgentCapabilitiesProvider(prisma as never, delivery as never, repository as never);
        const capabilities = provider.getCapabilities();
        return { repository, delivery, prisma, capabilities };
    }

    it("lists only terminal jobs through the branch-scoped repository boundary", async () => {
        const { repository, capabilities } = setup();
        const capability = capabilities.find((entry) => entry.meta.name === "messages.deliveryHistory");

        const result = await capability!.execute(context, { limit: 12 }) as { jobs: Array<{ id: string; status: string }> };

        expect(repository.findHistoryByBranch).toHaveBeenCalledWith(principal.branchId, 13, undefined);
        expect(result.jobs).toEqual([expect.objectContaining({ id: "job-a", status: "failed" })]);
        expect(result.jobs[0]).toEqual(expect.objectContaining({ receiver: "••••5678" }));
    });

    it("enforces the scheduled SMS minimum lead time in the capability schema", () => {
        const { capabilities } = setup();
        const schedule = capabilities.find((entry) => entry.meta.name === "messages.scheduleSms")!;
        const soon = new Date(Date.now() + 5 * 60 * 1000);
        const date = soon.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
        const time = soon.toLocaleTimeString("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit" });

        expect(schedule.inputSchema.safeParse({ receiver: "01012345678", message: "안내", scheduledDate: date, scheduledTime: time }).success).toBe(false);
    });

    it("rejects impossible calendar dates and normalized out-of-range times", () => {
        const { capabilities } = setup();
        const schedule = capabilities.find((entry) => entry.meta.name === "messages.scheduleSms")!;
        const base = { receiver: "01012345678", message: "안내" };

        expect(schedule.inputSchema.safeParse({ ...base, scheduledDate: "2030-02-30", scheduledTime: "12:00" }).success).toBe(false);
        expect(schedule.inputSchema.safeParse({ ...base, scheduledDate: "2030-03-01", scheduledTime: "24:00" }).success).toBe(false);
    });

    it("discloses and records the LMS type used by the INFO delivery template", async () => {
        const { capabilities } = setup();
        const preview = capabilities.find((entry) => entry.meta.name === "messages.previewSms")!;
        const send = capabilities.find((entry) => entry.meta.name === "messages.sendSms")!;
        const input = { receiver: "01012345678", message: "짧은 안내" };

        await expect(preview.execute(context, input)).resolves.toEqual({ status: "preview", msgType: "LMS" });
        await expect(send.inspect!(context, input)).resolves.toEqual(expect.objectContaining({ estimatedCost: "LMS 요금제 기준" }));
        await expect(send.execute(context, input)).resolves.toEqual(expect.objectContaining({ status: "sent", msgType: "LMS" }));
    });

    it("creates one action-keyed retry only for an explicitly provider-rejected job", async () => {
        const { repository, delivery, capabilities } = setup();
        const capability = capabilities.find((entry) => entry.meta.name === "messages.retrySms");

        const inspection = await capability!.inspect!(context, { jobId: "job-a" });
        const result = await capability!.execute(context, { jobId: "job-a" }) as { status: string; jobId: string };

        expect(inspection.targetVersion).toHaveLength(64);
        expect(repository.upsertPending).toHaveBeenCalledWith(expect.objectContaining({
            branchId: principal.branchId,
            dedupeKey: `agent-sms-retry:${context.actionId}`,
            status: "pending",
        }));
        expect(delivery.dispatchPendingJobNow).toHaveBeenCalledWith("retry-job");
        expect(result).toEqual({ status: "sent", jobId: "retry-job" });
    });

    it("refuses retry when provider rejection or current-branch ownership cannot be proven", async () => {
        const unsafe = terminalJob({ branchId: "branch-b" });
        unsafe.payload.templateVariables["retrySafety"] = "uncertain";
        const { repository, capabilities } = setup(unsafe);
        const capability = capabilities.find((entry) => entry.meta.name === "messages.retrySms");

        await expect(capability!.inspect!(context, { jobId: unsafe.id })).rejects.toThrow("not safely retryable");
        expect(repository.upsertPending).not.toHaveBeenCalled();
    });

    it("uses the canonical automation service for branch-scoped lifecycle operations", async () => {
        const { delivery, capabilities } = setup();
        const list = capabilities.find((entry) => entry.meta.name === "automation.list");
        const setActive = capabilities.find((entry) => entry.meta.name === "automation.setActive");

        const listed = await list!.execute(context, {}) as { rules: Array<{ id: string }> };
        const inspection = await setActive!.inspect!(context, { id: "rule-a", isActive: false });
        const updated = await setActive!.execute(context, { id: "rule-a", isActive: false }) as { isActive: boolean };

        expect(delivery.listRules).toHaveBeenCalledWith(principal.branchId);
        expect(listed.rules).toEqual([expect.objectContaining({ id: "rule-a" })]);
        expect(inspection.targetVersion).toHaveLength(64);
        expect(setActive!.meta.approvalPolicy).toBe("strong");
        expect(delivery.updateRule).toHaveBeenCalledWith(principal.branchId, "rule-a", { isActive: false });
        expect(updated.isActive).toBe(false);
    });

    it("reconciles automation creation only through its exact action receipt", async () => {
        const { delivery, prisma, capabilities } = setup();
        const create = capabilities.find((entry) => entry.meta.name === "automation.create")!;
        const input = {
            name: "시작 알림",
            isActive: true,
            eventType: MessageTriggerEventType.SERVICE_START,
            offsetType: MessageTriggerOffsetType.BEFORE_DAYS,
            offsetDays: 1,
            recipientType: MessageTriggerRecipientType.CLIENT,
            templateKey: MessageTriggerTemplateKey.SERVICE_START_REMINDER,
        };

        await expect(create.execute(context, input)).resolves.toEqual({ status: "created", id: "rule-a", isActive: true });
        await expect(create.reconcile!(context, input, null)).resolves.toEqual({
            status: "succeeded",
            result: { status: "created", id: "rule-a", isActive: true },
        });

        expect(delivery.createRule).toHaveBeenCalledWith(principal.branchId, input);
        expect(prisma.agent_action.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ id: context.actionId, capability: "automation.create" }),
        }));
        expect(delivery.listRules).not.toHaveBeenCalled();
    });

    it("provides recoverable form fields for every automation mutation", () => {
        const { capabilities } = setup();

        for (const name of ["automation.create", "automation.update", "automation.setActive", "automation.delete"]) {
            const capability = capabilities.find((entry) => entry.meta.name === name);
            expect(capability?.formFields?.length).toBeGreaterThan(0);
        }
    });

    it("keeps automation deletion uncertain on operational lookup failures", async () => {
        const { delivery, capabilities } = setup();
        const capability = capabilities.find((entry) => entry.meta.name === "automation.delete")!;
        delivery.getRule.mockRejectedValueOnce(new Error("database unavailable"));

        await expect(capability.reconcile!(context, { id: "rule-a" }, null)).resolves.toEqual({
            status: "uncertain",
            reason: "Automation rule lookup failed",
        });

        delivery.getRule.mockRejectedValueOnce(new NotFoundException("missing"));
        await expect(capability.reconcile!(context, { id: "rule-a" }, null)).resolves.toEqual({
            status: "succeeded",
            result: { status: "deleted", id: "rule-a" },
        });
    });

    it("keeps synthetic ad-hoc SMS rules inactive", async () => {
        const { prisma, capabilities } = setup();
        const capability = capabilities.find((entry) => entry.meta.name === "messages.sendSms")!;

        await capability.execute(context, { receiver: "01012345678", message: "안내" });

        expect(prisma.message_trigger_rule.upsert).toHaveBeenCalledWith(expect.objectContaining({
            create: expect.objectContaining({ isActive: false }),
            update: { isActive: false },
        }));
    });
});
