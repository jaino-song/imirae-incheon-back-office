import { Body, Controller, Get, Param, ParseIntPipe, Post, UseGuards } from "@nestjs/common";
import { AdminServiceRecordService } from "application/services/admin-service-record.service";
import { AdminServiceRecordHeaderEditService } from "application/services/admin-service-record-header-edit.service";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { CurrentTenant, TenantGuard } from "infrastructure/tenant";
import {
    PrepareAdminServiceRecordLinkDto,
    SendAdminServiceRecordLinkDto,
} from "interface/dto/admin-service-record.dto";

@Controller("admin/service-records")
@UseGuards(JwtGuard, TenantGuard)
export class AdminServiceRecordController {
    constructor(
        private readonly adminServiceRecordService: AdminServiceRecordService,
        private readonly headerEditService: AdminServiceRecordHeaderEditService,
    ) {}

    @Get("client/:clientId")
    getClientOverview(
        @CurrentTenant() tenant: { branchId?: string },
        @Param("clientId", ParseIntPipe) clientId: number,
    ) {
        return this.adminServiceRecordService.getClientOverview(tenant.branchId ?? "", clientId);
    }

    @Post("schedules/:scheduleId/prepare-link")
    prepareLink(
        @CurrentTenant() tenant: { branchId?: string },
        @Param("scheduleId", ParseIntPipe) scheduleId: number,
        @Body() body: PrepareAdminServiceRecordLinkDto,
    ) {
        return this.adminServiceRecordService.prepareLink(
            tenant.branchId ?? "",
            scheduleId,
            body?.recipientPhone,
        );
    }

    @Post("schedules/:scheduleId/send-link")
    async sendLinkNow(
        @CurrentTenant() tenant: { branchId?: string },
        @Param("scheduleId", ParseIntPipe) scheduleId: number,
        @Body() body: SendAdminServiceRecordLinkDto,
    ) {
        return this.adminServiceRecordService.sendLinkNow(
            tenant.branchId ?? "",
            scheduleId,
            body?.preparedLinkToken,
            body?.recipientPhone,
        );
    }

    @Post("schedules/:scheduleId/reset-link")
    resetLink(
        @CurrentTenant() tenant: { branchId?: string },
        @Param("scheduleId", ParseIntPipe) scheduleId: number,
    ) {
        return this.adminServiceRecordService.resetLink(tenant.branchId ?? "", scheduleId);
    }

    @Post("schedules/:scheduleId/header-edit-link")
    createHeaderEditLink(
        @CurrentTenant() tenant: { branchId?: string; userId?: string },
        @Param("scheduleId", ParseIntPipe) scheduleId: number,
    ) {
        return this.headerEditService.createLink(
            tenant.branchId ?? "",
            scheduleId,
            tenant.userId ?? "",
        );
    }
}
