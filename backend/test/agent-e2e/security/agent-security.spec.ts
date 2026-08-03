import { ConfigService } from "@nestjs/config";
import { ForbiddenException } from "@nestjs/common";
import { AgentRateLimitService } from "application/agent/agent-rate-limit.service";
import { AgentSessionService } from "application/agent/agent-session.service";
import { abortWhenResponseCloses, AgentController } from "interface/controllers/agent.controller";
import { redactModelValue } from "application/agent/agent-runtime.service";
import type { IAgentSessionRepository } from "domain/repositories/agent-session.repository.interface";
import { EventEmitter } from "node:events";

describe("Release A agent security boundaries", () => {
    const repository = {
        create: jest.fn(), list: jest.fn(), findOwned: jest.fn(), updateOwned: jest.fn(), deleteOwned: jest.fn(), appendMessages: jest.fn(), deleteExpired: jest.fn(),
    } as jest.Mocked<IAgentSessionRepository>;

    beforeEach(() => jest.resetAllMocks());

    it("denies cross-user and cross-branch session reads through the same owner predicate", async () => {
        repository.findOwned.mockResolvedValue(null);
        const service = new AgentSessionService(repository, new ConfigService());
        await expect(service.get("session", { userId: "other", branchId: "other-branch" })).rejects.toThrow("Agent session not found");
        expect(repository.findOwned).toHaveBeenCalledWith("session", { userId: "other", branchId: "other-branch" });
    });

    it("enforces a per-user and branch rate limit", async () => {
        const service = new AgentRateLimitService(new ConfigService({ AGENT_RATE_LIMIT_PER_MINUTE: "1" }));
        await service.check("user", "branch");
        await expect(service.check("user", "branch")).rejects.toThrow("Agent rate limit exceeded");
        await expect(service.check("user", "other-branch")).resolves.toBeUndefined();
        service.onModuleDestroy();
    });

    it("treats expired and invalid session ids as unavailable", async () => {
        repository.findOwned.mockResolvedValue(null);
        const service = new AgentSessionService(repository, new ConfigService());
        await expect(service.get("expired-session", { userId: "user", branchId: "branch" })).rejects.toThrow("Agent session not found");
        expect(repository.findOwned).toHaveBeenCalledWith("expired-session", { userId: "user", branchId: "branch" });
    });

    it("clears entity memory using the same user-plus-branch predicate", async () => {
        repository.updateOwned.mockResolvedValue({
            id: "session", userId: "user", branchId: "branch", locale: "ko", title: null, summary: null,
            selectedEntities: {}, model: "stub", agentVersion: "release-a.1", createdAt: new Date(), updatedAt: new Date(),
            expiresAt: new Date(Date.now() + 60_000), archivedAt: null, messages: [],
        });
        const service = new AgentSessionService(repository, new ConfigService());
        await service.clearEntityMemory("session", { userId: "user", branchId: "branch" });
        expect(repository.updateOwned).toHaveBeenCalledWith("session", { userId: "user", branchId: "branch" }, { selectedEntities: {} });
    });

    it("fails closed when the controller has no verified principal", async () => {
        const controller = new AgentController(
            {} as never, {} as never, { list: () => [] } as never, {} as never, {} as never, {} as never,
        );
        await expect(controller.capabilities({} as never)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("aborts model work when the response connection closes before completion", () => {
        const response = Object.assign(new EventEmitter(), { writableFinished: false });
        const controller = new AbortController();

        abortWhenResponseCloses(response as never, controller);
        response.emit("close");

        expect(controller.signal.aborted).toBe(true);
    });

    it("does not start model work when the response closes during rate-limit I/O", async () => {
        let releaseRateLimit!: () => void;
        const runtime = { stream: jest.fn() };
        const rateLimit = { check: jest.fn().mockImplementation(() => new Promise<void>((resolve) => { releaseRateLimit = resolve; })) };
        const controller = new AgentController(
            runtime as never,
            {} as never,
            { list: () => [] } as never,
            {} as never,
            rateLimit as never,
            {} as never,
        );
        const response = Object.assign(new EventEmitter(), { writableFinished: false, destroyed: false, closed: false });
        const pending = controller.chat(
            { messages: [{ id: "message", role: "user", parts: [{ type: "text", text: "질문" }] }] } as never,
            { tenant: { userId: "user", branchId: "branch", globalRole: "admin", branchRole: "admin" } } as never,
            response as never,
        );

        response.emit("close");
        releaseRateLimit();
        await pending;

        expect(runtime.stream).not.toHaveBeenCalled();
    });

    it("aborts immediately when listener registration sees an already-closed response", () => {
        const response = Object.assign(new EventEmitter(), { writableFinished: false, destroyed: true, closed: true });
        const controller = new AbortController();

        abortWhenResponseCloses(response as never, controller);

        expect(controller.signal.aborted).toBe(true);
    });

    it("minimizes structured model payloads before provider calls", () => {
        const value = redactModelValue({ id: 1, phone: "010-0000-0000", address: "비공개", text: "전화 010-0000-0000 또는 https://private.example/a", nested: { documentContent: "secret", label: "safe" } });
        expect(value).toEqual({ id: 1, text: "전화 [redacted] 또는 [redacted]", nested: { label: "safe" } });
    });
});
