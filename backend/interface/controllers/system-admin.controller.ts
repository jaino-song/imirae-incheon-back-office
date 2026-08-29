import { Body, Controller, Get, Param, Patch, Post, Request, UseGuards } from "@nestjs/common";

import { SystemAdminService } from "application/services/system-admin.service";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { OwnerGuard } from "infrastructure/auth/owner.guard";
import {
    CreateSystemAdminBranchDto,
    SystemAdminBranchRequestDto,
    UpdateSystemAdminBranchDto,
} from "interface/dto/system-admin.dto";
import { AdminAuditActor } from "application/services/admin-audit-event.service";
import { runWithAdminAuditActor } from "application/services/admin-audit-context";

@Controller("system-admin")
@UseGuards(JwtGuard, OwnerGuard)
export class SystemAdminController {
    constructor(private readonly systemAdminService: SystemAdminService) {}

    @Get("branch-requests")
    listBranchRequests(): Promise<SystemAdminBranchRequestDto[]> {
        return this.systemAdminService.listBranchRequests();
    }

    @Post("branches")
    createBranch(
        @Body() dto: CreateSystemAdminBranchDto,
        @Request() request: { user?: { userId?: string; role?: string; branchRole?: string } },
    ): Promise<SystemAdminBranchRequestDto> {
        return runWithAdminAuditActor(actorFromRequest(request), () => this.systemAdminService.createBranch(dto));
    }

    @Patch("branches/:branchId")
    updateBranch(
        @Param("branchId") branchId: string,
        @Body() dto: UpdateSystemAdminBranchDto,
        @Request() request: { user?: { userId?: string; role?: string; branchRole?: string } },
    ): Promise<SystemAdminBranchRequestDto> {
        return runWithAdminAuditActor(actorFromRequest(request), () => this.systemAdminService.updateBranch(branchId, dto));
    }
}

function actorFromRequest(request: { user?: { userId?: string; role?: string; branchRole?: string } }): AdminAuditActor {
    return {
        userId: request.user?.userId ?? null,
        globalRole: request.user?.role ?? null,
        branchRole: request.user?.branchRole ?? null,
    };
}
