import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, UseGuards } from "@nestjs/common";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { OwnerOrAdminGuard } from "infrastructure/auth/owner-or-admin.guard";
import { CurrentTenant, TenantGuard } from "infrastructure/tenant";
import { MessageTriggerService } from "application/services/message-trigger.service";
import { SmsRetryService } from "application/services/sms-retry.service";
import {
    MessageTriggerEventType,
    MessageTriggerRecipientType,
} from "domain/constants/message-trigger-catalog";
import {
    CreateMessageTriggerRuleDto,
    UpdateMessageTriggerRuleDto,
    UpdateMessageTriggerRuleBranchActivationDto,
} from "interface/dto/message-trigger.dto";
import { parseInteger } from "interface/parse-integer";
import { SmsProviderReconciliationDto } from "interface/dto/sms-provider-reconciliation.dto";

@Controller()
@UseGuards(JwtGuard, TenantGuard)
export class MessageTriggerController {
    constructor(
        private readonly triggerService: MessageTriggerService,
        private readonly smsRetryService: SmsRetryService,
    ) {}

    @Get("message-trigger-rules")
    listRules(@CurrentTenant() tenant: { branchId?: string }) {
        return this.triggerService.listRules(tenant.branchId ?? "");
    }

    @Get("message-trigger-jobs/upcoming")
    listUpcomingJobs(
        @CurrentTenant() tenant: { branchId?: string },
        @Query("limit") limit?: string,
    ) {
        return this.triggerService.listUpcomingJobs(
            tenant.branchId ?? "",
            parseInteger(limit, "limit", { defaultValue: 200, min: 1, max: 500 }),
        );
    }

    @Post("message-trigger-jobs/:id/cancel")
    cancelJob(
        @CurrentTenant() tenant: { branchId?: string },
        @Param("id") id: string,
    ) {
        return this.triggerService.cancelJobByUser(tenant.branchId ?? "", id);
    }

    @Get("message-logs")
    listHistory(
        @CurrentTenant() tenant: { branchId?: string },
        @Query("limit") limit?: string,
        @Query("skip") skip?: string,
    ) {
        return this.triggerService.listHistory(
            tenant.branchId ?? "",
            parseInteger(limit, "limit", { defaultValue: 200, min: 1, max: 500 }),
            parseInteger(skip, "skip", { defaultValue: 0, min: 0 }),
        );
    }

    @Post("message-logs/:id/retry")
    retryHistory(
        @CurrentTenant() tenant: { branchId?: string },
        @Param("id") id: string,
    ) {
        return this.smsRetryService.retryById(
            tenant.branchId ?? "",
            parseInteger(id, "id", { min: 1 }),
        );
    }

    @Post("message-logs/:id/reconcile")
    @UseGuards(OwnerOrAdminGuard)
    reconcileHistory(
        @CurrentTenant() tenant: { branchId?: string; userId?: string },
        @Param("id") id: string,
        @Body() dto: SmsProviderReconciliationDto,
    ) {
        return this.smsRetryService.reconcileById(
            tenant.branchId ?? "",
            parseInteger(id, "id", { min: 1 }),
            dto.outcome,
            tenant.userId ?? "",
            dto.reason,
            dto.providerMessageId,
        );
    }

    @Post("message-trigger-rules")
    createRule(
        @CurrentTenant() tenant: { branchId?: string },
        @Body() dto: CreateMessageTriggerRuleDto,
    ) {
        return this.triggerService.createRule(tenant.branchId ?? "", dto);
    }

    @Get("message-trigger-rules/:id")
    getRule(
        @CurrentTenant() tenant: { branchId?: string },
        @Param("id") id: string,
    ) {
        return this.triggerService.getRule(tenant.branchId ?? "", id);
    }

    @Patch("message-trigger-rules/:id")
    updateRule(
        @CurrentTenant() tenant: { branchId?: string },
        @Param("id") id: string,
        @Body() dto: UpdateMessageTriggerRuleDto,
    ) {
        return this.triggerService.updateRule(tenant.branchId ?? "", id, dto);
    }

    @Put("message-trigger-rules/:id/branch-activation")
    updateBranchActivation(
        @CurrentTenant() tenant: { branchId?: string },
        @Param("id") id: string,
        @Body() dto: UpdateMessageTriggerRuleBranchActivationDto,
    ) {
        return this.triggerService.updateRuleBranchActivation(tenant.branchId ?? "", id, dto.isActive);
    }

    @Delete("message-trigger-rules/:id")
    deleteRule(
        @CurrentTenant() tenant: { branchId?: string },
        @Param("id") id: string,
    ) {
        return this.triggerService.deleteRule(tenant.branchId ?? "", id);
    }

    @Get("message-trigger-templates")
    listTemplates(
        @Query("eventType") eventType?: MessageTriggerEventType,
        @Query("recipientType") recipientType?: MessageTriggerRecipientType,
    ) {
        return this.triggerService.listTemplates({ eventType, recipientType });
    }
}
