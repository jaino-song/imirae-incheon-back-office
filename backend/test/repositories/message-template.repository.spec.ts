import { MessageTemplateEntity } from "domain/entities/message-template.entity";
import { PrismaService } from "infrastructure/database/prisma.service";
import { MessageTemplateRepository } from "infrastructure/database/repositories/message-template.repository";

describe("MessageTemplateRepository", () => {
    type StoredMessageTemplate = {
        id: string;
        branchId: string;
        name: string;
        content: string;
        variables: unknown;
        createdAt: Date;
        updatedAt: Date;
    };

    const createTemplate = (name: string): MessageTemplateEntity =>
        MessageTemplateEntity.create({
            name,
            content: "안녕하세요 {{name}}님",
            variables: [
                {
                    key: "name",
                    type: "text",
                    label: "이름",
                    required: true,
                },
            ],
        });

    let rows: StoredMessageTemplate[];
    let messageTemplateModel: {
        create: jest.Mock;
        findFirst: jest.Mock;
        findMany: jest.Mock;
        updateMany: jest.Mock;
        deleteMany: jest.Mock;
    };
    let repository: MessageTemplateRepository;

    beforeEach(() => {
        rows = [];
        messageTemplateModel = {
            create: jest.fn(async ({ data }: { data: Omit<StoredMessageTemplate, "createdAt"> }) => {
                const row = {
                    ...data,
                    createdAt: new Date("2026-07-27T00:00:00.000Z"),
                };
                rows.push(row);
                return row;
            }),
            findFirst: jest.fn(async ({ where }: { where: { id: string; branchId: string } }) =>
                rows.find((row) => row.id === where.id && row.branchId === where.branchId) ?? null,
            ),
            findMany: jest.fn(),
            updateMany: jest.fn(),
            deleteMany: jest.fn(),
        };
        repository = new MessageTemplateRepository({
            message_template: messageTemplateModel,
        } as unknown as PrismaService);
    });

    it("generates a non-empty unique id for every created template", async () => {
        const first = await repository.create("branch-a", createTemplate("첫 번째"));
        const second = await repository.create("branch-a", createTemplate("두 번째"));

        expect(first.id).not.toBe("");
        expect(second.id).not.toBe("");
        expect(first.id).not.toBe(second.id);
    });

    it("round trips a created template through branch-scoped lookup", async () => {
        const created = await repository.create("branch-a", createTemplate("왕복 템플릿"));

        const found = await repository.findById("branch-a", created.id);

        expect(found).toMatchObject({
            id: created.id,
            name: "왕복 템플릿",
            content: "안녕하세요 {{name}}님",
        });
        expect(messageTemplateModel.findFirst).toHaveBeenCalledWith({
            where: { id: created.id, branchId: "branch-a" },
        });
    });

    it("deletes only the matching template in the requested branch", async () => {
        messageTemplateModel.deleteMany.mockResolvedValue({ count: 1 });

        await repository.delete("branch-a", "template-1");

        expect(messageTemplateModel.deleteMany).toHaveBeenCalledWith({
            where: { id: "template-1", branchId: "branch-a" },
        });
    });

    it("rejects deletion when the template does not belong to the requested branch", async () => {
        messageTemplateModel.deleteMany.mockResolvedValue({ count: 0 });

        await expect(repository.delete("branch-b", "template-1")).rejects.toThrow(
            "Message template not found for branch",
        );
    });
});
