import { PwaNotificationSchedulerService } from "application/services/pwa-notification-scheduler.service";
import { DailyDigestSection, NotificationService } from "application/services/notification.service";
import { IBranchRepository } from "domain/repositories/branch.repository.interface";
import { IClientRepository } from "domain/repositories/client.repository.interface";
import { IMessageTriggerJobRepository } from "domain/repositories/message-trigger-job.repository.interface";
import { SystemSettingService } from "application/services/system-setting.service";
import {
    MESSAGE_TRIGGER_TEMPLATE_CATALOG,
    MessageTriggerRecipientType,
    MessageTriggerTemplateKey,
} from "domain/constants/message-trigger-catalog";

describe("PwaNotificationSchedulerService", () => {
    const emailTemplateContext = {
        ctaUrl: "https://admin.babyjamjam.com/login",
        ctaLabel: "로그인해서 확인하기",
    };
    const notificationService = {
        sendDailyDigestToBranchUsers: jest.fn(),
    };
    const clientRepository = {
        findStartingWithinDays: jest.fn(),
        findEndingWithinDays: jest.fn(),
        findWithIncompleteContractsStartingWithinDays: jest.fn(),
        findWithoutContractSentStartingWithinDays: jest.fn(),
    };
    const branchRepository = {
        findAllActive: jest.fn(),
    };
    const messageTriggerJobRepository = {
        findRecentUndeliveredByBranch: jest.fn(),
        countRecentUndeliveredByBranch: jest.fn(),
    };
    const systemSettingService = {
        getPwaUndeliveredDigestWatermark: jest.fn(),
        setPwaUndeliveredDigestWatermark: jest.fn(),
    };
    let service: PwaNotificationSchedulerService;

    const digestCall = (index = 0): [string, string, DailyDigestSection[], typeof emailTemplateContext] =>
        notificationService.sendDailyDigestToBranchUsers.mock.calls[index];

    const undeliveredMessageLabel = (templateKey: MessageTriggerTemplateKey): string =>
        MESSAGE_TRIGGER_TEMPLATE_CATALOG[templateKey].name;

    beforeEach(() => {
        service = new PwaNotificationSchedulerService(
            notificationService as unknown as NotificationService,
            clientRepository as unknown as IClientRepository,
            branchRepository as unknown as IBranchRepository,
            messageTriggerJobRepository as unknown as IMessageTriggerJobRepository,
            systemSettingService as unknown as SystemSettingService,
        );

        branchRepository.findAllActive.mockResolvedValue([{ id: "branch-1", name: "인천점" }]);
        clientRepository.findStartingWithinDays.mockResolvedValue(
            Array.from({ length: 6 }, (_, index) => ({ id: index + 1 })),
        );
        clientRepository.findEndingWithinDays.mockResolvedValue([
            { id: 10 },
            { id: 11 },
        ]);
        clientRepository.findWithIncompleteContractsStartingWithinDays.mockResolvedValue([
            { id: 20 },
            { id: 21 },
            { id: 22 },
        ]);
        clientRepository.findWithoutContractSentStartingWithinDays.mockResolvedValue([
            { id: 30, name: "김지혜" },
        ]);
        messageTriggerJobRepository.findRecentUndeliveredByBranch.mockResolvedValue([
            {
                payload: { recipientName: "이하늘" },
                templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
                cancelReason: "24시간 경과로 취소",
            },
        ]);
        messageTriggerJobRepository.countRecentUndeliveredByBranch.mockResolvedValue(1);
        systemSettingService.getPwaUndeliveredDigestWatermark.mockResolvedValue(null);
        systemSettingService.setPwaUndeliveredDigestWatermark.mockResolvedValue(undefined);
        notificationService.sendDailyDigestToBranchUsers.mockResolvedValue({ sent: 2, failed: 0 });
    });

    afterEach(() => {
        jest.clearAllMocks();
        // Also restore jest.spyOn-based spies (Date.now, sendBranchDigest) to their real
        // implementation — clearAllMocks only resets call history, so a global spy like
        // Date.now would otherwise leak into every test defined after it in this file.
        jest.restoreAllMocks();
    });

    it("should send exactly one branch-scoped digest carrying every non-empty section", async () => {
        await service.sendDailySummaryNotifications();

        expect(notificationService.sendDailyDigestToBranchUsers).toHaveBeenCalledTimes(1);

        const [branchId, branchName, sections, ctx] = digestCall();
        expect(branchId).toBe("branch-1");
        expect(branchName).toBe("인천점");
        expect(ctx).toEqual(emailTemplateContext);
        expect(sections).toEqual([
            {
                key: "upcoming",
                label: "서비스 시작 예정",
                description: "7일 내에 시작 예정인 서비스가 6건 있어요.",
                count: 6,
                unit: "건",
                url: "/clients/filtered?filter=starting-soon",
            },
            {
                key: "ending",
                label: "서비스 종료 예정",
                description: "7일 내에 종료 예정인 서비스가 2건 있어요.",
                count: 2,
                unit: "건",
                url: "/clients/filtered?filter=ending-soon",
            },
            {
                key: "incompleteContracts",
                label: "계약서 미완료",
                description: "서비스 시작 전인데 아직 완료되지 않은 계약서가 3건 있어요.",
                count: 3,
                unit: "건",
                url: "/clients/filtered?filter=incomplete-contracts",
            },
            {
                key: "contractsNotSent",
                label: "계약서 미발송",
                description: "아직 계약서가 발송되지 않은 고객이 1명 있어요.",
                count: 1,
                unit: "명",
                url: "/clients/filtered?filter=no-contract",
                details: ["김지혜"],
            },
            {
                key: "undeliveredMessages",
                label: "자동 전송 실패·취소",
                description: "이전 알림 이후 자동 전송 중 발송되지 못한 메시지가 1건 있어요. 필요하면 수동으로 발송해 주세요.",
                count: 1,
                unit: "건",
                url: "/messages",
                details: [`이하늘 · ${undeliveredMessageLabel(MessageTriggerTemplateKey.SERVICE_INFO)} — 24시간 경과로 취소`],
            },
        ]);
    });

    it("should attach one exact notification item per ending client and undelivered message", async () => {
        jest.spyOn(Date, "now").mockReturnValue(new Date("2026-08-20T00:00:00.000Z").getTime());
        clientRepository.findStartingWithinDays.mockResolvedValue([]);
        clientRepository.findEndingWithinDays.mockResolvedValue([
            { id: 10, name: "김민지", endDate: new Date("2026-08-21T00:00:00.000Z") },
        ]);
        clientRepository.findWithIncompleteContractsStartingWithinDays.mockResolvedValue([]);
        clientRepository.findWithoutContractSentStartingWithinDays.mockResolvedValue([]);
        messageTriggerJobRepository.findRecentUndeliveredByBranch.mockResolvedValue([
            {
                id: "job-1",
                status: "failed",
                recipientType: MessageTriggerRecipientType.PRIMARY_EMPLOYEE,
                payload: { recipientName: "강하은" },
                templateKey: MessageTriggerTemplateKey.SERVICE_RECORD_LINK,
                cancelReason: "발송 실패",
            },
        ]);
        messageTriggerJobRepository.countRecentUndeliveredByBranch.mockResolvedValue(1);

        await service.sendDailySummaryNotifications();

        const [, , sections] = digestCall();
        expect(sections).toEqual([
            expect.objectContaining({
                key: "ending",
                notificationItems: [{
                    title: "서비스 종료 예정",
                    body: "김민지 산모님의 서비스가 내일 종료됩니다.",
                    data: {
                        type: "daily-summary-item",
                        category: "service-ending",
                        clientId: 10,
                        url: "/clients/filtered?filter=ending-soon",
                    },
                }],
            }),
            expect.objectContaining({
                key: "undeliveredMessages",
                notificationItems: [{
                    title: "메시지 전송 실패",
                    body: "강하은 관리사님에게 보낸 제공기록지 메시지 전송이 실패했습니다.",
                    data: {
                        type: "daily-summary-item",
                        category: "message-undelivered",
                        jobId: "job-1",
                        url: "/messages",
                    },
                }],
            }),
        ]);
    });

    it("should not send anything when every query comes back empty", async () => {
        clientRepository.findStartingWithinDays.mockResolvedValue([]);
        clientRepository.findEndingWithinDays.mockResolvedValue([]);
        clientRepository.findWithIncompleteContractsStartingWithinDays.mockResolvedValue([]);
        clientRepository.findWithoutContractSentStartingWithinDays.mockResolvedValue([]);
        messageTriggerJobRepository.findRecentUndeliveredByBranch.mockResolvedValue([]);
        messageTriggerJobRepository.countRecentUndeliveredByBranch.mockResolvedValue(0);

        await service.sendDailySummaryNotifications();

        expect(notificationService.sendDailyDigestToBranchUsers).not.toHaveBeenCalled();
    });

    it("should still send a digest from the remaining sections when one query fails", async () => {
        clientRepository.findEndingWithinDays.mockRejectedValue(new Error("db down"));

        await service.sendDailySummaryNotifications();

        expect(notificationService.sendDailyDigestToBranchUsers).toHaveBeenCalledTimes(1);
        const [, , sections] = digestCall();
        expect(sections.map((section) => section.key)).toEqual([
            "upcoming",
            "incompleteContracts",
            "contractsNotSent",
            "undeliveredMessages",
        ]);
    });

    it("should send one digest per active branch", async () => {
        branchRepository.findAllActive.mockResolvedValue([
            { id: "branch-1", name: "인천점" },
            { id: "branch-2", name: "부천점" },
        ]);

        await service.sendDailySummaryNotifications();

        expect(notificationService.sendDailyDigestToBranchUsers).toHaveBeenCalledTimes(2);
        expect(digestCall(0)[0]).toBe("branch-1");
        expect(digestCall(1)[0]).toBe("branch-2");
        expect(digestCall(0)[1]).toBe("인천점");
        expect(digestCall(1)[1]).toBe("부천점");
        expect(clientRepository.findStartingWithinDays).toHaveBeenCalledWith("branch-1", 7);
        expect(clientRepository.findStartingWithinDays).toHaveBeenCalledWith("branch-2", 7);
    });

    it("should keep processing later branches when one branch digest throws", async () => {
        branchRepository.findAllActive.mockResolvedValue([
            { id: "branch-1", name: "인천점" },
            { id: "branch-2", name: "부천점" },
        ]);
        notificationService.sendDailyDigestToBranchUsers
            .mockRejectedValueOnce(new Error("smtp down"))
            .mockResolvedValueOnce({ sent: 1, failed: 0 });

        await expect(service.sendDailySummaryNotifications()).resolves.toBeUndefined();

        expect(notificationService.sendDailyDigestToBranchUsers).toHaveBeenCalledTimes(2);
    });

    it("should keep processing later branches when an earlier branch's digest throws before its own internal try/catch", async () => {
        branchRepository.findAllActive.mockResolvedValue([
            { id: "branch-1", name: "인천점" },
            { id: "branch-2", name: "부천점" },
        ]);
        const sendBranchDigestSpy = jest
            .spyOn(
                service as unknown as { sendBranchDigest: (...args: unknown[]) => Promise<void> },
                "sendBranchDigest",
            )
            .mockRejectedValueOnce(new Error("boom before the internal try/catch"))
            .mockResolvedValueOnce(undefined);

        await expect(service.sendDailySummaryNotifications()).resolves.toBeUndefined();

        expect(sendBranchDigestSpy).toHaveBeenCalledTimes(2);
        expect(sendBranchDigestSpy).toHaveBeenNthCalledWith(
            1,
            "branch-1",
            "인천점",
            expect.any(Date),
            expect.any(Date),
        );
        expect(sendBranchDigestSpy).toHaveBeenNthCalledWith(
            2,
            "branch-2",
            "부천점",
            expect.any(Date),
            expect.any(Date),
        );
    });

    describe("undelivered-messages section (자동 전송 실패·취소)", () => {
        it("should build the section with the right label, description, count, and one formatted detail per job", async () => {
            messageTriggerJobRepository.findRecentUndeliveredByBranch.mockResolvedValue([
                {
                    payload: { recipientName: "이하늘" },
                    templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
                    cancelReason: "24시간 경과로 취소",
                },
                {
                    payload: { recipientName: "박민수" },
                    templateKey: MessageTriggerTemplateKey.CLIENT_WELCOME,
                    cancelReason: "Provider disabled or delivery failed",
                },
            ]);
            messageTriggerJobRepository.countRecentUndeliveredByBranch.mockResolvedValue(2);

            await service.sendDailySummaryNotifications();

            const [, , sections] = digestCall();
            const section = sections.find((candidate) => candidate.key === "undeliveredMessages");
            expect(section).toEqual({
                key: "undeliveredMessages",
                label: "자동 전송 실패·취소",
                description: "이전 알림 이후 자동 전송 중 발송되지 못한 메시지가 2건 있어요. 필요하면 수동으로 발송해 주세요.",
                count: 2,
                unit: "건",
                url: "/messages",
                details: [
                    `이하늘 · ${undeliveredMessageLabel(MessageTriggerTemplateKey.SERVICE_INFO)} — 24시간 경과로 취소`,
                    `박민수 · ${undeliveredMessageLabel(MessageTriggerTemplateKey.CLIENT_WELCOME)} — Provider disabled or delivery failed`,
                ],
            });
        });

        it("should preserve the total count as an aggregate while capping rendered details at 50", async () => {
            const runStartedAt = new Date("2026-08-20T00:00:00.000Z");
            jest.spyOn(Date, "now").mockReturnValue(runStartedAt.getTime());
            messageTriggerJobRepository.findRecentUndeliveredByBranch.mockResolvedValue(
                Array.from({ length: 50 }, (_, index) => ({
                    id: `job-${index + 1}`,
                    status: "failed",
                    recipientType: MessageTriggerRecipientType.CLIENT,
                    payload: { recipientName: `이용자 ${index + 1}` },
                    templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
                    cancelReason: "발송 실패",
                })),
            );
            messageTriggerJobRepository.countRecentUndeliveredByBranch.mockResolvedValue(73);

            await service.sendDailySummaryNotifications();

            const [, , sections] = digestCall();
            const section = sections.find((candidate) => candidate.key === "undeliveredMessages");
            expect(section?.count).toBe(73);
            expect(section?.description).toContain("73건");
            expect(section?.details).toHaveLength(50);
            expect(section?.notificationItems).toBeUndefined();
            expect(systemSettingService.setPwaUndeliveredDigestWatermark).toHaveBeenCalledWith(
                "branch-1",
                runStartedAt,
            );
        });

        it("should fall back to 사용자 when a job's payload is missing a recipient name", async () => {
            messageTriggerJobRepository.findRecentUndeliveredByBranch.mockResolvedValue([
                {
                    payload: { recipientName: "" },
                    templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
                    cancelReason: "발송 실패",
                },
            ]);

            await service.sendDailySummaryNotifications();

            const [, , sections] = digestCall();
            const section = sections.find((candidate) => candidate.key === "undeliveredMessages");
            expect(section?.details).toEqual([
                `사용자 · ${undeliveredMessageLabel(MessageTriggerTemplateKey.SERVICE_INFO)} — 발송 실패`,
            ]);
        });

        it("should fall back to a generic label instead of throwing when a job's templateKey is not in the catalog", async () => {
            messageTriggerJobRepository.findRecentUndeliveredByBranch.mockResolvedValue([
                {
                    payload: { recipientName: "이하늘" },
                    templateKey: "NOT_A_REAL_TEMPLATE_KEY" as MessageTriggerTemplateKey,
                    cancelReason: "24시간 경과로 취소",
                },
            ]);

            await expect(service.sendDailySummaryNotifications()).resolves.toBeUndefined();

            expect(notificationService.sendDailyDigestToBranchUsers).toHaveBeenCalledTimes(1);
            const [, , sections] = digestCall();
            const section = sections.find((candidate) => candidate.key === "undeliveredMessages");
            expect(section?.details).toEqual(["이하늘 · 메시지 — 24시간 경과로 취소"]);
        });

        it("should omit the section when the query returns no rows, without inflating the digest section count", async () => {
            messageTriggerJobRepository.findRecentUndeliveredByBranch.mockResolvedValue([]);
            messageTriggerJobRepository.countRecentUndeliveredByBranch.mockResolvedValue(0);

            await service.sendDailySummaryNotifications();

            const [, , sections] = digestCall();
            expect(sections.some((section) => section.key === "undeliveredMessages")).toBe(false);
            expect(sections).toHaveLength(4);
        });

        it("should pass a since cutoff 24 hours before the digest run, and the bounded item limit, to the repository", async () => {
            const before = Date.now();
            await service.sendDailySummaryNotifications();
            const after = Date.now();

            expect(messageTriggerJobRepository.findRecentUndeliveredByBranch).toHaveBeenCalledTimes(1);
            const [branchId, since, , limit] = messageTriggerJobRepository.findRecentUndeliveredByBranch.mock
                .calls[0] as [string, Date, Date, number];
            expect(branchId).toBe("branch-1");
            expect(limit).toBe(50);

            const windowMs = 24 * 60 * 60 * 1000;
            expect(since.getTime()).toBeGreaterThanOrEqual(before - windowMs);
            expect(since.getTime()).toBeLessThanOrEqual(after - windowMs);
        });

        it("should resume from the persisted branch watermark and advance it only after a successful digest", async () => {
            const previousWatermark = new Date("2026-08-09T00:00:00.000Z");
            const runStartedAt = new Date("2026-08-12T00:00:00.000Z");
            jest.spyOn(Date, "now").mockReturnValue(runStartedAt.getTime());
            systemSettingService.getPwaUndeliveredDigestWatermark.mockResolvedValue(previousWatermark);

            await service.sendDailySummaryNotifications();

            expect(messageTriggerJobRepository.findRecentUndeliveredByBranch).toHaveBeenCalledWith(
                "branch-1",
                previousWatermark,
                runStartedAt,
                50,
            );
            expect(messageTriggerJobRepository.countRecentUndeliveredByBranch).toHaveBeenCalledWith(
                "branch-1",
                previousWatermark,
                runStartedAt,
            );
            expect(systemSettingService.setPwaUndeliveredDigestWatermark).toHaveBeenCalledWith(
                "branch-1",
                runStartedAt,
            );
        });

        it("should retain the previous watermark when digest delivery fails", async () => {
            notificationService.sendDailyDigestToBranchUsers.mockRejectedValue(new Error("smtp down"));

            await service.sendDailySummaryNotifications();

            expect(systemSettingService.setPwaUndeliveredDigestWatermark).not.toHaveBeenCalled();
        });

        it("should retain the previous watermark when digest delivery is only partially successful", async () => {
            notificationService.sendDailyDigestToBranchUsers.mockResolvedValue({
                sent: 1,
                skipped: 0,
                failed: 1,
            });

            await service.sendDailySummaryNotifications();

            expect(systemSettingService.setPwaUndeliveredDigestWatermark).not.toHaveBeenCalled();
        });

        it("should use the exact same since boundary for every branch in one run, not a fresh one per branch", async () => {
            branchRepository.findAllActive.mockResolvedValue([
                { id: "branch-1", name: "인천점" },
                { id: "branch-2", name: "부천점" },
            ]);
            // Every Date.now() call — including NestJS Logger's own internal timestamping,
            // which fires before the boundary is computed — returns a strictly higher value
            // than the last. If the since boundary were (re)computed per branch, branch-2's
            // would land on a later tick than branch-1's; computed once and shared, both
            // branches must see the exact same value regardless of how many ticks Logger
            // burns in between.
            let clock = Date.now();
            jest.spyOn(Date, "now").mockImplementation(() => {
                clock += 1;
                return clock;
            });

            await service.sendDailySummaryNotifications();

            const calls = messageTriggerJobRepository.findRecentUndeliveredByBranch.mock.calls;
            expect(calls).toHaveLength(2);
            const [, sinceBranch1] = calls[0] as [string, Date, Date, number];
            const [, sinceBranch2] = calls[1] as [string, Date, Date, number];
            expect(sinceBranch1.getTime()).toBe(sinceBranch2.getTime());
        });

        it("should still send a digest from the other sections when the undelivered-messages query fails", async () => {
            messageTriggerJobRepository.findRecentUndeliveredByBranch.mockRejectedValue(new Error("db down"));

            await service.sendDailySummaryNotifications();

            expect(notificationService.sendDailyDigestToBranchUsers).toHaveBeenCalledTimes(1);
            const [, , sections] = digestCall();
            expect(sections.map((section) => section.key)).toEqual([
                "upcoming",
                "ending",
                "incompleteContracts",
                "contractsNotSent",
            ]);
            expect(systemSettingService.setPwaUndeliveredDigestWatermark).not.toHaveBeenCalled();
        });
    });
});
