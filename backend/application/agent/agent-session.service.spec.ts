import { ConfigService } from "@nestjs/config";

import type { IAgentSessionRepository } from "domain/repositories/agent-session.repository.interface";
import { AgentSessionService } from "./agent-session.service";

describe("AgentSessionService", () => {
    const owner = { userId: "user-a", branchId: "branch-a" };
    const repository = {
        create: jest.fn(), list: jest.fn(), findOwned: jest.fn(), updateOwned: jest.fn(),
        deleteOwned: jest.fn(), appendMessages: jest.fn(), deleteExpired: jest.fn(),
    } as jest.Mocked<IAgentSessionRepository>;

    beforeEach(() => jest.resetAllMocks());

    it("passes user and branch ownership through every resource lookup", async () => {
        repository.findOwned.mockResolvedValue(null);
        const service = new AgentSessionService(repository, new ConfigService());
        await expect(service.get("session-a", owner)).rejects.toThrow("Agent session not found");
        expect(repository.findOwned).toHaveBeenCalledWith("session-a", owner);
    });

    it("uses configurable retention and clears entity memory without moving branches", async () => {
        repository.create.mockImplementation(async (input) => ({
            ...input, id: "session-a", title: null, summary: null, selectedEntities: {},
            createdAt: new Date(), updatedAt: new Date(), archivedAt: null, messages: [],
        }));
        repository.updateOwned.mockImplementation(async (id, scopedOwner, patch) => ({
            id, ...scopedOwner, locale: "ko", title: null, summary: null, selectedEntities: patch.selectedEntities ?? {},
            model: "stub", agentVersion: "v1", createdAt: new Date(), updatedAt: new Date(),
            expiresAt: new Date(), archivedAt: null, messages: [],
        }));
        const service = new AgentSessionService(repository, new ConfigService({ AGENT_RETENTION_DAYS: "7" }));
        const created = await service.create(owner, "ko", "stub", "v1");
        expect(created.expiresAt.getTime()).toBeGreaterThan(Date.now() + 6 * 24 * 60 * 60 * 1000);

        await service.clearEntityMemory("session-a", owner);
        expect(repository.updateOwned).toHaveBeenCalledWith("session-a", owner, { selectedEntities: {} });
    });
});
