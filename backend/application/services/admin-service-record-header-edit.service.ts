import { Injectable, NotFoundException } from "@nestjs/common";

import { PrismaService } from "infrastructure/database/prisma.service";
import { AdminServiceRecordHeaderEditLinkDto } from "interface/dto/admin-service-record.dto";

import { ServiceRecordHeaderEditTokenService } from "./service-record-header-edit-token.service";
import { ServiceRecordLinkService } from "./service-record-link.service";

@Injectable()
export class AdminServiceRecordHeaderEditService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly serviceRecordLinkService: ServiceRecordLinkService,
        private readonly headerEditTokenService: ServiceRecordHeaderEditTokenService,
    ) {}

    async createLink(
        branchId: string,
        scheduleId: number,
        issuedBy: string,
    ): Promise<AdminServiceRecordHeaderEditLinkDto> {
        const schedule = await this.prisma.employee_schedule.findFirst({
            where: {
                id: scheduleId,
                branchId,
                replaced: false,
            },
            select: {
                clientId: true,
                primaryEmployeeId: true,
            },
        });
        if (!schedule) {
            throw new NotFoundException("Assignment not found");
        }

        const [preparedLink, serviceRecordCase] = await Promise.all([
            this.serviceRecordLinkService.prepareLink(scheduleId),
            this.prisma.service_record_case.findFirst({
                where: {
                    branchId,
                    clientId: schedule.clientId,
                },
                select: { id: true },
            }),
        ]);
        const capability = await this.headerEditTokenService.issue({
            branchId,
            scheduleId,
            employeeId: schedule.primaryEmployeeId,
            ...(serviceRecordCase ? { serviceRecordCaseId: serviceRecordCase.id } : {}),
            linkToken: preparedLink.preparedLinkToken,
            issuedBy,
        });

        return {
            serviceRecordUrl: `${preparedLink.serviceRecordUrl}#header-edit=${encodeURIComponent(capability.token)}`,
            expiresAt: capability.expiresAt,
        };
    }
}
