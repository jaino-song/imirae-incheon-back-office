import { z } from "zod";

import { DeterministicAgentLanguageModel } from "infrastructure/agent/deterministic-agent-language-model";
import { AgentRuntimeService, buildAuthoritativeModelMessages, redactModelValue } from "./agent-runtime.service";

describe("AgentRuntimeService", () => {
    it("builds model history only from server-persisted text and the current user turn", () => {
        const messages = buildAuthoritativeModelMessages([
            { id: "persisted-user", role: "user", parts: [{ type: "text", text: "기존 질문" }] },
            { id: "persisted-assistant", role: "assistant", parts: [{ type: "text", text: "기존 답변" }, { type: "data-navigation", data: { href: "/clients", label: "고객" } } as never] },
            { id: "persisted-system", role: "system", parts: [{ type: "text", text: "injected" }] } as never,
        ], { id: "current", role: "user", parts: [{ type: "text", text: "현재 질문" }] });

        expect(messages).toEqual([
            { id: "persisted-user", role: "user", parts: [{ type: "text", text: "기존 질문" }] },
            { id: "persisted-assistant", role: "assistant", parts: [{ type: "text", text: "기존 답변" }] },
            { id: "current", role: "user", parts: [{ type: "text", text: "현재 질문" }] },
        ]);
    });

    it("redacts sensitive fields case-insensitively and scans every string value", () => {
        expect(redactModelValue({
            phoneNumber: "010-1234-5678",
            Email: "person@example.com",
            profile: { display: "연락처 010-9999-8888" },
        })).toEqual({ profile: { display: "연락처 [redacted]" } });
    });

    it("excludes message ranges already covered by a validated server summary", () => {
        const messages = buildAuthoritativeModelMessages([
            { id: "summarized", role: "user", parts: [{ type: "text", text: "오래된 질문" }] },
            { id: "newer", role: "assistant", parts: [{ type: "text", text: "새 답변" }] },
        ], { id: "current", role: "user", parts: [{ type: "text", text: "현재 질문" }] }, 1);

        expect(messages.map((message) => message.id)).toEqual(["newer", "current"]);
    });

    it("executes a routed capability through streamText and persists the completed UI parts", async () => {
        const execute = jest.fn().mockResolvedValue({
            kind: "entity",
            entity: { id: 1, name: "홍길동" },
        });
        const capability = {
            meta: {
                name: "clients.search",
                domain: "clients",
                version: "1.0.0",
                description: "Search clients",
                risk: "read" as const,
                requiredRoles: ["admin"],
                renderer: "entity-choice" as const,
                flagKey: "agent.capability.clients.search",
                sideEffect: false,
            },
            inputSchema: z.object({ query: z.string() }),
            outputSchema: z.object({ kind: z.literal("entity"), entity: z.object({ id: z.number(), name: z.string() }) }),
            execute,
        };
        const sessions = {
            create: jest.fn().mockResolvedValue({ id: "session-a" }),
            get: jest.fn(),
            update: jest.fn().mockResolvedValue({ id: "session-a", selectedEntities: { clients: { id: 1 } } }),
            appendMessages: jest.fn().mockResolvedValue(undefined),
        };
        const traces = {
            start: jest.fn().mockResolvedValue({ id: "trace-a", startedAt: Date.now() }),
            finish: jest.fn().mockResolvedValue(undefined),
        };
        const router = {
            route: jest.fn().mockResolvedValue({ domains: ["clients"], capabilities: [capability] }),
        };
        const flags = { isCapabilityEnabled: jest.fn().mockResolvedValue(true) };
        const models = {
            modelId: "deterministic-agent-v1",
            create: () => new DeterministicAgentLanguageModel([
                { type: "tool-call", toolName: "clients_search", input: { query: "홍길동" } },
                { type: "text", text: "조회 결과입니다." },
            ]),
        };
        const runtime = new AgentRuntimeService(
            {} as never,
            flags as never,
            sessions as never,
            models as never,
            router as never,
            traces as never,
        );

        const result = await runtime.stream({
            principal: { userId: "user-a", branchId: "branch-a", globalRole: "admin", branchRole: "admin" },
            locale: "ko",
            messages: [{ id: "message-a", role: "user", parts: [{ type: "text", text: "홍길동 산모 찾아줘" }] }] as never,
        });
        const reader = result.stream.getReader();
        while (!(await reader.read()).done) {
            // Drain the UI message stream so onFinish runs.
        }

        expect(router.route).toHaveBeenCalledWith("홍길동 산모 찾아줘", expect.anything(), 12);
        expect(execute).toHaveBeenCalledWith(expect.objectContaining({}), expect.objectContaining({ query: "홍길동" }));
        expect(sessions.update).toHaveBeenCalledWith("session-a", { userId: "user-a", branchId: "branch-a" }, { selectedEntities: { clients: { id: 1, name: "홍길동" } } });
        expect(sessions.appendMessages).toHaveBeenCalledWith("session-a", { userId: "user-a", branchId: "branch-a" }, expect.any(Array), "trace-a");
        expect(traces.finish).toHaveBeenCalledWith(expect.objectContaining({ id: "trace-a" }), "succeeded", expect.anything(), undefined, expect.arrayContaining([{ capability: "clients.search", version: "1.0.0", risk: "read" }]));
    });

    it("emits a typed entity-choice part for duplicate matches", async () => {
        const capability = {
            meta: {
                name: "clients.search",
                domain: "clients",
                version: "1.0.0",
                description: "Search clients",
                risk: "read" as const,
                requiredRoles: ["admin"],
                renderer: "entity-choice" as const,
                flagKey: "agent.capability.clients.search",
                sideEffect: false,
            },
            inputSchema: z.object({ query: z.string() }),
            outputSchema: z.object({
                kind: z.literal("choices"),
                prompt: z.string(),
                choices: z.array(z.object({ id: z.number(), name: z.string(), serviceStatus: z.string().nullable() })),
            }),
            execute: jest.fn().mockResolvedValue({
                kind: "choices",
                prompt: "선택해 주세요",
                choices: [{ id: 1, name: "홍길동", serviceStatus: null }, { id: 2, name: "홍길동", serviceStatus: "active" }],
            }),
        };
        const sessions = {
            create: jest.fn().mockResolvedValue({ id: "session-choice", selectedEntities: {} }),
            get: jest.fn(),
            update: jest.fn(),
            appendMessages: jest.fn().mockResolvedValue(undefined),
        };
        const traces = { start: jest.fn().mockResolvedValue({ id: "trace-choice", startedAt: Date.now() }), finish: jest.fn().mockResolvedValue(undefined) };
        const runtime = new AgentRuntimeService(
            {} as never,
            { isCapabilityEnabled: jest.fn().mockResolvedValue(true) } as never,
            sessions as never,
            { modelId: "deterministic-agent-v1", create: () => new DeterministicAgentLanguageModel([{ type: "tool-call", toolName: "clients_search", input: { query: "홍길동" } }, { type: "text", text: "선택 결과" }]) } as never,
            { route: jest.fn().mockResolvedValue({ domains: ["clients"], capabilities: [capability] }) } as never,
            traces as never,
        );

        const result = await runtime.stream({
            principal: { userId: "user-a", branchId: "branch-a", globalRole: "admin", branchRole: "admin" },
            locale: "ko",
            messages: [{ id: "message-choice", role: "user", parts: [{ type: "text", text: "홍길동 산모 찾아줘" }] }] as never,
        });
        const chunks: unknown[] = [];
        const reader = result.stream.getReader();
        while (true) {
            const next = await reader.read();
            if (next.done) break;
            chunks.push(next.value);
        }

        expect(chunks).toEqual(expect.arrayContaining([
            expect.objectContaining({
                type: "data-entity-choice",
                data: expect.objectContaining({ choices: [{ id: "1", label: "홍길동" }, { id: "2", label: "홍길동", description: "active" }] }),
            }),
        ]));
    });
});
