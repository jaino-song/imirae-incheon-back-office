import { Body, Controller, Get, Param, ParseIntPipe, Post, UseGuards } from "@nestjs/common";
import {
    AdminServiceRecordService,
    ServiceRecordAdminActor,
} from "application/services/admin-service-record.service";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { OwnerOrAdminGuard } from "infrastructure/auth/owner-or-admin.guard";
import { CurrentTenant, TenantGuard, VerifiedTenantPrincipal } from "infrastructure/tenant";
import {
    PrepareAdminServiceRecordLinkDto,
    SendAdminServiceRecordLinkDto,
} from "interface/dto/admin-service-record.dto";

@Controller("admin/service-records")
@UseGuards(JwtGuard, TenantGuard)
export class AdminServiceRecordController {
    constructor(private readonly adminServiceRecordService: AdminServiceRecordService) {}

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
    @UseGuards(OwnerOrAdminGuard)
    resetLink(
        @CurrentTenant() tenant: VerifiedTenantPrincipal,
        @Param("scheduleId", ParseIntPipe) scheduleId: number,
    ) {
        const actor: ServiceRecordAdminActor = {
            userId: tenant.userId,
            globalRole: tenant.globalRole,
            branchRole: tenant.branchRole,
        };
        return this.adminServiceRecordService.resetLink(tenant.branchId, scheduleId, actor);
    }
}
