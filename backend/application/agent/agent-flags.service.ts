import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { z } from "zod";

import type { AgentCapabilityMeta } from "@babyjamjam/shared";
import { GetSettingUsecase, UpdateSettingUsecase } from "application/usecases/system-setting";
import type { VerifiedTenantPrincipal } from "infrastructure/tenant/tenant.context";

const AGENT_FLAGS_SETTING_KEY = "agent.flags";
const AGENT_EMERGENCY_DISABLED_SETTING_KEY = "agent.flags.emergency-disabled";
const CACHE_TTL_MS = 30_000;

const AgentFlagsConfigSchema = z.object({
    enabled: z.boolean(),
    rolloutStage: z.enum(["off", "development", "internal", "branch-read", "branch-write"]).default("off"),
    domains: z.record(z.string(), z.boolean()).default({}),
    capabilities: z.record(z.string(), z.boolean()).default({}),
    risks: z.record(z.string(), z.boolean()).default({}),
    branchAllowlist: z.array(z.string().min(1)).default([]),
    userAllowlist: z.array(z.string().min(1)).default([]),
});
const AgentFlagsPatchSchema = AgentFlagsConfigSchema.partial();

export type AgentFlagsConfig = z.infer<typeof AgentFlagsConfigSchema>;

@Injectable()
export class AgentFlagsService {
    private cache: { value: AgentFlagsConfig; expiresAt: number } | null = null;

    constructor(
        private readonly configService: ConfigService,
        private readonly getSettingUsecase: GetSettingUsecase,
        private readonly updateSettingUsecase: UpdateSettingUsecase,
    ) {}

    async getConfig(): Promise<AgentFlagsConfig> {
        const now = Date.now();
        if (this.cache && this.cache.expiresAt > now) {
            return this.cache.value;
        }

        const defaults = this.getEnvironmentDefaults();
        const stored = await this.getSettingUsecase.execute(AGENT_FLAGS_SETTING_KEY);
        const persisted = this.parseStoredFlags(stored);
        const value = AgentFlagsConfigSchema.parse({
            ...defaults,
            ...persisted,
            domains: { ...defaults.domains, ...persisted?.domains },
            capabilities: { ...defaults.capabilities, ...persisted?.capabilities },
            risks: { ...defaults.risks, ...persisted?.risks },
        });

        // Environment kill switches are authoritative so an emergency rollback
        // cannot be undone by a cached or owner-persisted setting.
        if (this.configService.get<string>("AGENT_ENABLED")?.trim().toLowerCase() === "false") {
            value.enabled = false;
        }
        if (this.configService.get<string>("AGENT_READ_ENABLED")?.trim().toLowerCase() === "false") {
            value.risks["read"] = false;
        }

        this.cache = { value, expiresAt: now + CACHE_TTL_MS };
        return value;
    }

    async updateConfig(input: unknown): Promise<AgentFlagsConfig> {
        const patch = AgentFlagsPatchSchema.parse(input);
        const current = await this.getConfig();
        const value = AgentFlagsConfigSchema.parse({
            ...current,
            ...patch,
            domains: { ...current.domains, ...patch.domains },
            capabilities: { ...current.capabilities, ...patch.capabilities },
            risks: { ...current.risks, ...patch.risks },
        });
        if (patch.enabled === false) {
            await this.updateSettingUsecase.execute(AGENT_EMERGENCY_DISABLED_SETTING_KEY, "true");
        }
        await this.updateSettingUsecase.execute(AGENT_FLAGS_SETTING_KEY, JSON.stringify(value));
        if (patch.enabled === true) {
            await this.updateSettingUsecase.execute(AGENT_EMERGENCY_DISABLED_SETTING_KEY, "false");
        }
        this.cache = null;
        return value;
    }

    async isCapabilityEnabled(
        capability: AgentCapabilityMeta,
        principal: VerifiedTenantPrincipal,
    ): Promise<boolean> {
        if (await this.isEmergencyDisabled()) return false;
        const flags = await this.getConfig();
        if (!flags.enabled) return false;
        if (!this.isRolloutStageAllowed(flags, capability, principal)) return false;
        const nodeEnvironment = this.configService.get<string>("NODE_ENV") ?? "development";
        if (nodeEnvironment === "production"
            && ["external-side-effect", "paid-action", "privileged-administration"].includes(capability.risk)
            && flags.capabilities[capability.name] !== true) return false;
        if (flags.domains[capability.domain] === false) return false;
        if (flags.capabilities[capability.name] === false) return false;
        if (flags.risks[capability.risk] === false) return false;
        if (flags.branchAllowlist.length > 0 && !flags.branchAllowlist.includes(principal.branchId)) return false;
        if (flags.userAllowlist.length > 0 && !flags.userAllowlist.includes(principal.userId)) return false;

        return principal.globalRole === "owner"
            ? capability.requiredRoles.includes("owner")
            : capability.requiredRoles.includes(principal.branchRole);
    }

    private async isEmergencyDisabled(): Promise<boolean> {
        const value = await this.getSettingUsecase.execute(AGENT_EMERGENCY_DISABLED_SETTING_KEY);
        return value?.trim().toLowerCase() === "true";
    }

    private isRolloutStageAllowed(
        flags: AgentFlagsConfig,
        capability: AgentCapabilityMeta,
        principal: VerifiedTenantPrincipal,
    ): boolean {
        const nodeEnvironment = this.configService.get<string>("NODE_ENV") ?? "development";
        if (nodeEnvironment !== "production") return flags.rolloutStage !== "off";
        if (flags.rolloutStage === "off" || flags.rolloutStage === "development") return false;
        if (flags.rolloutStage === "internal") {
            return flags.userAllowlist.length > 0 && flags.userAllowlist.includes(principal.userId);
        }
        if (flags.rolloutStage === "branch-read") {
            return capability.risk === "read"
                && flags.branchAllowlist.length > 0
                && flags.branchAllowlist.includes(principal.branchId);
        }
        if (capability.risk === "privileged-administration") {
            return flags.userAllowlist.length > 0
                && flags.userAllowlist.includes(principal.userId)
                && flags.branchAllowlist.length > 0
                && flags.branchAllowlist.includes(principal.branchId);
        }
        return flags.branchAllowlist.length > 0 && flags.branchAllowlist.includes(principal.branchId);
    }

    private getEnvironmentDefaults(): AgentFlagsConfig {
        const nodeEnvironment = this.configService.get<string>("NODE_ENV") ?? "development";
        const enabled = this.parseBoolean(
            this.configService.get<string>("AGENT_ENABLED"),
            nodeEnvironment !== "production",
        );
        const readEnabled = this.parseBoolean(
            this.configService.get<string>("AGENT_READ_ENABLED"),
            true,
        );
        const writeEnabled = this.parseBoolean(
            this.configService.get<string>("AGENT_WRITE_ENABLED"),
            false,
        );
        const externalEnabled = this.parseBoolean(
            this.configService.get<string>("AGENT_EXTERNAL_ENABLED"),
            false,
        );
        const privilegedEnabled = this.parseBoolean(
            this.configService.get<string>("AGENT_PRIVILEGED_ENABLED"),
            false,
        );

        return {
            enabled,
            rolloutStage: this.parseRolloutStage(
                this.configService.get<string>("AGENT_ROLLOUT_STAGE"),
                nodeEnvironment,
            ),
            domains: {},
            capabilities: {},
            risks: {
                read: readEnabled,
                "reversible-write": writeEnabled,
                "irreversible-write": writeEnabled,
                "external-side-effect": externalEnabled,
                "paid-action": externalEnabled,
                "privileged-administration": privilegedEnabled,
            },
            branchAllowlist: this.parseAllowlist(this.configService.get<string>("AGENT_BRANCH_ALLOWLIST")),
            userAllowlist: this.parseAllowlist(this.configService.get<string>("AGENT_USER_ALLOWLIST")),
        };
    }

    private parseStoredFlags(value: string | null): Partial<AgentFlagsConfig> | null {
        if (!value) return null;
        try {
            return AgentFlagsConfigSchema.partial().parse(JSON.parse(value));
        } catch {
            return null;
        }
    }

    private parseBoolean(value: string | undefined, fallback: boolean): boolean {
        if (value === undefined) return fallback;
        return value.trim().toLowerCase() === "true";
    }

    private parseAllowlist(value: string | undefined): string[] {
        if (!value) return [];
        return [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
    }

    private parseRolloutStage(value: string | undefined, nodeEnvironment: string): AgentFlagsConfig["rolloutStage"] {
        if (value !== undefined) {
            const parsed = AgentFlagsConfigSchema.shape.rolloutStage.safeParse(value.trim().toLowerCase());
            if (parsed.success) return parsed.data;
        }
        return nodeEnvironment === "production" ? "off" : "development";
    }
}
