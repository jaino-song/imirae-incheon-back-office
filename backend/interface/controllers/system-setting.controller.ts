import { Body, Controller, Get, Param, Post, Put, Request, UseGuards } from "@nestjs/common";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { OwnerGuard } from "infrastructure/auth/owner.guard";
import { OwnerOrAdminGuard } from "infrastructure/auth/owner-or-admin.guard";
import { SystemSettingService } from "application/services/system-setting.service";
import { EformsignAutomationStatusService } from "application/services/eformsign-automation-status.service";
import {
    UpdateNotificationPreferencesDto,
    NotificationPreferencesResponseDto,
    UpdateRibbonConfigDto,
    RibbonConfigResponseDto,
    UpdateClientRegistrationPolicyDto,
    ClientRegistrationPolicyResponseDto,
} from "interface/dto/system-setting.dto";
import {
    MessageSenderApprovalResponseDto,
} from "interface/dto/message-sender-approval.dto";
import {
    MessageAutomationPastTriggerConfigDto,
    MessageAutomationPoliciesResponseDto,
    UpdateMessageAutomationPastTriggerConfigDto,
} from "interface/dto/message-automation-policy.dto";
import { TenantGuard, CurrentTenant } from "infrastructure/tenant";
import { MessageSenderApprovalService } from "application/services/message-sender-approval.service";
import { runWithAdminAuditActor } from "application/services/admin-audit-context";
import {
    ContractAutomationPoliciesResponseDto,
    ContractAutoFinalizeConfigDto,
    UpdateContractAutoFinalizeConfigDto,
} from "interface/dto/contract-automation-policy.dto";

type SettingsTenant = {
    userId?: string;
    branchId?: string;
    globalRole?: string;
    branchRole?: string;
};

@Controller("settings")
@UseGuards(JwtGuard)
export class SystemSettingController {
    constructor(
        private readonly systemSettingService: SystemSettingService,
        private readonly messageSenderApprovalService: MessageSenderApprovalService,
        private readonly eformsignAutomationStatusService: EformsignAutomationStatusService,
    ) {}

    @Get("notification-preferences")
    async getNotificationPreferences(
        @Request() request: { user: { userId: string } },
    ): Promise<NotificationPreferencesResponseDto> {
        const emailNotificationsEnabled =
            await this.systemSettingService.getUserEmailNotificationsEnabled(request.user.userId);

        return NotificationPreferencesResponseDto.from(emailNotificationsEnabled);
    }

    @Put("notification-preferences")
    async updateNotificationPreferences(
        @Request() request: { user: { userId: string; role?: string; branchRole?: string } },
        @Body() dto: UpdateNotificationPreferencesDto,
    ): Promise<NotificationPreferencesResponseDto> {
        const entity = await runWithAdminAuditActor({
            userId: request.user.userId,
            globalRole: request.user.role,
            branchRole: request.user.branchRole,
        }, () => this.systemSettingService.setUserEmailNotificationsEnabled(
            request.user.userId,
            dto.emailNotificationsEnabled,
        ));

        return NotificationPreferencesResponseDto.from(
            entity.value === "true",
            entity.updatedAt,
        );
    }

    @Get("message-sender-approval")
    @UseGuards(TenantGuard)
    async getMessageSenderApproval(
        @CurrentTenant() tenant: { branchId?: string; branchRole?: string },
    ): Promise<MessageSenderApprovalResponseDto> {
        const state = await this.messageSenderApprovalService.getState(
            tenant.branchId ?? "",
        );
        return MessageSenderApprovalResponseDto.from({
            ...state,
            canRequest: this.messageSenderApprovalService.canRequest(tenant.branchRole),
        });
    }

    @Get("message-automation-policies")
    @UseGuards(TenantGuard)
    async getMessageAutomationPolicies(
        @CurrentTenant() tenant?: { branchId?: string },
    ): Promise<MessageAutomationPoliciesResponseDto> {
        const pastTriggerConfig = await this.systemSettingService.getMessageAutomationPastTriggerConfig(
            tenant?.branchId ?? "",
        );
        return MessageAutomationPoliciesResponseDto.from(pastTriggerConfig);
    }

    @Put("message-automation-policies/past-trigger")
    @UseGuards(TenantGuard, OwnerOrAdminGuard)
    async updateMessageAutomationPastTriggerConfig(
        @CurrentTenant() tenant: SettingsTenant,
        @Body() dto: UpdateMessageAutomationPastTriggerConfigDto,
    ): Promise<MessageAutomationPastTriggerConfigDto> {
        const entity = await runWithAdminAuditActor({
            userId: tenant.userId,
            globalRole: tenant.globalRole,
            branchRole: tenant.branchRole,
        }, () => this.systemSettingService.setMessageAutomationPastTriggerConfig(
            tenant.branchId ?? "",
            {
                sendIntervalMinutes: dto.sendIntervalMinutes,
                ruleOrder: dto.ruleOrder,
            },
        ));
        return MessageAutomationPastTriggerConfigDto.from(JSON.parse(entity.value));
    }

    @Get("contract-automation-policies")
    @UseGuards(TenantGuard)
    async getContractAutomationPolicies(
        @CurrentTenant() tenant?: { branchId?: string },
    ): Promise<ContractAutomationPoliciesResponseDto> {
        const config = await this.systemSettingService.getContractAutoFinalizeConfig(tenant?.branchId ?? "");
        return ContractAutomationPoliciesResponseDto.from(config);
    }

    @Put("contract-automation-policies/auto-finalize")
    @UseGuards(TenantGuard, OwnerOrAdminGuard)
    async updateContractAutoFinalizeConfig(
        @CurrentTenant() tenant: SettingsTenant,
        @Body() dto: UpdateContractAutoFinalizeConfigDto,
    ): Promise<ContractAutoFinalizeConfigDto> {
        const entity = await runWithAdminAuditActor({
            userId: tenant.userId,
            globalRole: tenant.globalRole,
            branchRole: tenant.branchRole,
        }, () => this.systemSettingService.setContractAutoFinalizeConfig(
            tenant.branchId ?? "",
            { enabled: dto.enabled, graceDays: dto.graceDays, maxAttempts: dto.maxAttempts },
        ));
        return ContractAutoFinalizeConfigDto.from(JSON.parse(entity.value));
    }

    @Get("client-registration-policy")
    @UseGuards(TenantGuard)
    async getClientRegistrationPolicy(
        @CurrentTenant() tenant?: { branchId?: string },
    ): Promise<ClientRegistrationPolicyResponseDto> {
        const branchId = tenant?.branchId ?? "";
        const [clientAutoRegistration, greetingOnAutoRegistration] = await Promise.all([
            this.systemSettingService.getClientAutoRegistrationEnabled(branchId),
            this.systemSettingService.getGreetingOnAutoRegistrationEnabled(branchId),
        ]);

        return ClientRegistrationPolicyResponseDto.from(
            clientAutoRegistration,
            greetingOnAutoRegistration,
            this.eformsignAutomationStatusService.getStatus(),
        );
    }

    @Put("client-registration-policy")
    @UseGuards(TenantGuard, OwnerOrAdminGuard)
    async updateClientRegistrationPolicy(
        @CurrentTenant() tenant: SettingsTenant,
        @Request() request: { user?: { userId?: string; role?: string; branchRole?: string } },
        @Body() dto: UpdateClientRegistrationPolicyDto,
    ): Promise<ClientRegistrationPolicyResponseDto> {
        const branchId = tenant.branchId ?? "";

        if (dto.clientAutoRegistration !== undefined) {
            await runWithAdminAuditActor({
                userId: tenant.userId ?? request.user?.userId,
                globalRole: tenant.globalRole ?? request.user?.role,
                branchRole: tenant.branchRole ?? request.user?.branchRole,
            }, () => this.systemSettingService.setClientAutoRegistrationEnabled(
                branchId,
                dto.clientAutoRegistration!,
            ));
        }
        if (dto.greetingOnAutoRegistration !== undefined) {
            await runWithAdminAuditActor({
                userId: tenant.userId ?? request.user?.userId,
                globalRole: tenant.globalRole ?? request.user?.role,
                branchRole: tenant.branchRole ?? request.user?.branchRole,
            }, () => this.systemSettingService.setGreetingOnAutoRegistrationEnabled(
                branchId,
                dto.greetingOnAutoRegistration!,
            ));
        }

        const [clientAutoRegistration, greetingOnAutoRegistration] = await Promise.all([
            this.systemSettingService.getClientAutoRegistrationEnabled(branchId),
            this.systemSettingService.getGreetingOnAutoRegistrationEnabled(branchId),
        ]);

        return ClientRegistrationPolicyResponseDto.from(
            clientAutoRegistration,
            greetingOnAutoRegistration,
            this.eformsignAutomationStatusService.getStatus(),
        );
    }

    @Put("ribbon-config")
    @UseGuards(OwnerGuard)
    async updateRibbonConfig(
        @Body() dto: UpdateRibbonConfigDto,
        @Request() request: { user?: { userId?: string; role?: string; branchRole?: string } },
    ): Promise<RibbonConfigResponseDto> {
        const entity = await runWithAdminAuditActor({
            userId: request.user?.userId,
            globalRole: request.user?.role,
            branchRole: request.user?.branchRole,
        }, () => this.systemSettingService.setRibbonConfig({
            enabled: dto.enabled,
            message: dto.message,
            backgroundColor: dto.backgroundColor,
            textColor: dto.textColor,
            linkText: dto.linkText ?? "",
            linkHref: dto.linkHref ?? "",
            linkColor: dto.linkColor,
        }));
        const config = JSON.parse(entity.value);
        return RibbonConfigResponseDto.from(config, entity.updatedAt);
    }

    @Post("message-sender-approval/request")
    @UseGuards(TenantGuard)
    async requestMessageSenderApproval(
        @CurrentTenant() tenant: SettingsTenant,
        @Request() request: { user: { userId: string } },
    ): Promise<MessageSenderApprovalResponseDto> {
        const state = await runWithAdminAuditActor({
            userId: tenant.userId ?? request.user.userId,
            globalRole: tenant.globalRole,
            branchRole: tenant.branchRole,
        }, () => this.messageSenderApprovalService.requestApproval({
            branchId: tenant.branchId ?? "",
            branchRole: tenant.branchRole,
            userId: request.user.userId,
        }));

        return MessageSenderApprovalResponseDto.from({
            ...state,
            canRequest: this.messageSenderApprovalService.canRequest(tenant.branchRole),
        });
    }

    @Post("message-sender-approval/:branchId/approve")
    @UseGuards(OwnerGuard)
    async approveMessageSenderApproval(
        @Param("branchId") branchId: string,
        @Request() request: { user: { userId: string; role?: string; branchRole?: string } },
    ): Promise<MessageSenderApprovalResponseDto> {
        const state = await runWithAdminAuditActor({
            userId: request.user.userId,
            globalRole: request.user.role,
            branchRole: request.user.branchRole,
        }, () => this.messageSenderApprovalService.approvePendingRequest({
            branchId,
            userId: request.user.userId,
        }));

        return MessageSenderApprovalResponseDto.from({
            ...state,
            canRequest: false,
        });
    }
}
