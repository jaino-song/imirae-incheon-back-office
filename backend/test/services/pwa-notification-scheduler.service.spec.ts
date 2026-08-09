import { PwaNotificationSchedulerService } from "application/services/pwa-notification-scheduler.service";
import { DailyDigestSection, NotificationService } from "application/services/notification.service";
import { IBranchRepository } from "domain/repositories/branch.repository.interface";
import { IClientRepository } from "domain/repositories/client.repository.interface";

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
    let service: PwaNotificationSchedulerService;

    const digestCall = (index = 0): [string, string, DailyDigestSection[], typeof emailTemplateContext] =>
        notificationService.sendDailyDigestToBranchUsers.mock.calls[index];

    beforeEach(() => {
        service = new PwaNotificationSchedulerService(
            notificationService as unknown as NotificationService,
            clientRepository as unknown as IClientRepository,
            branchRepository as unknown as IBranchRepository,
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
        notificationService.sendDailyDigestToBranchUsers.mockResolvedValue({ sent: 2, failed: 0 });
    });

    afterEach(() => {
        jest.clearAllMocks();
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
                clientNames: ["김지혜"],
            },
        ]);
    });

    it("should not send anything when every query comes back empty", async () => {
        clientRepository.findStartingWithinDays.mockResolvedValue([]);
        clientRepository.findEndingWithinDays.mockResolvedValue([]);
        clientRepository.findWithIncompleteContractsStartingWithinDays.mockResolvedValue([]);
        clientRepository.findWithoutContractSentStartingWithinDays.mockResolvedValue([]);

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
});
