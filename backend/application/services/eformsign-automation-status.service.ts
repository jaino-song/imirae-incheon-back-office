import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { resolveEformsignWebhookConfigStatus } from "infrastructure/auth/eformsign-webhook-config";

export interface EformsignAutomationStatus {
    /** The webhook endpoint can accept eformsign deliveries (secret + tenant allowlist present). */
    webhookConfigured: boolean;
    /** The 6-hourly mirror sweep is enabled (credentials present, not explicitly paused). */
    sweepEnabled: boolean;
    /**
     * The sweep can actually start. It is skipped when neither a cross-instance
     * lock (VALKEY_URL) nor the single-replica approval
     * (EFORMSIGN_RECONCILE_ALLOW_UNLOCKED=true) is configured — the state that
     * silently disables auto client registration.
     */
    sweepRunnable: boolean;
}

/** Mirrors EformsignDocReconcileSchedulerService.isEnabled() exactly. */
const SWEEP_REQUIRED_CREDENTIAL_KEYS = [
    "EFORMSIGN_USER_EMAIL",
    "EFORMSIGN_API_URL",
    "EFORMSIGN_DOC_API_URL",
    "EFORMSIGN_API_KEY",
    "EFORMSIGN_PRIVATE_KEY",
    "EFORMSIGN_COMPANY_ID",
    "EFORMSIGN_TEMPLATE_ID",
] as const;

/**
 * Reports whether the document-mirroring triggers behind auto client
 * registration are operational in the current deployment. Values are
 * configuration booleans only — never secret material.
 */
@Injectable()
export class EformsignAutomationStatusService {
    constructor(private readonly configService: ConfigService) {}

    getStatus(): EformsignAutomationStatus {
        const webhookConfigured = resolveEformsignWebhookConfigStatus(this.configService).configured;

        const explicitlyConfigured = this.configService.get<string>("EFORMSIGN_RECONCILE_ENABLED");
        const credentialsPresent = SWEEP_REQUIRED_CREDENTIAL_KEYS.every(
            (key) => Boolean(this.configService.get<string>(key)?.trim()),
        );
        const sweepEnabled = explicitlyConfigured !== undefined && explicitlyConfigured !== ""
            ? explicitlyConfigured === "true"
            : credentialsPresent;

        const crossInstanceLockAvailable = Boolean(this.configService.get<string>("VALKEY_URL")?.trim());
        const singleReplicaRunApproved =
            this.configService.get<string>("EFORMSIGN_RECONCILE_ALLOW_UNLOCKED") === "true";
        const sweepRunnable = sweepEnabled && (crossInstanceLockAvailable || singleReplicaRunApproved);

        return { webhookConfigured, sweepEnabled, sweepRunnable };
    }
}
