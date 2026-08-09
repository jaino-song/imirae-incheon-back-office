import { BadRequestException, NotFoundException } from "@nestjs/common";

import { ConsultationInquiryService } from "application/services/consultation-inquiry.service";
import { ConsultationInquiryEntity } from "domain/entities/consultation-inquiry.entity";
import { IConsultationInquiryRepository } from "domain/repositories/consultation-inquiry.repository.interface";
import { NotificationService } from "application/services/notification.service";

describe("ConsultationInquiryService", () => {
    const createRepository = (): jest.Mocked<IConsultationInquiryRepository> => ({
        findActiveBranchBySlug: jest.fn(),
        findNotificationRecipientUserIds: jest.fn(),
        create: jest.fn(),
        findManyByBranch: jest.fn(),
        markRead: jest.fn(),
    });

    const createNotificationService = (): jest.Mocked<Pick<NotificationService, "sendNotification">> => ({
        sendNotification: jest.fn().mockResolvedValue({}),
    });

    const createInquiry = (): ConsultationInquiryEntity => ({
        id: "inq-1",
        branchId: "branch-1",
        publicBranchSlug: "incheon-yeonsu",
        motherName: "김지은",
        phone: "010-1234-5678",
        address: "인천 연수구",
        dueDate: new Date("2026-05-01"),
        birthExperience: "초산",
        voucherType: null,
        preferredCaregiverName: null,
        referralSource: "검색",
        privacyAcceptedAt: new Date("2026-04-21T00:00:00.000Z"),
        selectedServices: null,
        additionalNotes: null,
        source: "website",
        status: "new",
        readAt: null,
        createdAt: new Date("2026-04-21T00:00:00.000Z"),
        updatedAt: new Date("2026-04-21T00:00:00.000Z"),
        branchName: "인천 연수구점",
    });

    let repository: jest.Mocked<IConsultationInquiryRepository>;
    let notificationService: jest.Mocked<Pick<NotificationService, "sendNotification">>;
    let service: ConsultationInquiryService;

    beforeEach(() => {
        repository = createRepository();
        notificationService = createNotificationService();
        service = new ConsultationInquiryService(
            repository,
            notificationService as unknown as NotificationService,
        );
    });

    it("should route Incheon district public inquiry to the canonical Incheon branch", async () => {
        const inquiry = createInquiry();
        repository.findActiveBranchBySlug.mockResolvedValue({
            id: "branch-1",
            name: "인천점",
            slug: "incheon",
        });
        repository.create.mockResolvedValue(inquiry);
        repository.findNotificationRecipientUserIds.mockResolvedValue(["user-1", "user-2"]);

        const result = await service.createPublicInquiry({
            branchSlug: "incheon-yeonsu",
            motherName: "김지은",
            phone: "010-1234-5678",
            address: "인천 연수구",
            dueDate: "2026-05-01",
            birthExperience: "초산",
            referralSource: "검색",
            privacyAccepted: true,
        });

        expect(result).toBe(inquiry);
        expect(repository.findActiveBranchBySlug).toHaveBeenCalledWith("incheon");
        expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({
            branchId: "branch-1",
            publicBranchSlug: "incheon-yeonsu",
            motherName: "김지은",
            status: "new",
            source: "website",
            selectedServices: null,
            additionalNotes: null,
        }));
    });

    it("should pass additional notes when provided", async () => {
        const inquiry = { ...createInquiry(), additionalNotes: "밤 시간 상담을 원합니다." };
        repository.findActiveBranchBySlug.mockResolvedValue({
            id: "branch-1",
            name: "인천점",
            slug: "incheon",
        });
        repository.create.mockResolvedValue(inquiry);
        repository.findNotificationRecipientUserIds.mockResolvedValue([]);

        await service.createPublicInquiry({
            branchSlug: "incheon-yeonsu",
            motherName: "김지은",
            phone: "010-1234-5678",
            address: "인천 연수구",
            dueDate: "2026-05-01",
            birthExperience: "초산",
            referralSource: "검색",
            privacyAccepted: true,
            additionalNotes: "  밤 시간 상담을 원합니다.  ",
        });

        expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({
            additionalNotes: "밤 시간 상담을 원합니다.",
        }));
    });

    it("should accept frontend booking payload contract", async () => {
        const inquiry = {
            ...createInquiry(),
            dueDate: new Date("2026-06-01T00:00:00.000Z"),
            additionalNotes: "모바일 parity 테스트",
        };
        repository.findActiveBranchBySlug.mockResolvedValue({
            id: "branch-1",
            name: "인천점",
            slug: "incheon",
        });
        repository.create.mockResolvedValue(inquiry);
        repository.findNotificationRecipientUserIds.mockResolvedValue([]);

        await service.createPublicInquiry({
            branchSlug: "incheon-yeonsu",
            motherName: "테스트산모",
            phone: "010-1234-5678",
            address: "중구 테스트동",
            dueDate: "2026-06-01",
            birthExperience: "초산",
            voucherType: null,
            preferredCaregiverName: "",
            referralSource: "네이버 검색",
            additionalNotes: "모바일 parity 테스트",
            privacyAccepted: true,
            selectedServices: {
                plan: null,
                addons: [],
            },
        });

        expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({
            dueDate: new Date("2026-06-01T00:00:00.000Z"),
            voucherType: null,
            preferredCaregiverName: null,
            additionalNotes: "모바일 parity 테스트",
            selectedServices: {
                plan: null,
                addons: [],
            },
        }));
    });

    it("should normalize unknown voucher sentinel to null", async () => {
        const inquiry = createInquiry();
        repository.findActiveBranchBySlug.mockResolvedValue({
            id: "branch-1",
            name: "인천점",
            slug: "incheon",
        });
        repository.create.mockResolvedValue(inquiry);
        repository.findNotificationRecipientUserIds.mockResolvedValue([]);

        await service.createPublicInquiry({
            branchSlug: "incheon-yeonsu",
            motherName: "김지은",
            phone: "010-1234-5678",
            address: "인천 연수구",
            dueDate: "2026-05-01",
            birthExperience: "초산",
            voucherType: "__unknown__",
            referralSource: "검색",
            privacyAccepted: true,
        });

        expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({
            voucherType: null,
        }));
    });

    it("should pass selected service snapshot when provided", async () => {
        const inquiry = createInquiry();
        const selectedServices = {
            plan: {
                id: "unsub-10",
                name: "10일",
                priceLabel: "조회 후 안내",
                durationDays: 10,
            },
            addons: [
                {
                    id: "school-age",
                    name: "취학 자녀 케어 서비스",
                    priceLabel: "5,000원",
                    quantity: 10,
                    group: "care",
                },
            ],
        };
        repository.findActiveBranchBySlug.mockResolvedValue({
            id: "branch-1",
            name: "인천 연수구점",
            slug: "incheon-yeonsu",
        });
        repository.create.mockResolvedValue({ ...inquiry, selectedServices });
        repository.findNotificationRecipientUserIds.mockResolvedValue(["user-1", "user-2"]);

        await service.createPublicInquiry({
            branchSlug: "incheon-yeonsu",
            motherName: "김지은",
            phone: "010-1234-5678",
            address: "인천 연수구",
            dueDate: "2026-05-01",
            birthExperience: "초산",
            referralSource: "검색",
            privacyAccepted: true,
            selectedServices,
        });

        expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({
            selectedServices,
        }));
        await new Promise(process.nextTick);
        expect(notificationService.sendNotification).toHaveBeenCalledTimes(2);
        expect(notificationService.sendNotification).toHaveBeenCalledWith(
            "branch-1",
            "user-1",
            "새 상담 문의",
            "김지은님의 상담 문의가 접수되었습니다.",
            expect.objectContaining({
                url: "/consultations",
                type: "consultation-inquiry",
                inquiryId: "inq-1",
                branchSlug: "incheon-yeonsu",
            }),
        );
    });

    it("should route non-Incheon public inquiry to its matching branch", async () => {
        const inquiry = {
            ...createInquiry(),
            branchId: "branch-bucheon",
            publicBranchSlug: "bucheon",
            branchName: "부천점",
        };
        repository.findActiveBranchBySlug.mockResolvedValue({
            id: "branch-bucheon",
            name: "부천점",
            slug: "bucheon",
        });
        repository.create.mockResolvedValue(inquiry);
        repository.findNotificationRecipientUserIds.mockResolvedValue([]);

        const result = await service.createPublicInquiry({
            branchSlug: "bucheon",
            motherName: "김지은",
            phone: "010-1234-5678",
            address: "경기도 부천시",
            dueDate: "2026-05-01",
            birthExperience: "초산",
            referralSource: "검색",
            privacyAccepted: true,
        });

        expect(result).toBe(inquiry);
        expect(repository.findActiveBranchBySlug).toHaveBeenCalledWith("bucheon");
        expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({
            branchId: "branch-bucheon",
            publicBranchSlug: "bucheon",
        }));
    });

    it("should reject public inquiry when privacy is not accepted", async () => {
        await expect(service.createPublicInquiry({
            branchSlug: "incheon-yeonsu",
            motherName: "김지은",
            phone: "010-1234-5678",
            address: "인천 연수구",
            dueDate: "2026-05-01",
            birthExperience: "초산",
            referralSource: "검색",
            privacyAccepted: false,
        })).rejects.toBeInstanceOf(BadRequestException);
    });

    it("should reject public inquiry when branch is missing", async () => {
        repository.findActiveBranchBySlug.mockResolvedValue(null);

        await expect(service.createPublicInquiry({
            branchSlug: "unknown",
            motherName: "김지은",
            phone: "010-1234-5678",
            address: "인천 연수구",
            dueDate: "2026-05-01",
            birthExperience: "초산",
            referralSource: "검색",
            privacyAccepted: true,
        })).rejects.toBeInstanceOf(NotFoundException);
    });

    it("should reject invalid calendar due date", async () => {
        repository.findActiveBranchBySlug.mockResolvedValue({
            id: "branch-1",
            name: "인천점",
            slug: "incheon",
        });

        await expect(service.createPublicInquiry({
            branchSlug: "incheon-yeonsu",
            motherName: "김지은",
            phone: "010-1234-5678",
            address: "인천 연수구",
            dueDate: "2026-02-31",
            birthExperience: "초산",
            referralSource: "검색",
            privacyAccepted: true,
        })).rejects.toBeInstanceOf(BadRequestException);
        expect(repository.create).not.toHaveBeenCalled();
    });

    it("should list branch-scoped inquiries with defaults", async () => {
        const inquiry = createInquiry();
        repository.findManyByBranch.mockResolvedValue({ data: [inquiry], total: 1 });

        const result = await service.listForBranch("branch-1", {});

        expect(repository.findManyByBranch).toHaveBeenCalledWith({
            branchId: "branch-1",
            page: 1,
            limit: 20,
            search: undefined,
            status: "all",
            readState: "all",
            phone: undefined,
        });
        expect(result).toEqual({
            data: [inquiry],
            total: 1,
            page: 1,
            limit: 20,
            totalPages: 1,
        });
    });

    it("should mark inquiry as read", async () => {
        const inquiry = { ...createInquiry(), readAt: new Date("2026-04-22T00:00:00.000Z") };
        repository.markRead.mockResolvedValue(inquiry);

        const result = await service.markRead("branch-1", "inq-1");

        expect(repository.markRead).toHaveBeenCalledWith("branch-1", "inq-1");
        expect(result.readAt).toEqual(inquiry.readAt);
    });
});
