import { Body, Controller, ForbiddenException, HttpCode, Post, Req, UseGuards } from "@nestjs/common";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { CurrentTenant, TenantGuard } from "infrastructure/tenant";
import { ReceiptLinkManualSendService } from "application/services/receipt-link-manual-send.service";
import { SendReceiptLinkDto } from "interface/dto/receipt-link.dto";

@Controller("receipt-links")
@UseGuards(JwtGuard, TenantGuard)
export class ReceiptLinkAdminController {
    constructor(private readonly manualSendService: ReceiptLinkManualSendService) {}

    /** Staff action: queue a "서비스 종료 안내" SMS with a fresh receipt link for the document's client. */
    @Post("send")
    @HttpCode(200)
    async send(
        @Body() dto: SendReceiptLinkDto,
        @CurrentTenant() tenant: { branchId?: string },
        @Req() request: { user?: { userId?: string } },
    ) {
        if (!tenant.branchId) {
            throw new ForbiddenException({ reason: "branch_required" });
        }
        return this.manualSendService.send({
            branchId: tenant.branchId,
            documentId: dto.documentId,
            userId: request.user?.userId ?? null,
        });
    }
}
