import {
    Body,
    Controller,
    ForbiddenException,
    Get,
    HttpCode,
    Param,
    Post,
    UseGuards,
} from "@nestjs/common";
import { CallIngestTokenService } from "application/services/call-ingest-token.service";
import { CreateCallIngestTokenDto } from "interface/dto/call-inbox.dto";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { TenantGuard } from "infrastructure/tenant/tenant.guard";
import { TenantContext } from "infrastructure/tenant/tenant.context";

/** Phase 1 ops-level provisioning: owner-only (spec §5). */
@Controller()
@UseGuards(JwtGuard, TenantGuard)
export class CallIngestTokenController {
    constructor(
        private readonly tokenService: CallIngestTokenService,
        private readonly tenantContext: TenantContext,
    ) {}

    private assertOwner(): void {
        if (this.tenantContext.role !== "owner") {
            throw new ForbiddenException("Owner role required");
        }
    }

    @Post("branches/:branchId/call-ingest-tokens")
    async create(@Param("branchId") branchId: string, @Body() dto: CreateCallIngestTokenDto) {
        this.assertOwner();
        if (branchId !== this.tenantContext.branchId) {
            throw new ForbiddenException("Cannot manage tokens for another branch");
        }
        return this.tokenService.createToken(branchId, dto.label);
    }

    @Get("branches/:branchId/call-ingest-tokens")
    async list(@Param("branchId") branchId: string) {
        this.assertOwner();
        if (branchId !== this.tenantContext.branchId) {
            throw new ForbiddenException("Cannot manage tokens for another branch");
        }
        return this.tokenService.list(branchId);
    }

    @Post("call-ingest-tokens/:id/revoke")
    @HttpCode(200)
    async revoke(@Param("id") id: string) {
        this.assertOwner();
        await this.tokenService.revoke(id, this.tenantContext.branchId);
        return { success: true };
    }
}
