import { BadRequestException } from "@nestjs/common";
import { ContractClientAssignmentGuardService } from "application/services/contract-client-assignment-guard.service";
import { PrismaService } from "infrastructure/database/prisma.service";

describe("ContractClientAssignmentGuardService", () => {
    const branchId = "branch-1";
    const createPrisma = () => ({
        employee_schedule: {
            findFirst: jest.fn(),
        },
        client: {
            findFirst: jest.fn().mockResolvedValue({ serviceStatus: "active" }),
        },
    });

    it("rejects contract creation when the client has no active assignment", async () => {
        const prisma = createPrisma();
        prisma.employee_schedule.findFirst.mockResolvedValue(null);
        const service = new ContractClientAssignmentGuardService(prisma as unknown as PrismaService);

        await expect(
            service.assertAssignedProvider(branchId, 55, "010-1111-2222"),
        ).rejects.toBeInstanceOf(BadRequestException);

        expect(prisma.employee_schedule.findFirst).toHaveBeenCalledWith({
            where: { clientId: 55, branchId, replaced: false },
            orderBy: { id: "desc" },
            select: {
                id: true,
                terminatedAt: true,
                primaryEmployee: { select: { phone: true } },
            },
        });
    });

    it("rejects contract creation when the document provider differs from the persisted assignment", async () => {
        const prisma = createPrisma();
        prisma.employee_schedule.findFirst.mockResolvedValue({
            id: 10,
            terminatedAt: null,
            primaryEmployee: { phone: "010-9999-0000" },
        });
        const service = new ContractClientAssignmentGuardService(prisma as unknown as PrismaService);

        await expect(
            service.assertAssignedProvider(branchId, 55, "010-1111-2222"),
        ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("accepts formatting differences for the assigned provider phone", async () => {
        const prisma = createPrisma();
        prisma.employee_schedule.findFirst.mockResolvedValue({
            id: 10,
            terminatedAt: null,
            primaryEmployee: { phone: "01011112222" },
        });
        const service = new ContractClientAssignmentGuardService(prisma as unknown as PrismaService);

        await expect(
            service.assertAssignedProvider(branchId, 55, "010-1111-2222"),
        ).resolves.toEqual({ scheduleId: 10 });
    });

    describe("ownership checks stay blind to termination", () => {
        // These two pin the finalize path. FinalizeDocumentHeadlessUsecase.assertOwnedTarget
        // runs under the nightly auto-finalize cron against contracts that sit at review
        // stage 070 until their end date. Termination does not void a contract the 산모
        // already signed, so if these ever started rejecting a terminated client the cron
        // would burn its attempts and strand that document at 070 permanently.
        const terminatedSchedule = {
            id: 10,
            terminatedAt: new Date("2026-08-25T00:00:00.000Z"),
            primaryEmployee: { phone: "01011112222" },
        };

        it("still resolves ownership for a terminated assignment", async () => {
            const prisma = createPrisma();
            prisma.employee_schedule.findFirst.mockResolvedValue(terminatedSchedule);
            const service = new ContractClientAssignmentGuardService(prisma as unknown as PrismaService);

            await expect(service.assertAssignedClient(branchId, 55)).resolves.toEqual({ scheduleId: 10 });
            await expect(
                service.assertAssignedProvider(branchId, 55, "010-1111-2222"),
            ).resolves.toEqual({ scheduleId: 10 });
        });

        it("does not read the client row at all", async () => {
            const prisma = createPrisma();
            prisma.employee_schedule.findFirst.mockResolvedValue(terminatedSchedule);
            const service = new ContractClientAssignmentGuardService(prisma as unknown as PrismaService);

            await service.assertAssignedClient(branchId, 55);

            expect(prisma.client.findFirst).not.toHaveBeenCalled();
        });
    });

    describe("send-side liveness", () => {
        it("accepts a live assignment", async () => {
            const prisma = createPrisma();
            prisma.employee_schedule.findFirst.mockResolvedValue({
                id: 10,
                terminatedAt: null,
                primaryEmployee: { phone: "01011112222" },
            });
            const service = new ContractClientAssignmentGuardService(prisma as unknown as PrismaService);

            await expect(service.assertLiveAssignedClient(branchId, 55)).resolves.toEqual({ scheduleId: 10 });
            await expect(
                service.assertLiveAssignedProvider(branchId, 55, "010-1111-2222"),
            ).resolves.toEqual({ scheduleId: 10 });
        });

        it("refuses a terminated assignment", async () => {
            const prisma = createPrisma();
            prisma.employee_schedule.findFirst.mockResolvedValue({
                id: 10,
                terminatedAt: new Date("2026-08-25T00:00:00.000Z"),
                primaryEmployee: { phone: "01011112222" },
            });
            const service = new ContractClientAssignmentGuardService(prisma as unknown as PrismaService);

            await expect(service.assertLiveAssignedClient(branchId, 55)).rejects.toThrow("해지된 고객에게는 전자문서를 발송할 수 없습니다.");
        });

        it("reports termination rather than a provider mismatch, even when the provider matches", async () => {
            const prisma = createPrisma();
            prisma.employee_schedule.findFirst.mockResolvedValue({
                id: 10,
                terminatedAt: new Date("2026-08-25T00:00:00.000Z"),
                primaryEmployee: { phone: "01011112222" },
            });
            const service = new ContractClientAssignmentGuardService(prisma as unknown as PrismaService);

            await expect(
                service.assertLiveAssignedProvider(branchId, 55, "010-1111-2222"),
            ).rejects.toThrow("해지된 고객에게는 전자문서를 발송할 수 없습니다.");
        });

        it("refuses a client whose status was set to 중단 without the termination flow", async () => {
            // The ordinary client update accepts serviceStatus=terminated and writes no
            // schedule row, so terminated_at alone would miss this one.
            const prisma = createPrisma();
            prisma.employee_schedule.findFirst.mockResolvedValue({
                id: 10,
                terminatedAt: null,
                primaryEmployee: { phone: "01011112222" },
            });
            prisma.client.findFirst.mockResolvedValue({ serviceStatus: "terminated" });
            const service = new ContractClientAssignmentGuardService(prisma as unknown as PrismaService);

            await expect(service.assertLiveAssignedClient(branchId, 55)).rejects.toThrow("해지된 고객에게는 전자문서를 발송할 수 없습니다.");
            expect(prisma.client.findFirst).toHaveBeenCalledWith({
                where: { id: 55, branchId },
                select: { serviceStatus: true },
            });
        });

        it("still reports a missing assignment before it looks at liveness", async () => {
            const prisma = createPrisma();
            prisma.employee_schedule.findFirst.mockResolvedValue(null);
            const service = new ContractClientAssignmentGuardService(prisma as unknown as PrismaService);

            await expect(service.assertLiveAssignedClient(branchId, 55)).rejects.toThrow("고객의 제공인력 배정을 먼저 저장해 주세요.");
        });
    });
});
