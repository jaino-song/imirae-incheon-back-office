import {
    Body,
    Controller,
    Delete,
    Get,
    NotFoundException,
    Param,
    Patch,
    UseGuards,
} from "@nestjs/common";

import { UserService } from "application/services/user.service";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { OwnerOrAdminGuard } from "infrastructure/auth/owner-or-admin.guard";
import {
    CurrentTenant,
    TenantGuard,
    type VerifiedTenantPrincipal,
} from "infrastructure/tenant";
import { UpdateBranchUserDto } from "interface/dto/user.dto";
import { runWithAdminAuditActor } from "application/services/admin-audit-context";

@Controller("branches/:branchId/users")
@UseGuards(JwtGuard, TenantGuard, OwnerOrAdminGuard)
export class BranchUserController {
    constructor(private readonly userService: UserService) {}

    @Get(":userId")
    async findById(
        @Param("branchId") branchId: string,
        @Param("userId") userId: string,
        @CurrentTenant() tenant: VerifiedTenantPrincipal,
    ) {
        this.assertSelectedBranch(branchId, tenant);
        const user = await this.userService.findById(userId, branchId);
        if (!user) {
            throw new NotFoundException("User not found");
        }
        return user;
    }

    @Patch(":userId")
    update(
        @Param("branchId") branchId: string,
        @Param("userId") userId: string,
        @CurrentTenant() tenant: VerifiedTenantPrincipal,
        @Body() dto: UpdateBranchUserDto,
    ) {
        this.assertSelectedBranch(branchId, tenant);
        return runWithAdminAuditActor({
            userId: tenant.userId,
            globalRole: tenant.globalRole,
            branchRole: tenant.branchRole,
        }, () => this.userService.update(userId, {
            branchRole: dto.branchRole,
            callerRole: tenant.globalRole,
            branchId,
        }));
    }

    @Delete(":userId")
    async delete(
        @Param("branchId") branchId: string,
        @Param("userId") userId: string,
        @CurrentTenant() tenant: VerifiedTenantPrincipal,
    ) {
        this.assertSelectedBranch(branchId, tenant);
        const target = await this.userService.findById(userId, branchId);
        if (!target || (target.role === "owner" && tenant.globalRole !== "owner")) {
            throw new NotFoundException("User not found");
        }
        await runWithAdminAuditActor({
            userId: tenant.userId,
            globalRole: tenant.globalRole,
            branchRole: tenant.branchRole,
        }, () => this.userService.delete(userId, branchId));
        return { success: true };
    }

    private assertSelectedBranch(
        branchId: string,
        tenant: VerifiedTenantPrincipal,
    ): void {
        if (!tenant || branchId !== tenant.branchId) {
            throw new NotFoundException("User not found");
        }
    }
}
