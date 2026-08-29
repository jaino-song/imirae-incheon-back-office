import { ConfigService } from "@nestjs/config";

export type EformsignWebhookConfigStatus = {
    configured: boolean;
    reason: "ok" | "missing_secret" | "missing_company_ids";
};

/**
 * Single source of truth for whether the eformsign webhook endpoint can accept
 * deliveries. WebhookGuard enforces the same conditions per request; the
 * automation status surface reports them to the settings UI so a silently
 * dead webhook is visible to operators.
 */
export function resolveEformsignWebhookConfigStatus(
    configService: ConfigService,
): EformsignWebhookConfigStatus {
    const secret = configService.get<string>("EFORMSIGN_WEBHOOK_SECRET")?.trim() ?? "";
    if (!secret) {
        return { configured: false, reason: "missing_secret" };
    }

    const allowedCompanyIds = resolveEformsignWebhookAllowedCompanyIds(configService);
    if (allowedCompanyIds.length === 0) {
        return { configured: false, reason: "missing_company_ids" };
    }

    return { configured: true, reason: "ok" };
}

export function resolveEformsignWebhookAllowedCompanyIds(
    configService: ConfigService,
): string[] {
    const webhookAllowedCompanyIds = configService.get<string>("EFORMSIGN_WEBHOOK_ALLOWED_COMPANY_IDS");
    if (typeof webhookAllowedCompanyIds === "string" && webhookAllowedCompanyIds.trim().length > 0) {
        return webhookAllowedCompanyIds
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean);
    }

    const fallbackCompanyId = configService.get<string>("EFORMSIGN_COMPANY_ID")?.trim() ?? "";
    return fallbackCompanyId ? [fallbackCompanyId] : [];
}
