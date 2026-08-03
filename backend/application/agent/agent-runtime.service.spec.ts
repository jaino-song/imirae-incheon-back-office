import { z } from "zod";

import { DeterministicAgentLanguageModel } from "infrastructure/agent/deterministic-agent-language-model";
import { AgentRuntimeService, buildAuthoritativeModelMessages, buildWriteToolInputSchema, redactModelValue } from "./agent-runtime.service";

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

    it("redacts sensitive values in the current user turn before model dispatch", () => {
        const messages = buildAuthoritativeModelMessages([], {
            id: "current",
            role: "user",
            parts: [{ type: "text", text: "010-1234-5678 person@example.com 고객" }],
        });

        expect(messages[0]?.parts).toEqual([{ type: "text", text: "[redacted] [redacted] 고객" }]);
    });

    it("redacts sensitive fields case-insensitively and scans every string value", () => {
        expect(redactModelValue({
            phoneNumber: "010-1234-5678",
            Email: "person@example.com",
            profile: { display: "연락처 010-9999-8888", createdAt: new Date("2026-08-03T00:00:00.000Z") },
        })).toEqual({ profile: { display: "연락처 [redacted]", createdAt: "2026-08-03T00:00:00.000Z" } });
    });

    it("excludes message ranges already covered by a validated server summary", () => {
        const messages = buildAuthoritativeModelMessages([
            { id: "summarized", role: "user", parts: [{ type: "text", text: "오래된 질문" }] },
            { id: "newer", role: "assistant", parts: [{ type: "text", text: "새 답변" }] },
        ], { id: "current", role: "user", parts: [{ type: "text", text: "현재 질문" }] }, 1);

        expect(messages.map((message) => message.id)).toEqual(["newer", "current"]);
    });

    it("keeps canonical write-tool field guidance while allowing missing fields", () => {
        const schema = buildWriteToolInputSchema(z.object({
            receiver: z.string().describe("Recipient phone"),
            message: z.string().min(1).describe("Message body"),
        }));

        expect(Object.keys(schema.shape)).toEqual(["receiver", "message"]);
        expect(schema.safeParse({}).success).toBe(true);
        expect(schema.safeParse({ receiver: "01012345678", message: "안내" }).success).toBe(true);
        expect(schema.safeParse({ receiver: 1012345678 }).success).toBe(false);
    });

    it("allows form recovery for refined write schemas without dropping field guidance", () => {
        const canonical = z.object({
            scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
            scheduledTime: z.string().regex(/^\d{2}:\d{2}$/),
        }).superRefine((value, context) => {
            if (value.scheduledDate === "2026-08-03") {
                context.addIssue({ code: "custom", path: ["scheduledDate"], message: "must be in the future" });
            }
        });

        const schema = buildWriteToolInputSchema(canonical);

        expect(Object.keys(schema.shape)).toEqual(["scheduledDate", "scheduledTime"]);
        expect(schema.safeParse({}).success).toBe(true);
        expect(schema.safeParse({ scheduledDate: "not-a-date" }).success).toBe(false);
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

    it("emits a recovery form when a write tool omits canonical required input", async () => {
        const capability = {
            meta: {
                name: "clients.create",
                domain: "clients",
                version: "1.0.0",
                description: "Create client",
                risk: "reversible-write" as const,
                requiredRoles: ["admin"],
                renderer: "action-proposal" as const,
                flagKey: "agent.capability.clients.create",
                sideEffect: true,
                approvalPolicy: "structured" as const,
                idempotencyPolicy: "action-id" as const,
            },
            inputSchema: z.object({ name: z.string().min(1) }),
            outputSchema: z.object({ status: z.string() }),
            formFields: [{ name: "name", label: "이름", type: "text" as const, required: true }],
            execute: jest.fn(),
        };
        const sessions = {
            create: jest.fn().mockResolvedValue({ id: "session-form", selectedEntities: {}, messages: [] }),
            update: jest.fn(),
            appendMessages: jest.fn().mockResolvedValue(undefined),
        };
        const traces = { start: jest.fn().mockResolvedValue({ id: "trace-form", startedAt: Date.now() }), finish: jest.fn().mockResolvedValue(undefined) };
        const actions = {
            propose: jest.fn().mockImplementation(async (proposal) => capability.inputSchema.parse(proposal.input)),
        };
        const runtime = new AgentRuntimeService(
            {} as never,
            { isCapabilityEnabled: jest.fn().mockResolvedValue(true) } as never,
            sessions as never,
            { modelId: "deterministic-agent-v1", create: () => new DeterministicAgentLanguageModel([{ type: "tool-call", toolName: "clients_create", input: {} }]) } as never,
            { route: jest.fn().mockResolvedValue({ domains: ["clients"], capabilities: [capability] }) } as never,
            traces as never,
            actions as never,
        );

        const result = await runtime.stream({
            principal: { userId: "user-a", branchId: "branch-a", globalRole: "admin", branchRole: "admin" },
            locale: "ko",
            messages: [{ id: "message-form", role: "user", parts: [{ type: "text", text: "산모를 등록해줘" }] }] as never,
        });
        const chunks: unknown[] = [];
        const reader = result.stream.getReader();
        while (true) {
            const next = await reader.read();
            if (next.done) break;
            chunks.push(next.value);
        }

        expect(actions.propose).toHaveBeenCalled();
        expect(chunks).toEqual(expect.arrayContaining([
            expect.objectContaining({ type: "data-form", data: expect.objectContaining({ fields: capability.formFields }) }),
        ]));
    });

    it("creates a proposal directly when a write tool supplies canonical input", async () => {
        const expiresAt = new Date("2026-08-03T01:00:00.000Z");
        const capability = {
            meta: {
                name: "clients.create",
                domain: "clients",
                version: "1.0.0",
                description: "Create client",
                risk: "reversible-write" as const,
                requiredRoles: ["admin"],
                renderer: "action-proposal" as const,
                flagKey: "agent.capability.clients.create",
                sideEffect: true,
                approvalPolicy: "structured" as const,
                idempotencyPolicy: "action-id" as const,
            },
            inputSchema: z.object({ name: z.string().min(1) }),
            outputSchema: z.object({ status: z.string() }),
            formFields: [{ name: "name", label: "이름", type: "text" as const, required: true }],
            execute: jest.fn(),
        };
        const actions = {
            propose: jest.fn().mockResolvedValue({
                id: "action-direct",
                capability: "clients.create",
                proposal: { title: "Create client", summary: "Create client", input: { name: "홍길동" } },
                targetSnapshot: null,
                expiresAt,
                proposalRevision: "revision-direct",
                risk: "reversible-write",
                branchId: "branch-a",
                status: "proposed",
            }),
        };
        const sessions = {
            create: jest.fn().mockResolvedValue({ id: "session-direct", selectedEntities: {}, messages: [] }),
            update: jest.fn(),
            appendMessages: jest.fn().mockResolvedValue(undefined),
        };
        const runtime = new AgentRuntimeService(
            {} as never,
            { isCapabilityEnabled: jest.fn().mockResolvedValue(true) } as never,
            sessions as never,
            { modelId: "deterministic-agent-v1", create: () => new DeterministicAgentLanguageModel([{ type: "tool-call", toolName: "clients_create", input: { name: "홍길동" } }]) } as never,
            { route: jest.fn().mockResolvedValue({ domains: ["clients"], capabilities: [capability] }) } as never,
            { start: jest.fn().mockResolvedValue({ id: "trace-direct", startedAt: Date.now() }), finish: jest.fn().mockResolvedValue(undefined) } as never,
            actions as never,
        );

        const result = await runtime.stream({
            principal: { userId: "user-a", branchId: "branch-a", globalRole: "admin", branchRole: "admin" },
            locale: "ko",
            messages: [{ id: "message-direct", role: "user", parts: [{ type: "text", text: "홍길동 산모를 등록해줘" }] }] as never,
        });
        const chunks: unknown[] = [];
        const reader = result.stream.getReader();
        while (true) {
            const next = await reader.read();
            if (next.done) break;
            chunks.push(next.value);
        }

        expect(actions.propose).toHaveBeenCalledWith(expect.objectContaining({ input: { name: "홍길동" } }));
        expect(chunks).toEqual(expect.arrayContaining([
            expect.objectContaining({
                type: "data-action-proposal",
                data: expect.objectContaining({ actionId: "action-direct", changes: { name: "홍길동" } }),
            }),
        ]));
        expect(chunks).not.toEqual(expect.arrayContaining([expect.objectContaining({ type: "data-form" })]));
    });

    it("binds structured form values server-side without exposing them to model tool input", async () => {
        const expiresAt = new Date("2026-08-03T01:00:00.000Z");
        const capability = {
            meta: {
                name: "clients.create", domain: "clients", version: "1.0.0", description: "Create client",
                risk: "reversible-write" as const, requiredRoles: ["admin"], renderer: "action-proposal" as const,
                flagKey: "agent.capability.clients.create", sideEffect: true,
                approvalPolicy: "structured" as const, idempotencyPolicy: "action-id" as const,
            },
            inputSchema: z.object({ name: z.string().min(1), phone: z.string().min(1) }),
            outputSchema: z.object({ status: z.string() }),
            formFields: [
                { name: "name", label: "이름", type: "text" as const, required: true },
                { name: "phone", label: "전화번호", type: "text" as const, required: true },
            ],
            execute: jest.fn(),
        };
        const actions = {
            propose: jest.fn().mockImplementation(async (proposal) => ({
                id: "action-form-bound", capability: "clients.create",
                proposal: { title: "Create client", summary: "Create client", input: proposal.input },
                targetSnapshot: null, expiresAt, proposalRevision: "revision-form-bound",
                risk: "reversible-write", branchId: "branch-a", status: "proposed",
            })),
        };
        const sessions = {
            create: jest.fn().mockResolvedValue({ id: "session-form-bound", selectedEntities: {}, messages: [] }),
            appendMessages: jest.fn().mockResolvedValue(undefined),
        };
        const model = new DeterministicAgentLanguageModel([{ type: "tool-call", toolName: "clients_create", input: {} }]);
        const modelStream = jest.spyOn(model, "doStream");
        const runtime = new AgentRuntimeService(
            { list: () => [capability] } as never,
            { isCapabilityEnabled: jest.fn().mockResolvedValue(true) } as never,
            sessions as never,
            { modelId: "deterministic-agent-v1", create: () => model } as never,
            { route: jest.fn() } as never,
            { start: jest.fn().mockResolvedValue({ id: "trace-form-bound", startedAt: Date.now() }), finish: jest.fn().mockResolvedValue(undefined) } as never,
            actions as never,
        );

        const result = await runtime.stream({
            principal: { userId: "user-a", branchId: "branch-a", globalRole: "admin", branchRole: "admin" },
            locale: "ko",
            messages: [{
                id: "message-form-bound", role: "user",
                parts: [{
                    type: "data-form-submit",
                    data: { formId: "clients.create-session-form-bound", values: { name: "홍길동", phone: "01012345678" } },
                }],
            }] as never,
        });
        const reader = result.stream.getReader();
        while (!(await reader.read()).done) {
            // Drain so the server-bound proposal is produced and persisted.
        }

        expect(actions.propose).toHaveBeenCalledWith(expect.objectContaining({
            input: { name: "홍길동", phone: "01012345678" },
        }));
        expect(JSON.stringify(modelStream.mock.calls)).not.toContain("01012345678");
    });

    it("rejects a structured form replayed against another session", async () => {
        const capability = {
            meta: {
                name: "clients.create", domain: "clients", version: "1.0.0", description: "Create client",
                risk: "reversible-write" as const, requiredRoles: ["admin"], renderer: "action-proposal" as const,
                flagKey: "agent.capability.clients.create", sideEffect: true,
                approvalPolicy: "structured" as const, idempotencyPolicy: "action-id" as const,
            },
            inputSchema: z.object({ name: z.string(), phone: z.string() }),
            outputSchema: z.object({ status: z.string() }),
            execute: jest.fn(),
        };
        const actions = { propose: jest.fn() };
        const runtime = new AgentRuntimeService(
            { list: () => [capability] } as never,
            { isCapabilityEnabled: jest.fn().mockResolvedValue(true) } as never,
            { create: jest.fn().mockResolvedValue({ id: "session-current", selectedEntities: {}, messages: [] }), remove: jest.fn().mockResolvedValue(undefined) } as never,
            { modelId: "deterministic-agent-v1", create: jest.fn() } as never,
            { route: jest.fn() } as never,
            { start: jest.fn() } as never,
            actions as never,
        );

        await expect(runtime.stream({
            principal: { userId: "user-a", branchId: "branch-a", globalRole: "admin", branchRole: "admin" },
            locale: "ko",
            messages: [{
                id: "message-forged", role: "user",
                parts: [{ type: "data-form-submit", data: {
                    formId: "clients.create-session-other",
                    values: { name: "홍길동", phone: "01012345678" },
                } }],
            }] as never,
        })).rejects.toThrow("Agent is not enabled for this context");
        expect(actions.propose).not.toHaveBeenCalled();
    });

    it("removes a just-created session when routing offers no capabilities", async () => {
        const sessions = {
            create: jest.fn().mockResolvedValue({ id: "session-empty", selectedEntities: {}, messages: [] }),
            remove: jest.fn().mockResolvedValue(undefined),
        };
        const runtime = new AgentRuntimeService(
            {} as never,
            {} as never,
            sessions as never,
            { modelId: "deterministic-agent-v1" } as never,
            { route: jest.fn().mockResolvedValue({ domains: [], capabilities: [] }) } as never,
            {} as never,
        );

        await expect(runtime.stream({
            principal: { userId: "user-a", branchId: "branch-a", globalRole: "admin", branchRole: "admin" },
            locale: "ko",
            messages: [{ id: "message-empty", role: "user", parts: [{ type: "text", text: "사용할 수 없는 요청" }] }] as never,
        })).rejects.toThrow("Agent is not enabled");
        expect(sessions.remove).toHaveBeenCalledWith("session-empty", { userId: "user-a", branchId: "branch-a" });
    });

    it("does not remove an existing session when routing later offers no capabilities", async () => {
        const sessions = {
            get: jest.fn().mockResolvedValue({ id: "session-existing", selectedEntities: {}, messages: [] }),
            remove: jest.fn(),
        };
        const runtime = new AgentRuntimeService(
            {} as never,
            {} as never,
            sessions as never,
            { modelId: "deterministic-agent-v1" } as never,
            { route: jest.fn().mockResolvedValue({ domains: [], capabilities: [] }) } as never,
            {} as never,
        );

        await expect(runtime.stream({
            principal: { userId: "user-a", branchId: "branch-a", globalRole: "admin", branchRole: "admin" },
            sessionId: "session-existing",
            locale: "ko",
            messages: [{ id: "message-empty", role: "user", parts: [{ type: "text", text: "사용할 수 없는 요청" }] }] as never,
        })).rejects.toThrow("Agent is not enabled");
        expect(sessions.remove).not.toHaveBeenCalled();
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

    it("contains finish-time persistence failures and records a failed trace", async () => {
        const capability = {
            meta: { name: "clients.search", domain: "clients", version: "1.0.0", description: "Search clients", risk: "read" as const, requiredRoles: ["admin"], renderer: "activity" as const, flagKey: "agent.capability.clients.search", sideEffect: false },
            inputSchema: z.object({ query: z.string().optional() }),
            outputSchema: z.object({}),
            execute: jest.fn().mockResolvedValue({}),
        };
        const sessions = {
            create: jest.fn().mockResolvedValue({ id: "session-persistence", selectedEntities: {}, messages: [] }),
            appendMessages: jest.fn().mockRejectedValue(new Error("database unavailable")),
        };
        const traces = {
            start: jest.fn().mockResolvedValue({ id: "trace-persistence", startedAt: Date.now() }),
            finish: jest.fn().mockResolvedValue(undefined),
        };
        const runtime = new AgentRuntimeService(
            {} as never,
            { isCapabilityEnabled: jest.fn().mockResolvedValue(true) } as never,
            sessions as never,
            { modelId: "deterministic-agent-v1", create: () => new DeterministicAgentLanguageModel([{ type: "text", text: "완료" }]) } as never,
            { route: jest.fn().mockResolvedValue({ domains: ["clients"], capabilities: [capability] }) } as never,
            traces as never,
        );

        const result = await runtime.stream({
            principal: { userId: "user-a", branchId: "branch-a", globalRole: "admin", branchRole: "admin" },
            locale: "ko",
            messages: [{ id: "message-persistence", role: "user", parts: [{ type: "text", text: "도와줘" }] }] as never,
        });
        const reader = result.stream.getReader();
        while (!(await reader.read()).done) {
            // Drain so persistence and trace finalization run.
        }

        expect(traces.finish).toHaveBeenCalledWith(
            expect.objectContaining({ id: "trace-persistence" }),
            "failed",
            expect.anything(),
            "persistence",
            [{ capability: "clients.search", version: "1.0.0", risk: "read" }],
        );
    });

    it("records provider stream failures as failed instead of successful traces", async () => {
        const consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);
        const capability = {
            meta: { name: "clients.search", domain: "clients", version: "1.0.0", description: "Search clients", risk: "read" as const, requiredRoles: ["admin"], renderer: "activity" as const, flagKey: "agent.capability.clients.search", sideEffect: false },
            inputSchema: z.object({ query: z.string().optional() }),
            outputSchema: z.object({}),
            execute: jest.fn().mockResolvedValue({}),
        };
        const sessions = {
            create: jest.fn().mockResolvedValue({ id: "session-provider", selectedEntities: {}, messages: [] }),
            appendMessages: jest.fn().mockResolvedValue(undefined),
        };
        const traces = {
            start: jest.fn().mockResolvedValue({ id: "trace-provider", startedAt: Date.now() }),
            finish: jest.fn().mockResolvedValue(undefined),
        };
        const runtime = new AgentRuntimeService(
            {} as never,
            { isCapabilityEnabled: jest.fn().mockResolvedValue(true) } as never,
            sessions as never,
            { modelId: "deterministic-agent-v1", create: () => new DeterministicAgentLanguageModel([{ type: "error", message: "provider failed" }]) } as never,
            { route: jest.fn().mockResolvedValue({ domains: ["clients"], capabilities: [capability] }) } as never,
            traces as never,
        );

        const result = await runtime.stream({
            principal: { userId: "user-a", branchId: "branch-a", globalRole: "admin", branchRole: "admin" },
            locale: "ko",
            messages: [{ id: "message-provider", role: "user", parts: [{ type: "text", text: "도와줘" }] }] as never,
        });
        const reader = result.stream.getReader();
        while (!(await reader.read()).done) {
            // Drain the redacted provider error response.
        }
        await new Promise<void>((resolve) => setImmediate(resolve));
        consoleError.mockRestore();

        expect(traces.finish).toHaveBeenCalledWith(
            expect.objectContaining({ id: "trace-provider" }),
            "failed",
            undefined,
            "provider",
            [{ capability: "clients.search", version: "1.0.0", risk: "read" }],
        );
        expect(traces.finish).not.toHaveBeenCalledWith(expect.anything(), "succeeded", expect.anything(), expect.anything(), expect.anything());
    });
});
