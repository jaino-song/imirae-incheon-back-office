import { AIChatService } from "application/services/ai-chat.service";
import type { GeminiStreamChunk } from "infrastructure/api/gemini-chat.gateway";
import { ChatSessionEntity } from "domain/entities/chat-session.entity";

describe("AIChatService.chatStream", () => {
    test("uses direct dashboard tool path for employee count query", async () => {
        const geminiGateway = {
            chatStream: jest.fn(),
        } as any;

        const toolExecutor = {
            execute: jest.fn().mockResolvedValue({
                success: true,
                data: {
                    totalClients: 12,
                    totalEmployees: 7,
                    startingSoonCount: 1,
                    endingSoonCount: 2,
                    incompleteContractsCount: 3,
                    noContractCount: 4,
                },
            }),
        } as any;

        let storedSession: ChatSessionEntity | null = null;
        const sessionRepository = {
            findById: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockImplementation(async (session: ChatSessionEntity) => {
                (session as any).id = "test-session";
                storedSession = session;
                return session;
            }),
            update: jest.fn().mockImplementation(async (session: ChatSessionEntity) => {
                storedSession = session;
                return session;
            }),
        } as any;

        const service = new AIChatService(geminiGateway, toolExecutor, sessionRepository);

        const events: any[] = [];
        for await (const evt of service.chatStream(undefined, "user-1", "현재 등록된 제공인력은 몇명이야?", "org-1")) {
            events.push(evt);
        }

        expect(geminiGateway.chatStream).not.toHaveBeenCalled();
        expect(toolExecutor.execute).toHaveBeenCalledWith(
            expect.objectContaining({ userId: "user-1", branchId: "org-1", sessionId: "test-session" }),
            "getDashboardStats",
            {},
        );
        expect(events.some((e) => e.type === "tool_call" && e.toolName === "getDashboardStats")).toBe(true);
        expect(events.some((e) => e.type === "chunk" && String(e.content).includes("7명"))).toBe(true);

        const assistantMessages = storedSession!.messages.filter((m) => m.role === "assistant");
        expect(assistantMessages).toHaveLength(1);
        expect(assistantMessages[0]?.content).toContain("7명");
    });

    test("does not persist duplicate assistant message when done arrives twice", async () => {
        const geminiGateway = {
            chatStream: jest.fn(),
        } as any;

        geminiGateway.chatStream.mockReturnValue(
            (async function* (): AsyncGenerator<GeminiStreamChunk> {
                yield { type: "text", content: "죄송합니다." };
                yield { type: "done" };
                yield { type: "done" };
            })()
        );

        const toolExecutor = {
            execute: jest.fn(),
        } as any;

        let storedSession: ChatSessionEntity | null = null;
        const sessionRepository = {
            findById: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockImplementation(async (session: ChatSessionEntity) => {
                (session as any).id = "test-session";
                storedSession = session;
                return session;
            }),
            update: jest.fn().mockImplementation(async (session: ChatSessionEntity) => {
                storedSession = session;
                return session;
            }),
        } as any;

        const service = new AIChatService(geminiGateway, toolExecutor, sessionRepository);

        const events = [] as any[];
        for await (const evt of service.chatStream(undefined, "user-1", "hello", "org-1")) {
            events.push(evt);
        }

        expect(events.some((e) => e.type === "done")).toBe(true);
        expect(storedSession).not.toBeNull();

        const assistantMessages = storedSession!.messages.filter((m) => m.role === "assistant");
        expect(assistantMessages).toHaveLength(1);
        expect(assistantMessages[0]?.content).toBe("죄송합니다.");
    });

    test("redacts account numbers even when Gemini splits them across stream chunks", async () => {
        const geminiGateway = {
            chatStream: jest.fn().mockReturnValue(
                (async function* (): AsyncGenerator<GeminiStreamChunk> {
                    yield { type: "text", content: "입금 계좌번호: 110-123-" };
                    yield { type: "text", content: "456789" };
                    yield { type: "done" };
                })(),
            ),
        } as any;

        const toolExecutor = { execute: jest.fn() } as any;
        let storedSession: ChatSessionEntity | null = null;
        const sessionRepository = {
            findById: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockImplementation(async (session: ChatSessionEntity) => {
                (session as any).id = "test-session";
                storedSession = session;
                return session;
            }),
            update: jest.fn().mockImplementation(async (session: ChatSessionEntity) => {
                storedSession = session;
                return session;
            }),
        } as any;

        const service = new AIChatService(geminiGateway, toolExecutor, sessionRepository);
        const events: any[] = [];
        for await (const event of service.chatStream(undefined, "user-1", "계좌 알려줘", "org-1")) {
            events.push(event);
        }

        const streamedContent = events
            .filter((event) => event.type === "chunk")
            .map((event) => event.content)
            .join("");
        expect(streamedContent).toContain("[REDACTED]");
        expect(streamedContent).not.toContain("110-123-456789");
        const persistedSession = storedSession as ChatSessionEntity | null;
        expect(persistedSession?.messages.at(-1)?.content).not.toContain("110-123-456789");
    });

    test("limits gemini context to recent messages for faster inference", async () => {
        const geminiGateway = {
            chatStream: jest.fn(),
        } as any;

        geminiGateway.chatStream.mockReturnValue(
            (async function* (): AsyncGenerator<GeminiStreamChunk> {
                yield { type: "text", content: "ok" };
                yield { type: "done" };
            })()
        );

        const toolExecutor = {
            execute: jest.fn(),
        } as any;

        const existingSession = ChatSessionEntity.create("user-1", "org-1");
        (existingSession as any).id = "existing-session";
        for (let i = 0; i < 30; i++) {
            existingSession.addMessage("user", `u-${i}`);
            existingSession.addMessage("assistant", `a-${i}`);
        }

        const sessionRepository = {
            findById: jest.fn().mockResolvedValue(existingSession),
            create: jest.fn(),
            update: jest.fn().mockResolvedValue(existingSession),
        } as any;

        const service = new AIChatService(geminiGateway, toolExecutor, sessionRepository);

        const events = [] as any[];
        for await (const evt of service.chatStream("existing-session", "user-1", "hello", "org-1")) {
            events.push(evt);
        }

        expect(events.some((e) => e.type === "done")).toBe(true);
        expect(geminiGateway.chatStream).toHaveBeenCalledTimes(1);

        const geminiMessages = geminiGateway.chatStream.mock.calls[0][0] as Array<{ role: string; content: string }>;
        expect(geminiMessages).toHaveLength(25); // system + last 24 messages
        expect(geminiMessages[0]?.role).toBe("system");
    });
});
