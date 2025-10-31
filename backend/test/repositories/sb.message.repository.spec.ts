import { SbMessageRepository } from "infrastructure/database/repositories/sb.message.repository";
import { PrismaService } from "infrastructure/database/prisma.service";
import { MessageEntity } from "domain/entities/message.entity";

describe("SbMessageRepository", () => {
    const messageModel = {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
    };

    const prisma = { message: messageModel } as unknown as PrismaService;

    const repository = new SbMessageRepository(prisma);

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("returns a message when findById finds a match", async () => {
        const now = new Date();
        const row = {
            id: 1,
            title: "Hello",
            text: "World",
            created_at: now,
            edited_at: null,
        };
        messageModel.findUnique.mockResolvedValue(row);

        const result = await repository.findById(1);

        expect(messageModel.findUnique).toHaveBeenCalledWith({ where: { id: 1 } });
        expect(result).toBeInstanceOf(MessageEntity);
        expect(result).toMatchObject({
            id: 1,
            title: "Hello",
            text: "World",
            createdAt: now,
            editedAt: null,
        });
    });

    it("returns null when findById does not find a message", async () => {
        messageModel.findUnique.mockResolvedValue(null);

        const result = await repository.findById(999);

        expect(messageModel.findUnique).toHaveBeenCalledWith({ where: { id: 999 } });
        expect(result).toBeNull();
    });

    it("creates a message using Prisma", async () => {
        const entity = MessageEntity.create("Title", "Text");
        const createdRow = {
            id: 2,
            title: entity.title,
            text: entity.text,
            created_at: entity.createdAt,
            edited_at: entity.editedAt,
        };
        messageModel.create.mockResolvedValue(createdRow);

        const result = await repository.create(entity);

        expect(messageModel.create).toHaveBeenCalledWith({
            data: {
                title: "Title",
                text: "Text",
            },
        });
        expect(result).toMatchObject({ id: 2, title: "Title" });
    });

    it("updates a message using Prisma", async () => {
        const createdAt = new Date("2024-01-01T00:00:00.000Z");
        const editedAt = new Date("2024-01-02T00:00:00.000Z");
        const entity = new MessageEntity(3, "Updated", "Message updated", createdAt, editedAt);

        const updatedRow = {
            id: 3,
            title: "Updated",
            text: "Message updated",
            created_at: createdAt,
            edited_at: editedAt,
        };
        messageModel.update.mockResolvedValue(updatedRow);

        const result = await repository.update(entity);

        expect(messageModel.update).toHaveBeenCalledWith({
            where: { id: 3 },
            data: {
                title: "Updated",
                text: "Message updated",
                edited_at: editedAt,
            },
        });
        expect(result).toMatchObject({ id: 3, title: "Updated" });
    });

    it("deletes a message by id", async () => {
        messageModel.delete.mockResolvedValue(undefined);

        await repository.delete(4);

        expect(messageModel.delete).toHaveBeenCalledWith({ where: { id: 4 } });
    });
});

