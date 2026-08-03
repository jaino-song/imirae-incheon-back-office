import { NotFoundException } from "@nestjs/common";

import { AligoService } from "application/services/aligo.service";
import { SendAligoSmsUsecase } from "application/usecases/aligo/send-sms.usecase";
import { MessageTriggerDeliveryService } from "application/services/message-trigger-delivery.service";
import { MessageTriggerService } from "application/services/message-trigger.service";
import { MessageSenderApprovalService } from "application/services/message-sender-approval.service";
import { SmsTriggerDeliveryService } from "application/services/sms-trigger-delivery.service";
import { ActionCoordinatorService } from "application/agent/action-coordinator.service";
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
            messageBody: "실패한 안내 본문",
            templateVariables: {
                retrySafety: "provider-rejected",
                msgType: "SMS",
                title: "실패한 안내 제목",
                triggerType: "agent_scheduled",
            },
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
            claimProviderRejectedForRetry: jest.fn().mockImplementation(async (_branchId: string, _sourceJobId: string, _version: string, _snapshotHash: string, _source: MessageTriggerJobEntity, candidate: MessageTriggerJobEntity) => Object.assign(candidate, { id: "retry-job" })),
        };
        const delivery = {
            dispatchPendingJobNow: jest.fn().mockResolvedValue({ status: "sent" }),
            listRules: jest.fn().mockResolvedValue([rule]),
            getRule: jest.fn().mockResolvedValue(rule),
            createRule: jest.fn().mockResolvedValue(rule),
            updateRule: jest.fn().mockImplementation(async (_branchId, _id, updates) => Object.assign(rule, updates)),
            updateRuleApprovedTarget: jest.fn().mockResolvedValue(rule),
            deleteRule: jest.fn().mockResolvedValue(undefined),
            deleteRuleApprovedTarget: jest.fn().mockResolvedValue(undefined),
            isRuleMutationComplete: jest.fn().mockResolvedValue(true),
        };
        let effectReceipt: unknown = null;
        const prisma = {
            $transaction: jest.fn(),
            agent_action: {
                updateMany: jest.fn().mockImplementation(async ({ data }) => {
                    effectReceipt = data.effectReceipt;
                    return { count: 1 };
                }),
                findUnique: jest.fn().mockResolvedValue(null),
                findFirst: jest.fn().mockImplementation(async () => ({ effectReceipt })),
            },
            message_trigger_rule: { upsert: jest.fn().mockResolvedValue(undefined) },
            message_trigger_job: { findFirst: jest.fn().mockResolvedValue(null) },
        };
        prisma.$transaction.mockImplementation(async (operation: (tx: typeof prisma) => Promise<unknown>) => operation(prisma));
        const aligoService = {
            sendSms: jest.fn().mockResolvedValue({
                request: { receiver: "01012345678", msgType: "LMS", testModeYn: "N" },
                response: { result_code: 1, message: "성공", msg_id: 88, success_cnt: 1, error_cnt: 0 },
            }),
        };
        const smsDelivery = new SmsTriggerDeliveryService(
            aligoService as unknown as AligoService,
            { getByKey: jest.fn() } as never,
            { save: jest.fn() } as never,
        );
        const senderApproval = { ensureApproved: jest.fn().mockResolvedValue(undefined) };
        const provider = new MessageExternalAgentCapabilitiesProvider(
            prisma as never,
            delivery as never,
            repository as never,
            smsDelivery,
            senderApproval as unknown as MessageSenderApprovalService,
        );
        const capabilities = provider.getCapabilities();
        return { repository, delivery, prisma, smsDelivery, aligoService, senderApproval, capabilities };
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

    it.each([
        ["messages.sendSms", { receiver: "01012345678", message: "즉시 안내" }, "AI 문자 발송"],
        ["messages.sendSms", { receiver: "01012345678", message: "즉시 안내", title: "명시적 즉시 제목" }, "명시적 즉시 제목"],
        ["messages.scheduleSms", { receiver: "01012345678", message: "예약 안내", scheduledDate: "2099-08-03", scheduledTime: "12:00" }, "AI 예약 문자"],
        ["messages.scheduleSms", { receiver: "01012345678", message: "예약 안내", title: "명시적 예약 제목", scheduledDate: "2099-08-03", scheduledTime: "12:00" }, "명시적 예약 제목"],
    ])("uses one canonical title from proposal input through staged job and provider request (%s)", async (capabilityName, rawInput, expectedTitle) => {
        const { capabilities, prisma, repository, smsDelivery, aligoService } = setup();
        const capability = capabilities.find((entry) => entry.meta.name === capabilityName)!;
        const actionRepository = {
            createInActiveSession: jest.fn().mockImplementation(async (proposal: { proposal: unknown }) => ({
                status: "created",
                action: { proposal: proposal.proposal },
            })),
        };
        const coordinator = new ActionCoordinatorService(
            prisma as never,
            { get: jest.fn().mockReturnValue(capability) } as never,
            { isCapabilityEnabled: jest.fn().mockResolvedValue(true) } as never,
            {} as never,
            { assertActive: jest.fn().mockResolvedValue(undefined) } as never,
            actionRepository as never,
        );

        await coordinator.propose({
            sessionId: context.sessionId,
            principal: context.principal as never,
            capability: capabilityName,
            input: rawInput,
            locale: context.locale,
            traceId: context.traceId,
        });
        const persisted = actionRepository.createInActiveSession.mock.calls[0]?.[0] as {
            proposal: { input: Record<string, unknown> };
        };
        expect(persisted.proposal.input["title"]).toBe(expectedTitle);

        const stagedResult = await capability.execute(context, persisted.proposal.input);
        expect(stagedResult).toEqual(expect.objectContaining({ status: capabilityName === "messages.sendSms" ? "sent" : "scheduled" }));
        const stagedJob = repository.upsertPending.mock.calls[0]?.[0] as MessageTriggerJobEntity;
        expect(stagedJob.payload.templateVariables["title"]).toBe(persisted.proposal.input["title"]);

        await smsDelivery.sendJob(stagedJob);
        expect(aligoService.sendSms).toHaveBeenLastCalledWith(expect.objectContaining({
            title: persisted.proposal.input["title"],
        }));
    });

    it("returns a certain failed result for an explicit provider rejection", async () => {
        const { delivery, capabilities } = setup();
        const failed = terminalJob({ id: "retry-job" });
        failed.payload.templateVariables["retrySafety"] = "provider-rejected";
        delivery.dispatchPendingJobNow.mockResolvedValue(failed);
        const send = capabilities.find((entry) => entry.meta.name === "messages.sendSms")!;

        await expect(send.execute(context, { receiver: "01012345678", message: "거절 테스트" }))
            .resolves.toEqual({ status: "failed", msgType: "LMS", jobId: "retry-job" });
    });

    it("preserves canceled SMS outcomes as canceled", async () => {
        const { delivery, capabilities } = setup();
        const canceled = terminalJob({ id: "retry-job", status: "canceled", cancelReason: "승인 필요" });
        delivery.dispatchPendingJobNow.mockResolvedValue(canceled);
        const send = capabilities.find((entry) => entry.meta.name === "messages.sendSms")!;

        await expect(send.execute(context, { receiver: "01012345678", message: "취소 테스트" }))
            .resolves.toEqual({ status: "canceled", msgType: "LMS", jobId: "retry-job" });
    });

    it("keeps thrown transport failures uncertain and does not infer a provider rejection", async () => {
        const { delivery, capabilities } = setup();
        delivery.dispatchPendingJobNow.mockRejectedValue(new Error("transport unavailable"));
        const send = capabilities.find((entry) => entry.meta.name === "messages.sendSms")!;

        await expect(send.execute(context, { receiver: "01012345678", message: "전송 오류 테스트" }))
            .rejects.toMatchObject({ name: "AgentActionUncertainError" });
    });

    it("keeps failed jobs without the provider-rejected marker uncertain", async () => {
        const { delivery, capabilities } = setup();
        const failed = terminalJob({ id: "retry-job" });
        failed.payload.templateVariables["retrySafety"] = "uncertain";
        delivery.dispatchPendingJobNow.mockResolvedValue(failed);
        const send = capabilities.find((entry) => entry.meta.name === "messages.sendSms")!;

        await expect(send.execute(context, { receiver: "01012345678", message: "근거 부족 테스트" }))
            .rejects.toMatchObject({ name: "AgentActionUncertainError" });
    });

    it("reconciles an explicitly provider-rejected persisted job as failed", async () => {
        const { prisma, capabilities } = setup();
        const failed = terminalJob({ id: "job-a" });
        failed.payload.templateVariables["retrySafety"] = "provider-rejected";
        prisma.message_trigger_job.findFirst.mockResolvedValue(failed as never);
        const send = capabilities.find((entry) => entry.meta.name === "messages.sendSms")!;

        await expect(send.reconcile!(context, {}, { jobId: failed.id }))
            .resolves.toEqual({ status: "failed", result: { status: "failed", jobId: failed.id } });
    });

    it("does not create an SMS rule or job when sender approval is revoked", async () => {
        const { senderApproval, repository, prisma, capabilities } = setup();
        senderApproval.ensureApproved.mockRejectedValue(new Error("approval required"));
        const send = capabilities.find((entry) => entry.meta.name === "messages.sendSms")!;

        await expect(send.inspect!(context, { receiver: "01012345678", message: "승인 필요" }))
            .rejects.toThrow("approval required");
        await expect(send.execute(context, { receiver: "01012345678", message: "승인 필요" }))
            .rejects.toMatchObject({ name: "AgentActionCertainFailureError" });
        expect(prisma.message_trigger_rule.upsert).not.toHaveBeenCalled();
        expect(repository.upsertPending).not.toHaveBeenCalled();
    });

    it("rejects unsupported SMS sender overrides and omits them from recovery forms", () => {
        const { capabilities } = setup();
        for (const name of ["messages.sendSms", "messages.scheduleSms"]) {
            const capability = capabilities.find((entry) => entry.meta.name === name)!;
            const input = name === "messages.scheduleSms"
                ? { receiver: "01012345678", message: "안내", senderPhone: "0212345678", scheduledDate: "2030-08-03", scheduledTime: "12:00" }
                : { receiver: "01012345678", message: "안내", senderPhone: "0212345678" };
            expect(capability.inputSchema.safeParse(input).success).toBe(false);
            expect(capability.formFields?.some((field) => field.name === "senderPhone")).toBe(false);
        }
    });

    it("creates one action-keyed retry only for an explicitly provider-rejected job", async () => {
        const { repository, delivery, capabilities } = setup();
        const capability = capabilities.find((entry) => entry.meta.name === "messages.retrySms");

        const inspection = await capability!.inspect!(context, { jobId: "job-a" });
        const approvedContext = {
            ...context,
            approvedTargetVersion: inspection.targetVersion,
            approvedTargetSnapshot: inspection.targetSnapshot,
        };
        const result = await capability!.execute(approvedContext, { jobId: "job-a" }) as { status: string; jobId: string };

        expect(inspection.targetVersion).toHaveLength(64);
        expect(repository.claimProviderRejectedForRetry).toHaveBeenCalledWith(
            principal.branchId,
            "job-a",
            inspection.targetVersion,
            expect.any(String),
            expect.objectContaining({ id: "job-a" }),
            expect.objectContaining({
                branchId: principal.branchId,
                dedupeKey: `agent-sms-retry:${context.actionId}`,
                status: "pending",
            }),
        );
        expect(delivery.dispatchPendingJobNow).toHaveBeenCalledWith("retry-job");
        expect(result).toEqual({ status: "sent", jobId: "retry-job" });
    });

    it("fails closed when the provider-bound retry target drifts after revalidation", async () => {
        const source = terminalJob();
        const { repository, delivery, capabilities } = setup(source);
        const capability = capabilities.find((entry) => entry.meta.name === "messages.retrySms")!;
        const inspection = await capability.inspect!(context, { jobId: source.id });
        await expect(capability.revalidate!(context, { jobId: source.id }, inspection.targetVersion!))
            .resolves.toEqual(expect.objectContaining({ valid: true }));
        source.payload.messageBody = "변경된 승인 이후 본문";

        await expect(capability.execute({
            ...context,
            approvedTargetVersion: inspection.targetVersion,
            approvedTargetSnapshot: inspection.targetSnapshot,
        }, { jobId: source.id })).rejects.toThrow("changed after approval");
        expect(repository.upsertPending).not.toHaveBeenCalled();
        expect(delivery.dispatchPendingJobNow).not.toHaveBeenCalled();
    });

    it("binds ActionCoordinator approval through staged retry dispatch to the real Aligo use case", async () => {
        const source = terminalJob();
        let stagedRetry: MessageTriggerJobEntity | undefined;
        const repository = {
            findById: jest.fn().mockImplementation(async (id: string) => id === "job-a" ? source : stagedRetry),
            findHistoryByBranch: jest.fn().mockResolvedValue([]),
            upsertPending: jest.fn().mockImplementation(async (candidate: MessageTriggerJobEntity) => {
                stagedRetry = Object.assign(candidate, { id: "retry-job" });
                return stagedRetry;
            }),
            claimProviderRejectedForRetry: jest.fn().mockImplementation(async (_branchId: string, _sourceJobId: string, _version: string, _snapshotHash: string, _source: MessageTriggerJobEntity, candidate: MessageTriggerJobEntity) => {
                stagedRetry = Object.assign(candidate, { id: "retry-job" });
                return stagedRetry;
            }),
            claimPending: jest.fn().mockImplementation(async (id: string) => id === stagedRetry?.id),
            claimPendingWithRuleFence: jest.fn().mockImplementation(async (id: string) => id === stagedRetry?.id),
            update: jest.fn().mockResolvedValue(undefined),
            findSentTriggerJobIds: jest.fn().mockResolvedValue(new Set<string>()),
        };
        const providerApi = {
            sendSms: jest.fn().mockResolvedValue({
                result_code: 1,
                message: "성공",
                msg_id: 99,
                success_cnt: 1,
                error_cnt: 0,
            }),
        };
        const aligoService = new AligoService(new SendAligoSmsUsecase(providerApi as never));
        const smsDelivery = new SmsTriggerDeliveryService(
            aligoService,
            { getByKey: jest.fn() } as never,
            { save: jest.fn().mockImplementation(async (log: unknown) => log) } as never,
        );
        const triggerDelivery = new MessageTriggerDeliveryService(smsDelivery);
        const senderApproval = {
            getApprovedBranchIds: jest.fn().mockResolvedValue(new Set([principal.branchId])),
            ensureApproved: jest.fn().mockResolvedValue(undefined),
        };
        const triggerService = new MessageTriggerService(
            {} as never,
            triggerDelivery,
            senderApproval as never,
            {} as never,
            repository as never,
            { findSentTriggerJobIds: jest.fn().mockResolvedValue(new Set<string>()), save: jest.fn() } as never,
        );
        const provider = new MessageExternalAgentCapabilitiesProvider(
            {} as never,
            triggerService,
            repository as never,
            smsDelivery,
            senderApproval as never,
        );
        const retry = provider.getCapabilities().find((entry) => entry.meta.name === "messages.retrySms")!;
        const actionRecords: { current?: Record<string, any> } = {};
        const actionPrisma = {
            agent_action: {
                findUnique: jest.fn().mockResolvedValue(null),
                create: jest.fn().mockImplementation(async ({ data }: { data: Record<string, any> }) => {
                    actionRecords.current = {
                        ...data,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                        approvedBy: null,
                        approvedAt: null,
                        rejectedBy: null,
                        rejectedAt: null,
                        result: null,
                        error: null,
                        executedAt: null,
                        executionAttemptCount: 0,
                        resultPartPersistedAt: null,
                    };
                    return actionRecords.current;
                }),
                findFirst: jest.fn().mockImplementation(async () => actionRecords.current),
                updateMany: jest.fn().mockImplementation(async ({ data }: { data: Record<string, any> }) => {
                    if (!actionRecords.current) return { count: 0 };
                    actionRecords.current = { ...actionRecords.current, ...data, updatedAt: new Date() };
                    return { count: 1 };
                }),
            },
        };
        const actionRepository = {
            createInActiveSession: jest.fn().mockImplementation(async (input: Record<string, unknown>) => {
                const action = await actionPrisma.agent_action.create({ data: input });
                return { status: "created", action };
            }),
        };
        const coordinator = new ActionCoordinatorService(
            actionPrisma as never,
            { get: jest.fn().mockReturnValue(retry) } as never,
            { isCapabilityEnabled: jest.fn().mockResolvedValue(true) } as never,
            { isAvailable: jest.fn().mockReturnValue(false) } as never,
            {
                assertActive: jest.fn().mockResolvedValue(undefined),
                upsertActionResultMessage: jest.fn().mockResolvedValue(true),
            } as never,
            actionRepository as never,
        );

        const action = await coordinator.propose({
            sessionId: "session-a",
            principal,
            capability: "messages.retrySms",
            input: { jobId: source.id },
            locale: "ko",
        });
        const acknowledgement = coordinator.strongAcknowledgementToken(action);
        await expect(coordinator.approve(action.id, principal, action.proposalRevision, acknowledgement))
            .resolves.toEqual(expect.objectContaining({ action: expect.objectContaining({ status: "succeeded" }) }));

        expect(stagedRetry).toBeDefined();
        expect(stagedRetry?.payload.templateVariables["__smsDeliverySnapshot"]).toBeDefined();
        expect(providerApi.sendSms).toHaveBeenCalledWith(expect.objectContaining({
            receiver: "01012345678",
            message: source.payload.messageBody,
            title: source.payload.templateVariables["title"],
            msgType: "LMS",
            testModeYn: "N",
        }));
    });

    it("binds retry approval details to a masked recipient and exact message snapshot", async () => {
        const { capabilities } = setup();
        const capability = capabilities.find((entry) => entry.meta.name === "messages.retrySms")!;

        const inspection = await capability.inspect!(context, { jobId: "job-a" });
        const serialized = JSON.stringify(inspection);

        expect(serialized).not.toContain("01012345678");
        expect(serialized).toContain("••••5678");
        expect(inspection.targetSnapshot).toEqual(expect.objectContaining({
            receiver: "••••5678",
            templateKey: MessageTriggerTemplateKey.INFO,
            messageBody: "실패한 안내 본문",
            title: "실패한 안내 제목",
            deliveryType: "LMS",
        }));
        expect(inspection.summary).toContain("실패한 안내 본문");
        expect(inspection.summary).toContain("실패한 안내 제목");
        expect(inspection.summary).toContain(MessageTriggerTemplateKey.INFO);
        expect(inspection.summary).toContain("LMS");
    });

    it("keeps inspected retry values equivalent to the real SMS delivery request", async () => {
        const { aligoService, capabilities, repository, smsDelivery } = setup();
        const capability = capabilities.find((entry) => entry.meta.name === "messages.retrySms")!;

        const inspection = await capability.inspect!(context, { jobId: "job-a" });
        const source = await repository.findById("job-a");
        await smsDelivery.sendJob(source!);

        const request = aligoService.sendSms.mock.calls[0]?.[0] as {
            receiver: string;
            message: string;
            title: string;
            msgType: string;
        };
        const target = inspection.targetSnapshot!;
        expect(target["receiver"]).toBe("••••5678");
        expect(request.receiver).toBe("01012345678");
        expect(request.message).toBe(target["messageBody"]);
        expect(request.title).toBe(target["title"]);
        expect(aligoService.sendSms).toHaveBeenCalledWith(expect.objectContaining({ msgType: "AUTO" }));
        expect(target["deliveryType"]).toBe("LMS");
    });

    it.each([
        ["recipient", (job: MessageTriggerJobEntity) => { job.recipientPhone = "01099998888"; }],
        ["template key", (job: MessageTriggerJobEntity) => { job.templateKey = MessageTriggerTemplateKey.SERVICE_INFO; }],
        ["message body", (job: MessageTriggerJobEntity) => { job.payload.messageBody = "변경된 본문"; }],
        ["message title", (job: MessageTriggerJobEntity) => { job.payload.templateVariables["title"] = "변경된 제목"; }],
        ["delivery type", (job: MessageTriggerJobEntity) => { job.payload.templateVariables["msgType"] = "LMS"; }],
    ])("invalidates an approved retry when the %s changes", async (_field, mutate) => {
        const source = terminalJob();
        const { repository, capabilities } = setup(source);
        const capability = capabilities.find((entry) => entry.meta.name === "messages.retrySms")!;
        const inspection = await capability.inspect!(context, { jobId: source.id });

        mutate(source);

        await expect(capability.revalidate!(context, { jobId: source.id }, inspection.targetVersion!)).resolves.toEqual(expect.objectContaining({ valid: false }));
        expect(repository.findById).toHaveBeenCalledWith(source.id);
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

    it("routes versioned automation mutations through approved-target CAS hooks", async () => {
        const { delivery, capabilities } = setup();
        const update = capabilities.find((entry) => entry.meta.name === "automation.update")!;
        const remove = capabilities.find((entry) => entry.meta.name === "automation.delete")!;
        const inspection = await update.inspect!(context, { id: "rule-a", name: "승인된 규칙" });
        const approvedContext = {
            ...context,
            approvedTargetVersion: inspection.targetVersion,
            approvedTargetSnapshot: inspection.targetSnapshot,
        };

        await expect(update.executeApprovedTarget!(approvedContext, { id: "rule-a", name: "승인된 규칙" }, inspection.targetVersion!))
            .resolves.toEqual(expect.objectContaining({ status: "updated", id: "rule-a" }));
        expect(delivery.updateRuleApprovedTarget).toHaveBeenCalledWith(
            principal.branchId,
            "rule-a",
            { name: "승인된 규칙" },
            inspection.targetVersion,
            inspection.targetSnapshot,
        );

        const deleteInspection = await remove.inspect!(context, { id: "rule-a" });
        await expect(remove.executeApprovedTarget!(
            { ...context, approvedTargetSnapshot: deleteInspection.targetSnapshot },
            { id: "rule-a" },
            deleteInspection.targetVersion!,
        )).resolves.toEqual({ status: "deleted", id: "rule-a" });
        expect(delivery.deleteRuleApprovedTarget).toHaveBeenCalledWith(
            principal.branchId,
            "rule-a",
            deleteInspection.targetVersion,
            deleteInspection.targetSnapshot,
        );
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

        expect(delivery.createRule).toHaveBeenCalledWith(principal.branchId, input, expect.objectContaining({ agent_action: expect.any(Object) }));
        expect(prisma.agent_action.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ id: context.actionId, capability: "automation.create" }),
        }));
        expect(delivery.listRules).not.toHaveBeenCalled();
    });

    it("does not report an automation rule when its action receipt cannot be persisted", async () => {
        const { delivery, prisma, capabilities } = setup();
        prisma.agent_action.updateMany.mockResolvedValue({ count: 0 });
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

        await expect(create.execute(context, input)).rejects.toThrow("receipt could not be persisted");
        expect(delivery.createRule).toHaveBeenCalledWith(principal.branchId, input, expect.objectContaining({ agent_action: expect.any(Object) }));
    });

    it("rejects id-only automation updates before the canonical service is called", async () => {
        const { delivery, capabilities } = setup();
        const update = capabilities.find((entry) => entry.meta.name === "automation.update")!;

        expect(update.inputSchema.safeParse({ id: "rule-a" }).success).toBe(false);
        await expect(update.execute(context, { id: "rule-a" })).rejects.toThrow();
        expect(delivery.updateRule).not.toHaveBeenCalled();
    });

    it("classifies a scheduled SMS that becomes too near as a certain pre-effect failure", async () => {
        jest.useFakeTimers().setSystemTime(new Date("2026-08-03T00:00:00.000Z"));
        try {
            const { repository, capabilities } = setup();
            const schedule = capabilities.find((entry) => entry.meta.name === "messages.scheduleSms")!;
            const input = { receiver: "01012345678", message: "안내", scheduledDate: "2026-08-03", scheduledTime: "09:15" };
            expect(schedule.inputSchema.safeParse(input).success).toBe(true);

            jest.setSystemTime(new Date("2026-08-03T00:06:00.000Z"));
            await expect(schedule.execute(context, input)).rejects.toMatchObject({ name: "AgentActionCertainFailureError" });
            expect(repository.upsertPending).not.toHaveBeenCalled();
        } finally {
            jest.useRealTimers();
        }
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

    it("keeps automation update reconciliation uncertain on lookup failures", async () => {
        const { delivery, capabilities } = setup();
        const capability = capabilities.find((entry) => entry.meta.name === "automation.update")!;
        const input = { id: "rule-a", name: "변경된 규칙" };
        delivery.getRule.mockRejectedValueOnce(new Error("database unavailable"));

        await expect(capability.reconcile!(context, input, null)).resolves.toEqual({
            status: "uncertain",
            reason: "Automation rule lookup failed",
        });

        delivery.getRule.mockRejectedValueOnce(new NotFoundException("missing"));
        await expect(capability.reconcile!(context, input, null)).resolves.toEqual({
            status: "failed",
            reason: "Automation rule no longer exists",
        });
    });

    it("does not reconcile automation success until job fencing and rebuild complete", async () => {
        const { delivery, capabilities } = setup();
        const capability = capabilities.find((entry) => entry.meta.name === "automation.update")!;
        delivery.isRuleMutationComplete.mockResolvedValue(false);

        await expect(capability.reconcile!(context, { id: "rule-a", name: "시작 알림" }, null)).resolves.toEqual({
            status: "uncertain",
            reason: "Automation rule jobs have not completed fencing and rebuild",
        });
        expect(delivery.isRuleMutationComplete).toHaveBeenCalledWith(
            principal.branchId,
            "rule-a",
            { name: "시작 알림" },
        );
    });

    it("reconciles a rebuilt pending automation before delivery", async () => {
        const { delivery, capabilities } = setup();
        const capability = capabilities.find((entry) => entry.meta.name === "automation.update")!;
        delivery.isRuleMutationComplete.mockResolvedValue(true);

        await expect(capability.reconcile!(context, { id: "rule-a", name: "시작 알림" }, null)).resolves.toEqual({
            status: "succeeded",
            result: { status: "updated", id: "rule-a", isActive: true },
        });

        expect(delivery.isRuleMutationComplete).toHaveBeenCalledWith(
            principal.branchId,
            "rule-a",
            { name: "시작 알림" },
        );
        expect(delivery.dispatchPendingJobNow).not.toHaveBeenCalled();
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
