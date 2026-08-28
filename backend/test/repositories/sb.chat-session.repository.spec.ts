import { SbChatSessionRepository } from "../../infrastructure/database/repositories/sb.chat-session.repository";
import { PrismaService } from "../../infrastructure/database/prisma.service";
import { ChatSessionEntity } from "../../domain/entities/chat-session.entity";

describe("SbChatSessionRepository", () => {
    const createMockPrismaChatSession = () => ({
        deleteMany: jest.fn(),
        findFirst: jest.fn(),
    });

    let chatSessionModel: ReturnType<typeof createMockPrismaChatSession>;
    let prismaService: PrismaService;
    let repository: SbChatSessionRepository;

    beforeEach(() => {
        chatSessionModel = createMockPrismaChatSession();
        prismaService = {
            chat_session: chatSessionModel,
        } as unknown as PrismaService;

        repository = new SbChatSessionRepository(prismaService);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe("deleteOlderThan", () => {
    it("should delete sessions with createdAt < cutoffDate and return deleted count", async () => {
            // Arrange
            const cutoffDate = new Date("2024-01-01T00:00:00.000Z");
            chatSessionModel.deleteMany.mockResolvedValue({ count: 3 });

            // Act
            const deletedCount = await repository.deleteOlderThan(cutoffDate);

            // Assert
            expect(chatSessionModel.deleteMany).toHaveBeenCalledWith({
                where: { createdAt: { lt: cutoffDate } },
            });
            expect(deletedCount).toBe(3);
        });
    });

    describe("owner-scoped reads", () => {
        it("requires both userId and branchId before querying by id", async () => {
            expect(await repository.findById("session-1")).toBeNull();
            expect(chatSessionModel.findFirst).not.toHaveBeenCalled();
        });

        it("queries the complete owner tuple and excludes branchless legacy rows", async () => {
            chatSessionModel.findFirst.mockResolvedValue(null);
            const result = await repository.findById("session-1", "user-1", "branch-1");

            expect(result).toBeNull();
            expect(chatSessionModel.findFirst).toHaveBeenCalledWith({
                where: { id: "session-1", userId: "user-1", branchId: "branch-1" },
                include: { messages: { orderBy: { timestamp: "asc" } } },
            });
        });

        it("fails closed when creating or deleting a branchless session", async () => {
            const session = ChatSessionEntity.create("user-1");
            await expect(repository.create(session)).rejects.toThrow("Branch-bound");
            await expect(repository.delete("session-1", "user-1")).rejects.toThrow("Branch-bound");
        });
    });
});
