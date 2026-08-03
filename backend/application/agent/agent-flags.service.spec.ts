import { ConfigService } from "@nestjs/config";

import { GetSettingUsecase, UpdateSettingUsecase } from "application/usecases/system-setting";

import { AgentFlagsService } from "./agent-flags.service";

const capability = {
    name: "clients.search",
    domain: "clients",
    version: "1.0.0",
    description: "Search clients",
    risk: "read" as const,
    requiredRoles: ["owner", "admin", "user"],
    renderer: "entity-choice" as const,
    flagKey: "agent.capability.clients.search.enabled",
    sideEffect: false,
};

describe("AgentFlagsService", () => {
    const getSetting = { execute: jest.fn() } as unknown as GetSettingUsecase;
    const updateSetting = { execute: jest.fn() } as unknown as UpdateSettingUsecase;

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("should enable reads in non-production by default", async () => {
        const config = new ConfigService({ NODE_ENV: "development" });
        jest.spyOn(getSetting, "execute").mockResolvedValue(null);
        const service = new AgentFlagsService(config, getSetting, updateSetting);

        await expect(service.isCapabilityEnabled(capability, {
            userId: "user-1",
            branchId: "branch-1",
            globalRole: "admin",
            branchRole: "admin",
        })).resolves.toBe(true);
    });

    it("should default production to disabled", async () => {
        const config = new ConfigService({ NODE_ENV: "production" });
        jest.spyOn(getSetting, "execute").mockResolvedValue(null);
        const service = new AgentFlagsService(config, getSetting, updateSetting);

        await expect(service.isCapabilityEnabled(capability, {
            userId: "user-1",
            branchId: "branch-1",
            globalRole: "admin",
            branchRole: "admin",
        })).resolves.toBe(false);
    });

    it("keeps the environment kill switch authoritative over persisted flags", async () => {
        const config = new ConfigService({ NODE_ENV: "production", AGENT_ENABLED: "false", AGENT_READ_ENABLED: "false" });
        jest.spyOn(getSetting, "execute").mockResolvedValue(JSON.stringify({
            enabled: true,
            risks: { read: true },
        }));
        const service = new AgentFlagsService(config, getSetting, updateSetting);

        await expect(service.isCapabilityEnabled(capability, {
            userId: "user-1",
            branchId: "branch-1",
            globalRole: "admin",
            branchRole: "admin",
        })).resolves.toBe(false);
    });

    it("fails closed in production when enabled flags have no explicit rollout allowlist", async () => {
        const config = new ConfigService({ NODE_ENV: "production", AGENT_ENABLED: "true", AGENT_READ_ENABLED: "true" });
        jest.spyOn(getSetting, "execute").mockResolvedValue(JSON.stringify({
            enabled: true,
            rolloutStage: "branch-read",
            risks: { read: true },
            branchAllowlist: [],
        }));
        const service = new AgentFlagsService(config, getSetting, updateSetting);

        await expect(service.isCapabilityEnabled(capability, {
            userId: "user-1", branchId: "branch-1", globalRole: "admin", branchRole: "admin",
        })).resolves.toBe(false);
    });

    it("allows production reads only for the configured rollout stage and branch", async () => {
        const config = new ConfigService({ NODE_ENV: "production", AGENT_ENABLED: "true", AGENT_READ_ENABLED: "true" });
        jest.spyOn(getSetting, "execute").mockResolvedValue(JSON.stringify({
            enabled: true,
            rolloutStage: "branch-read",
            risks: { read: true, "reversible-write": true },
            branchAllowlist: ["branch-1"],
        }));
        const service = new AgentFlagsService(config, getSetting, updateSetting);

        await expect(service.isCapabilityEnabled(capability, {
            userId: "user-1", branchId: "branch-1", globalRole: "admin", branchRole: "admin",
        })).resolves.toBe(true);
        await expect(service.isCapabilityEnabled({ ...capability, name: "clients.update", risk: "reversible-write", sideEffect: true }, {
            userId: "user-1", branchId: "branch-1", globalRole: "admin", branchRole: "admin",
        })).resolves.toBe(false);
    });

    it("should enforce domain, capability, branch, and user switches", async () => {
        const config = new ConfigService({ NODE_ENV: "development" });
        jest.spyOn(getSetting, "execute").mockResolvedValue(JSON.stringify({
            enabled: true,
            domains: { clients: true },
            capabilities: { "clients.search": true },
            risks: { read: true },
            branchAllowlist: ["branch-allowed"],
            userAllowlist: ["user-allowed"],
        }));
        const service = new AgentFlagsService(config, getSetting, updateSetting);

        await expect(service.isCapabilityEnabled(capability, {
            userId: "user-denied",
            branchId: "branch-allowed",
            globalRole: "admin",
            branchRole: "admin",
        })).resolves.toBe(false);
    });

    it("requires explicit production activation for every external capability", async () => {
        const config = new ConfigService({ NODE_ENV: "production", AGENT_ENABLED: "true", AGENT_EXTERNAL_ENABLED: "true" });
        const external = { ...capability, name: "messages.sendSms", domain: "messages", risk: "external-side-effect" as const, sideEffect: true };
        jest.spyOn(getSetting, "execute").mockResolvedValue(JSON.stringify({
            enabled: true,
            rolloutStage: "branch-write",
            risks: { "external-side-effect": true },
            branchAllowlist: ["branch-1"],
            capabilities: {},
        }));
        const disabled = new AgentFlagsService(config, getSetting, updateSetting);
        await expect(disabled.isCapabilityEnabled(external, {
            userId: "user-1", branchId: "branch-1", globalRole: "admin", branchRole: "admin",
        })).resolves.toBe(false);

        jest.spyOn(getSetting, "execute").mockResolvedValue(JSON.stringify({
            enabled: true,
            rolloutStage: "branch-write",
            risks: { "external-side-effect": true },
            branchAllowlist: ["branch-1"],
            capabilities: { "messages.sendSms": true },
        }));
        const enabled = new AgentFlagsService(config, getSetting, updateSetting);
        await expect(enabled.isCapabilityEnabled(external, {
            userId: "user-1", branchId: "branch-1", globalRole: "admin", branchRole: "admin",
        })).resolves.toBe(true);
    });

    it("uses only the selected branch role unless the principal is a global owner", async () => {
        const config = new ConfigService({ NODE_ENV: "development" });
        jest.spyOn(getSetting, "execute").mockResolvedValue(null);
        const service = new AgentFlagsService(config, getSetting, updateSetting);
        const restricted = { ...capability, requiredRoles: ["owner", "admin"] };

        await expect(service.isCapabilityEnabled(restricted, {
            userId: "user-1", branchId: "branch-1", globalRole: "admin", branchRole: "user",
        })).resolves.toBe(false);
        await expect(service.isCapabilityEnabled(restricted, {
            userId: "owner-1", branchId: "branch-1", globalRole: "owner", branchRole: "user",
        })).resolves.toBe(true);
    });

    it("observes the uncached emergency disable across service instances", async () => {
        const config = new ConfigService({ NODE_ENV: "development" });
        const values = new Map<string, string>();
        jest.spyOn(getSetting, "execute").mockImplementation(async (key: string) => values.get(key) ?? null);
        jest.spyOn(updateSetting, "execute").mockImplementation(async (key: string, value: string) => {
            values.set(key, value);
            return undefined as never;
        });
        const firstReplica = new AgentFlagsService(config, getSetting, updateSetting);
        const secondReplica = new AgentFlagsService(config, getSetting, updateSetting);

        await expect(secondReplica.isCapabilityEnabled(capability, {
            userId: "user-1", branchId: "branch-1", globalRole: "admin", branchRole: "admin",
        })).resolves.toBe(true);

        await firstReplica.updateConfig({ enabled: false });

        await expect(secondReplica.isCapabilityEnabled(capability, {
            userId: "user-1", branchId: "branch-1", globalRole: "admin", branchRole: "admin",
        })).resolves.toBe(false);
    });
});
