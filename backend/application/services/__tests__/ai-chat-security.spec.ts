import { AIChatService } from "../ai-chat.service";
import { ChatSessionEntity } from "domain/entities/chat-session.entity";

describe("AIChatService legacy session and confirmation boundary", () => {
    const context = { userId: "user-1", branchId: "branch-1", sessionId: "session-1" };

    function createService(overrides: Record<string, unknown> = {}) {
        const gateway = { chatStream: jest.fn(), chat: jest.fn(), sendFunctionResult: jest.fn() };
        const toolExecutor = {
            execute: jest.fn().mockResolvedValue({ success: true, data: {} }),
            executeAuthorized: jest.fn().mockResolvedValue({ success: true, data: { id: 1 } }),
        };
        const repository = {
            findById: jest.fn().mockResolvedValue(null),
            findByUserId: jest.fn(),
            findActiveByUserId: jest.fn(),
            create: jest.fn().mockImplementation(async (session: ChatSessionEntity) => {
                (session as { id: string }).id = context.sessionId;
                return session;
            }),
            update: jest.fn().mockImplementation(async (session: ChatSessionEntity) => session),
            delete: jest.fn(),
            deleteExpired: jest.fn(),
            deleteOlderThan: jest.fn(),
        };
        const confirmationService = {
            consumeAndExecute: jest.fn().mockImplementation(async (_ctx, _token, callback) => callback({
                id: "intent-1",
                userId: context.userId,
                branchId: context.branchId,
                sessionId: context.sessionId,
                toolName: "createClient",
                payload: { name: "A" },
                payloadHash: "hash",
            })),
        };
        const service = new AIChatService(
            gateway as never,
            toolExecutor as never,
            repository as never,
            confirmationService as never,
        );
        return { service, gateway, toolExecutor, repository, confirmationService, ...overrides };
    }

    it("passes user and branch to every legacy session lookup and rejects a foreign session", async () => {
        const { service, repository } = createService();
        const stream = service.chatStream("foreign-session", context.userId, "hello", context.branchId);

        await expect((async () => {
            for await (const _event of stream) {
                // The lookup must fail before any stream event is yielded.
            }
        })()).rejects.toThrow("Session not found");
        expect(repository.findById).toHaveBeenCalledWith("foreign-session", context.userId, context.branchId);
        expect(repository.create).not.toHaveBeenCalled();
    });

    it("consumes the server intent and executes the stored payload, ignoring client action fields", async () => {
        const { service, toolExecutor, confirmationService } = createService();

        const result = await service.confirmToolAction(
            context.userId,
            context.branchId,
            { intentId: "intent-1", nonce: "nonce" },
            context.sessionId,
        );

        expect(result).toEqual({ success: true, data: { id: 1 } });
        expect(confirmationService.consumeAndExecute).toHaveBeenCalledWith(
            { userId: context.userId, branchId: context.branchId, sessionId: context.sessionId },
            { intentId: "intent-1", nonce: "nonce" },
            expect.any(Function),
        );
        expect(toolExecutor.executeAuthorized).toHaveBeenCalledWith(
            context,
            "createClient",
            { name: "A" },
            expect.objectContaining({ id: "intent-1" }),
        );
    });
});
