import {
    getConsultationPhoneSearchVariants,
    SbConsultationInquiryRepository,
} from "infrastructure/database/repositories/sb.consultation-inquiry.repository";

describe("getConsultationPhoneSearchVariants", () => {
    it("should include hyphenated and digit-only variants for mobile numbers", () => {
        expect(getConsultationPhoneSearchVariants("010-9641-1878")).toEqual([
            "010-9641-1878",
            "01096411878",
            "010-96411878",
            "0109641-1878",
        ]);
    });

    it("should preserve exact trimmed value for unsupported formats", () => {
        expect(getConsultationPhoneSearchVariants(" 1661-2386 ")).toEqual(["1661-2386"]);
    });
});

describe("SbConsultationInquiryRepository.markRead", () => {
    const branch = { name: "강남점" };
    const baseRow = {
        id: "inquiry-a",
        branchId: "branch-a",
        publicBranchSlug: "gangnam",
        motherName: "산모",
        phone: "010-1234-5678",
        address: "서울",
        dueDate: null,
        birthExperience: null,
        voucherType: null,
        preferredCaregiverName: null,
        referralSource: null,
        privacyAcceptedAt: new Date("2026-08-01T00:00:00.000Z"),
        selectedServices: null,
        additionalNotes: null,
        source: "public",
        status: "new",
        readAt: null as Date | null,
        createdAt: new Date("2026-08-01T00:00:00.000Z"),
        updatedAt: new Date("2026-08-01T00:00:00.000Z"),
        branch,
    };

    function setup() {
        const prisma = {
            consultation_inquiry: {
                updateMany: jest.fn(),
                findFirst: jest.fn(),
            },
        };
        return { prisma, repository: new SbConsultationInquiryRepository(prisma as never) };
    }

    it("marks an unread inquiry and reads back the canonical timestamp", async () => {
        const { prisma, repository } = setup();
        const readAt = new Date("2026-08-04T01:02:03.000Z");
        prisma.consultation_inquiry.updateMany.mockResolvedValue({ count: 1 });
        prisma.consultation_inquiry.findFirst.mockResolvedValue({ ...baseRow, readAt });

        await expect(repository.markRead("branch-a", "inquiry-a")).resolves.toEqual(
            expect.objectContaining({ id: "inquiry-a", branchId: "branch-a", readAt }),
        );
        expect(prisma.consultation_inquiry.updateMany).toHaveBeenCalledWith({
            where: { id: "inquiry-a", branchId: "branch-a", readAt: null },
            data: { readAt: expect.any(Date) },
        });
    });

    it("preserves the first-read timestamp when the inquiry is already read", async () => {
        const { prisma, repository } = setup();
        const firstReadAt = new Date("2026-08-04T01:02:03.000Z");
        prisma.consultation_inquiry.updateMany.mockResolvedValue({ count: 0 });
        prisma.consultation_inquiry.findFirst.mockResolvedValue({ ...baseRow, readAt: firstReadAt });

        await expect(repository.markRead("branch-a", "inquiry-a")).resolves.toEqual(
            expect.objectContaining({ id: "inquiry-a", branchId: "branch-a", readAt: firstReadAt }),
        );
        expect(prisma.consultation_inquiry.updateMany).toHaveBeenCalledTimes(1);
        expect(prisma.consultation_inquiry.updateMany).toHaveBeenCalledWith({
            where: { id: "inquiry-a", branchId: "branch-a", readAt: null },
            data: { readAt: expect.any(Date) },
        });
    });

    it("keeps the existing not-found error when the branch-scoped inquiry disappears", async () => {
        const { prisma, repository } = setup();
        prisma.consultation_inquiry.updateMany.mockResolvedValue({ count: 0 });
        prisma.consultation_inquiry.findFirst.mockResolvedValue(null);

        await expect(repository.markRead("branch-a", "inquiry-a"))
            .rejects.toThrow("Consultation inquiry not found for branch");
        expect(prisma.consultation_inquiry.findFirst).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: "inquiry-a", branchId: "branch-a" },
        }));
    });
});
