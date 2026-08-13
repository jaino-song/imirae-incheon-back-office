import { Body, Controller, ForbiddenException, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";

import { ActionCoordinatorService } from "application/agent/action-coordinator.service";
import { AgentActionApproveDto, AgentActionRejectDto } from "interface/dto/agent.dto";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { TenantGuard } from "infrastructure/tenant";
import type { VerifiedTenantPrincipal } from "infrastructure/tenant/tenant.context";

type AgentActionRequest = Request & { tenant?: VerifiedTenantPrincipal };

@Controller("ai/actions")
@UseGuards(JwtGuard, TenantGuard)
export class AgentActionController {
    constructor(private readonly actions: ActionCoordinatorService) {}

    @Get()
    list(@Req() request: AgentActionRequest) {
        return this.actions.list(this.owner(request));
    }

    @Get(":id")
    get(@Param("id") id: string, @Req() request: AgentActionRequest) {
        return this.actions.get(id, this.owner(request));
    }

    @Post(":id/approve")
    approve(
        @Param("id") id: string,
        @Body() dto: AgentActionApproveDto,
        @Req() request: AgentActionRequest,
    ) {
        return this.actions.approve(id, this.principal(request), dto.expectedRevision, dto.acknowledgementToken);
    }

    @Post(":id/reject")
    reject(
        @Param("id") id: string,
        @Body() dto: AgentActionRejectDto,
        @Req() request: AgentActionRequest,
    ) {
        return this.actions.reject(id, this.principal(request), dto.reason);
    }

    @Post(":id/reconcile")
    reconcile(
        @Param("id") id: string,
        @Req() request: AgentActionRequest,
    ) {
        return this.actions.reconcile(id, this.principal(request));
    }

    private owner(request: AgentActionRequest) {
        const principal = this.principal(request);
        return { userId: principal.userId, branchId: principal.branchId };
    }

    private principal(request: AgentActionRequest): VerifiedTenantPrincipal {
        if (!request.tenant?.userId || !request.tenant.branchId) {
            throw new ForbiddenException("Verified tenant principal missing");
        }
        return request.tenant;
    }
}
