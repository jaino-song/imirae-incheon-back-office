import { IsBoolean, IsOptional, IsString, Matches } from "class-validator";
import { RibbonConfig } from "domain/entities/system-setting.entity";
import type { EformsignAutomationStatus } from "application/services/eformsign-automation-status.service";

export class UpdateNotificationPreferencesDto {
    @IsBoolean()
    emailNotificationsEnabled!: boolean;
}

export class NotificationPreferencesResponseDto {
    emailNotificationsEnabled!: boolean;
    updatedAt?: string;

    static from(emailNotificationsEnabled: boolean, updatedAt?: Date): NotificationPreferencesResponseDto {
        const dto = new NotificationPreferencesResponseDto();
        dto.emailNotificationsEnabled = emailNotificationsEnabled;
        dto.updatedAt = updatedAt?.toISOString();
        return dto;
    }
}

const HEX_COLOR_REGEX = /^#[0-9A-Fa-f]{6}$/;

export class UpdateRibbonConfigDto {
    @IsBoolean()
    enabled!: boolean;

    @IsString()
    message!: string;

    @IsString()
    @Matches(HEX_COLOR_REGEX)
    backgroundColor!: string;

    @IsString()
    @Matches(HEX_COLOR_REGEX)
    textColor!: string;

    @IsString()
    @IsOptional()
    linkText!: string;

    @IsString()
    @IsOptional()
    linkHref!: string;

    @IsString()
    @Matches(HEX_COLOR_REGEX)
    linkColor!: string;
}

export class UpdateClientRegistrationPolicyDto {
    @IsBoolean()
    @IsOptional()
    clientAutoRegistration?: boolean;

    @IsBoolean()
    @IsOptional()
    greetingOnAutoRegistration?: boolean;
}

export class ClientRegistrationPolicyAutomationStatusDto {
    webhookConfigured!: boolean;
    sweepEnabled!: boolean;
    sweepRunnable!: boolean;
    /**
     * Inbound webhook deliveries in the last 24 hours, and how many of them
     * changed nothing. "Configured" only says the endpoint could be called;
     * these two say whether anything actually arrived and landed.
     */
    webhookReceived24h!: number;
    webhookDropped24h!: number;

    static from(
        automation: EformsignAutomationStatus,
        webhookCounts: { received: number; dropped: number } = { received: 0, dropped: 0 },
    ): ClientRegistrationPolicyAutomationStatusDto {
        const dto = new ClientRegistrationPolicyAutomationStatusDto();
        dto.webhookConfigured = automation.webhookConfigured;
        dto.sweepEnabled = automation.sweepEnabled;
        dto.sweepRunnable = automation.sweepRunnable;
        dto.webhookReceived24h = webhookCounts.received;
        dto.webhookDropped24h = webhookCounts.dropped;
        return dto;
    }
}

export class ClientRegistrationPolicyResponseDto {
    clientAutoRegistration!: boolean;
    greetingOnAutoRegistration!: boolean;
    automation!: ClientRegistrationPolicyAutomationStatusDto;

    static from(
        clientAutoRegistration: boolean,
        greetingOnAutoRegistration: boolean,
        automation: EformsignAutomationStatus,
        webhookCounts?: { received: number; dropped: number },
    ): ClientRegistrationPolicyResponseDto {
        const dto = new ClientRegistrationPolicyResponseDto();
        dto.clientAutoRegistration = clientAutoRegistration;
        dto.greetingOnAutoRegistration = greetingOnAutoRegistration;
        dto.automation = ClientRegistrationPolicyAutomationStatusDto.from(automation, webhookCounts);
        return dto;
    }
}

export class RibbonConfigResponseDto {
    enabled!: boolean;
    message!: string;
    backgroundColor!: string;
    textColor!: string;
    linkText!: string;
    linkHref!: string;
    linkColor!: string;
    updatedAt?: string;

    static from(config: RibbonConfig, updatedAt?: Date): RibbonConfigResponseDto {
        const dto = new RibbonConfigResponseDto();
        dto.enabled = config.enabled;
        dto.message = config.message;
        dto.backgroundColor = config.backgroundColor;
        dto.textColor = config.textColor;
        dto.linkText = config.linkText;
        dto.linkHref = config.linkHref;
        dto.linkColor = config.linkColor;
        dto.updatedAt = updatedAt?.toISOString();
        return dto;
    }
}
