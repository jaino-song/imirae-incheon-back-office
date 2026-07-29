import { NotFoundException } from "@nestjs/common";

import { AdminServiceRecordHeaderEditService } from "application/services/admin-service-record-header-edit.service";
import { ServiceRecordHeaderEditTokenService } from "application/services/service-record-header-edit-token.service";
import { ServiceRecordLinkService } from "application/services/service-record-link.service";
import { PrismaService } from "infrastructure/database/prisma.service";

describe("AdminServiceRecordHeaderEditService", () => {
    const prisma = {
        employee_schedule: {
            findFirst: jest.fn(),
        },
        service_record_case: {
            findFirst: jest.fn(),
        },
    };
    const linkService = {
        prepareLink: jest.fn(),
    };
    const tokenService = {
        issue: jest.fn(),
    };
    const service = new AdminServiceRecordHeaderEditService(
        prisma as unknown as PrismaService,
        linkService as unknown as ServiceRecordLinkService,
        tokenService as unknown as ServiceRecordHeaderEditTokenService,
    );

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("issues a short-lived capability for the tenant-owned assignment and actual form link", async () => {
        prisma.employee_schedule.findFirst.mockResolvedValue({
            clientId: 100,
            primaryEmployeeId: 20,
        });
        prisma.service_record_case.findFirst.mockResolvedValue({ id: "case-1" });
        linkService.prepareLink.mockResolvedValue({
            serviceRecordUrl: "https://mobile.test/service-record/efl_actual",
            preparedLinkToken: "efl_actual",
            expiresAt: new Date("2026-07-31T00:00:00.000Z"),
        });
        tokenService.issue.mockResolvedValue({
            token: "sreh_admin_token",
            expiresAt: new Date("2026-07-29T12:05:00.000Z"),
        });

        await expect(service.createLink("branch-1", 10, "admin-1")).resolves.toEqual({
            serviceRecordUrl: "https://mobile.test/service-record/efl_actual#header-edit=sreh_admin_token",
            expiresAt: new Date("2026-07-29T12:05:00.000Z"),
        });
        expect(prisma.employee_schedule.findFirst).toHaveBeenCalledWith({
            where: {
                id: 10,
                branchId: "branch-1",
                replaced: false,
            },
            select: {
                clientId: true,
                primaryEmployeeId: true,
            },
        });
        expect(tokenService.issue).toHaveBeenCalledWith({
            branchId: "branch-1",
            scheduleId: 10,
            employeeId: 20,
            serviceRecordCaseId: "case-1",
            linkToken: "efl_actual",
            issuedBy: "admin-1",
        });
    });

    it("does not prepare or issue a link for an assignment outside the tenant", async () => {
        prisma.employee_schedule.findFirst.mockResolvedValue(null);

        await expect(service.createLink("branch-2", 10, "admin-1"))
            .rejects.toBeInstanceOf(NotFoundException);
        expect(linkService.prepareLink).not.toHaveBeenCalled();
        expect(tokenService.issue).not.toHaveBeenCalled();
    });
});
