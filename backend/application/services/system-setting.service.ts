import { ConflictException, Injectable } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { GetSettingUsecase, UpdateSettingUsecase } from "application/usecases/system-setting";
import {
    SystemSettingEntity,
    RibbonConfig,
    DEFAULT_RIBBON_CONFIG,
    MessageAutomationPastTriggerConfig,
    DEFAULT_MESSAGE_AUTOMATION_PAST_TRIGGER_CONFIG,
} from "domain/entities/system-setting.entity";

export type PwaDigestDeliveryStatus = "sent" | "retryable" | "uncertain";

interface PwaDigestDeliveryState {
    status: "processing" | PwaDigestDeliveryStatus;
    token: string;
    leaseExpiresAt?: string;
}

const PWA_DIGEST_DELIVERY_PREFIX = "pwa:daily_digest:";
const PWA_DIGEST_DELIVERY_ABSENT_VERSION = "absent";
const PWA_DIGEST_DELIVERY_LEASE_MS = 30 * 60 * 1000;

@Injectable()
export class SystemSettingService {
    constructor(
        private readonly getSettingUsecase: GetSettingUsecase,
        private readonly updateSettingUsecase: UpdateSettingUsecase
    ) {}

    private getUserEmailNotificationPreferenceKey(userId: string): string {
        return `user:${userId}:email_notifications_enabled`;
    }

    private getMessageAutomationPastTriggerConfigKey(branchId: string): string {
        return `branch:${branchId}:message_automation:past_trigger`;
    }

    private getClientAutoRegistrationKey(branchId: string): string {
        return `branch:${branchId}:client_auto_registration`;
    }

    private getGreetingOnAutoRegistrationKey(branchId: string): string {
        return `branch:${branchId}:greeting_on_auto_registration`;
    }

    private getPwaUndeliveredDigestWatermarkKey(branchId: string): string {
        return `branch:${branchId}:pwa_undelivered_digest_watermark`;
    }

    async getUserEmailNotificationsEnabled(userId: string): Promise<boolean> {
        const value = await this.getSettingUsecase.executeWithDefault(
            this.getUserEmailNotificationPreferenceKey(userId),
            "true"
        );

        return value === "true";
    }

    async setUserEmailNotificationsEnabled(userId: string, enabled: boolean): Promise<SystemSettingEntity> {
        return this.updateSettingUsecase.execute(
            this.getUserEmailNotificationPreferenceKey(userId),
            enabled ? "true" : "false"
        );
    }

    async getRibbonConfig(): Promise<RibbonConfig> {
        const value = await this.getSettingUsecase.execute(
            SystemSettingEntity.RIBBON_CONFIG_KEY
        );
        if (!value) return DEFAULT_RIBBON_CONFIG;
        try {
            return { ...DEFAULT_RIBBON_CONFIG, ...JSON.parse(value) };
        } catch {
            return DEFAULT_RIBBON_CONFIG;
        }
    }

    async setRibbonConfig(config: RibbonConfig): Promise<SystemSettingEntity> {
        return this.updateSettingUsecase.execute(
            SystemSettingEntity.RIBBON_CONFIG_KEY,
            JSON.stringify(config)
        );
    }

    async setRibbonConfigIfVersion(
        expectedTargetVersion: string,
        config: RibbonConfig,
    ): Promise<SystemSettingEntity> {
        const normalized = { ...DEFAULT_RIBBON_CONFIG, ...config };
        const updated = await this.updateSettingUsecase.executeIfVersion(
            SystemSettingEntity.RIBBON_CONFIG_KEY,
            JSON.stringify(normalized),
            expectedTargetVersion,
            (rawValue) => this.ribbonTargetVersion(rawValue),
        );
        if (!updated) throw new ConflictException("Ribbon configuration changed after approval");
        return updated;
    }

    async getMessageAutomationPastTriggerConfig(
        branchId: string,
    ): Promise<MessageAutomationPastTriggerConfig> {
        const value = await this.getSettingUsecase.execute(
            this.getMessageAutomationPastTriggerConfigKey(branchId)
        );
        return this.parseMessageAutomationPastTriggerConfig(value);
    }

    async setMessageAutomationPastTriggerConfig(
        branchId: string,
        config: MessageAutomationPastTriggerConfig,
    ): Promise<SystemSettingEntity> {
        const normalized = this.normalizeMessageAutomationPastTriggerConfig(config);
        return this.updateSettingUsecase.execute(
            this.getMessageAutomationPastTriggerConfigKey(branchId),
            JSON.stringify(normalized)
        );
    }

    async getClientAutoRegistrationEnabled(branchId: string): Promise<boolean> {
        const value = await this.getSettingUsecase.executeWithDefault(
            this.getClientAutoRegistrationKey(branchId),
            "true"
        );

        return value === "true";
    }

    async setClientAutoRegistrationEnabled(branchId: string, enabled: boolean): Promise<SystemSettingEntity> {
        return this.updateSettingUsecase.execute(
            this.getClientAutoRegistrationKey(branchId),
            enabled ? "true" : "false"
        );
    }

    async getGreetingOnAutoRegistrationEnabled(branchId: string): Promise<boolean> {
        const value = await this.getSettingUsecase.executeWithDefault(
            this.getGreetingOnAutoRegistrationKey(branchId),
            "false"
        );

        return value === "true";
    }

    async setGreetingOnAutoRegistrationEnabled(branchId: string, enabled: boolean): Promise<SystemSettingEntity> {
        return this.updateSettingUsecase.execute(
            this.getGreetingOnAutoRegistrationKey(branchId),
            enabled ? "true" : "false"
        );
    }

    async getPwaUndeliveredDigestWatermark(branchId: string): Promise<Date | null> {
        const value = await this.getSettingUsecase.execute(
            this.getPwaUndeliveredDigestWatermarkKey(branchId),
        );
        if (!value) return null;
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    async setPwaUndeliveredDigestWatermark(
        branchId: string,
        watermark: Date,
    ): Promise<SystemSettingEntity> {
        return this.updateSettingUsecase.execute(
            this.getPwaUndeliveredDigestWatermarkKey(branchId),
            watermark.toISOString(),
        );
    }

    /**
     * Acquire a durable claim for one logical PWA digest delivery.
     *
     * System settings already provide a row-locked compare-and-set primitive. Reusing it
     * keeps the claim durable without adding a second table or a process-local singleton,
     * so two scheduler replicas converge on one owner even when their cron ticks overlap.
     * A processing claim expires so a crashed owner can be recovered; an uncertain claim is
     * deliberately fail-closed because an external provider may already have accepted it.
     */
    async claimPwaDigestDelivery(
        deliveryKey: string,
        now = new Date(),
    ): Promise<string | null> {
        const key = this.getPwaDigestDeliveryKey(deliveryKey);
        const current = await this.getSettingUsecase.executeEntity(key);
        const state = this.parsePwaDigestDeliveryState(current?.value);

        if (state?.status === "sent" || state?.status === "uncertain") {
            return null;
        }

        if (
            state?.status === "processing"
            && state.leaseExpiresAt
            && new Date(state.leaseExpiresAt).getTime() > now.getTime()
        ) {
            return null;
        }

        const token = randomUUID();
        const nextState: PwaDigestDeliveryState = {
            status: "processing",
            token,
            leaseExpiresAt: new Date(now.getTime() + PWA_DIGEST_DELIVERY_LEASE_MS).toISOString(),
        };
        const expectedVersion = current
            ? this.pwaDigestDeliveryVersion(current.value)
            : PWA_DIGEST_DELIVERY_ABSENT_VERSION;
        const updated = await this.updateSettingUsecase.executeIfVersion(
            key,
            JSON.stringify(nextState),
            expectedVersion,
            (value) => this.pwaDigestDeliveryVersion(value),
        );

        return updated ? token : null;
    }

    /**
     * Resolve a previously claimed delivery. Only the current owner may advance its state;
     * a stale worker finishing after lease recovery cannot overwrite the newer claim.
     */
    async completePwaDigestDelivery(
        deliveryKey: string,
        token: string,
        status: PwaDigestDeliveryStatus,
    ): Promise<boolean> {
        const key = this.getPwaDigestDeliveryKey(deliveryKey);
        const current = await this.getSettingUsecase.executeEntity(key);
        const state = this.parsePwaDigestDeliveryState(current?.value);
        if (!current || !state || state.status !== "processing" || state.token !== token) {
            return false;
        }

        const nextState: PwaDigestDeliveryState = {
            status,
            token,
        };
        const updated = await this.updateSettingUsecase.executeIfVersion(
            key,
            JSON.stringify(nextState),
            this.pwaDigestDeliveryVersion(current.value),
            (value) => this.pwaDigestDeliveryVersion(value),
        );

        return Boolean(updated);
    }

    private parseMessageAutomationPastTriggerConfig(
        value: string | null,
    ): MessageAutomationPastTriggerConfig {
        if (!value) return DEFAULT_MESSAGE_AUTOMATION_PAST_TRIGGER_CONFIG;

        try {
            return this.normalizeMessageAutomationPastTriggerConfig(JSON.parse(value));
        } catch {
            return DEFAULT_MESSAGE_AUTOMATION_PAST_TRIGGER_CONFIG;
        }
    }

    private normalizeMessageAutomationPastTriggerConfig(
        config: unknown,
    ): MessageAutomationPastTriggerConfig {
        if (typeof config !== "object" || config === null) {
            return DEFAULT_MESSAGE_AUTOMATION_PAST_TRIGGER_CONFIG;
        }

        const candidate = config as Partial<MessageAutomationPastTriggerConfig>;
        const sendIntervalMinutes = Number.isInteger(candidate.sendIntervalMinutes)
            ? candidate.sendIntervalMinutes
            : DEFAULT_MESSAGE_AUTOMATION_PAST_TRIGGER_CONFIG.sendIntervalMinutes;
        const ruleOrder = Array.isArray(candidate.ruleOrder)
            ? candidate.ruleOrder.filter((id): id is string => typeof id === "string" && id.length > 0)
            : DEFAULT_MESSAGE_AUTOMATION_PAST_TRIGGER_CONFIG.ruleOrder;

        return {
            sendIntervalMinutes: Math.min(Math.max(sendIntervalMinutes ?? 1, 1), 1440),
            ruleOrder: [...new Set(ruleOrder)],
        };
    }

    private getPwaDigestDeliveryKey(deliveryKey: string): string {
        return `${PWA_DIGEST_DELIVERY_PREFIX}${deliveryKey}`;
    }

    private parsePwaDigestDeliveryState(value: string | null | undefined): PwaDigestDeliveryState | null {
        if (!value) return null;

        try {
            const candidate: unknown = JSON.parse(value);
            if (typeof candidate !== "object" || candidate === null) return null;

            const state = candidate as Partial<PwaDigestDeliveryState>;
            if (
                (state.status !== "processing"
                    && state.status !== "sent"
                    && state.status !== "retryable"
                    && state.status !== "uncertain")
                || typeof state.token !== "string"
                || state.token.length === 0
            ) {
                return null;
            }

            return {
                status: state.status,
                token: state.token,
                ...(typeof state.leaseExpiresAt === "string"
                    ? { leaseExpiresAt: state.leaseExpiresAt }
                    : {}),
            };
        } catch {
            return null;
        }
    }

    private pwaDigestDeliveryVersion(value: string | null): string {
        if (value === null) return PWA_DIGEST_DELIVERY_ABSENT_VERSION;
        return createHash("sha256").update(value).digest("hex");
    }

    private ribbonTargetVersion(rawValue: string | null): string {
        let current = DEFAULT_RIBBON_CONFIG;
        if (rawValue) {
            try {
                current = { ...DEFAULT_RIBBON_CONFIG, ...JSON.parse(rawValue) };
            } catch {
                current = DEFAULT_RIBBON_CONFIG;
            }
        }
        return createHash("sha256").update(JSON.stringify(current)).digest("hex");
    }
}
