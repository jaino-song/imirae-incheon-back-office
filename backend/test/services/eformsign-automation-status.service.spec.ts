import { ConfigService } from "@nestjs/config";

import { EformsignAutomationStatusService } from "application/services/eformsign-automation-status.service";

type EnvMap = Record<string, string | undefined>;

const ALL_SWEEP_CREDENTIALS: EnvMap = {
    EFORMSIGN_USER_EMAIL: "staff@example.com",
    EFORMSIGN_API_URL: "https://api.eformsign.com",
    EFORMSIGN_DOC_API_URL: "https://kr-api.eformsign.com",
    EFORMSIGN_API_KEY: "api-key",
    EFORMSIGN_PRIVATE_KEY: "private-key",
    EFORMSIGN_COMPANY_ID: "company-id",
    EFORMSIGN_TEMPLATE_ID: "template-id",
    EFORMSIGN_WEBHOOK_SECRET: "webhook-secret",
};

const createConfigService = (env: EnvMap): ConfigService =>
    ({
        get: (key: string): string | undefined => env[key],
    }) as unknown as ConfigService;

describe("EformsignAutomationStatusService", () => {
    const createService = (env: EnvMap): EformsignAutomationStatusService =>
        new EformsignAutomationStatusService(createConfigService(env));

    const withCredentials = (extra: EnvMap = {}): EnvMap => ({ ...ALL_SWEEP_CREDENTIALS, ...extra });

    it("should return status: every gate open when the single-replica approval is set", () => {
        const status = createService(withCredentials({
            EFORMSIGN_RECONCILE_ALLOW_UNLOCKED: "true",
        })).getStatus();

        expect(status).toEqual({
            webhookConfigured: true,
            sweepEnabled: true,
            sweepRunnable: true,
        });
    });

    it("should return status: runnable with a cross-instance lock instead of the approval flag", () => {
        const status = createService(withCredentials({
            VALKEY_URL: "redis://valkey:6379",
        })).getStatus();

        expect(status.sweepRunnable).toBe(true);
    });

    it("should report a non-runnable sweep when neither VALKEY_URL nor the approval flag exists", () => {
        // This is the deployment shape that silently disabled auto client
        // registration: credentials are fine, but the sweep always skipped.
        const status = createService(withCredentials()).getStatus();

        expect(status.sweepEnabled).toBe(true);
        expect(status.sweepRunnable).toBe(false);
    });

    it("should respect an explicit EFORMSIGN_RECONCILE_ENABLED=false pause", () => {
        const status = createService(withCredentials({
            EFORMSIGN_RECONCILE_ENABLED: "false",
            EFORMSIGN_RECONCILE_ALLOW_UNLOCKED: "true",
        })).getStatus();

        expect(status.sweepEnabled).toBe(false);
        expect(status.sweepRunnable).toBe(false);
    });

    it("should keep the sweep disabled when required credentials are missing", () => {
        const env = withCredentials({ EFORMSIGN_PRIVATE_KEY: "" });
        const status = createService(env).getStatus();

        expect(status.sweepEnabled).toBe(false);
        expect(status.sweepRunnable).toBe(false);
    });

    it("should treat an empty EFORMSIGN_RECONCILE_ENABLED as unset", () => {
        const status = createService(withCredentials({
            EFORMSIGN_RECONCILE_ENABLED: "",
            EFORMSIGN_RECONCILE_ALLOW_UNLOCKED: "true",
        })).getStatus();

        expect(status.sweepEnabled).toBe(true);
    });

    it("should report the webhook unconfigured when the secret is missing", () => {
        const status = createService(withCredentials({ EFORMSIGN_WEBHOOK_SECRET: "" })).getStatus();

        expect(status.webhookConfigured).toBe(false);
    });

    it("should fall back to EFORMSIGN_COMPANY_ID for webhook tenant validation", () => {
        const status = createService(withCredentials({
            EFORMSIGN_WEBHOOK_ALLOWED_COMPANY_IDS: "",
        })).getStatus();

        expect(status.webhookConfigured).toBe(true);
    });

    it("should report the webhook unconfigured when the allowlist holds no usable id", () => {
        // Mirrors the guard: a whitespace-only list resolves to zero allowed ids,
        // so every delivery would be rejected as an unknown tenant.
        const status = createService(withCredentials({
            EFORMSIGN_WEBHOOK_ALLOWED_COMPANY_IDS: " , ",
        })).getStatus();

        expect(status.webhookConfigured).toBe(false);
    });

    it("should report the webhook unconfigured when no company id source yields a value", () => {
        const status = createService(withCredentials({
            EFORMSIGN_WEBHOOK_ALLOWED_COMPANY_IDS: "",
            EFORMSIGN_COMPANY_ID: "",
        })).getStatus();

        expect(status.webhookConfigured).toBe(false);
    });
});
