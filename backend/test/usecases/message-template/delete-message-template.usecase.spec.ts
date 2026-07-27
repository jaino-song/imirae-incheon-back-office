import { NotFoundException } from "@nestjs/common";

import { DeleteMessageTemplateUsecase } from "application/usecases/message-template/delete-message-template.usecase";
import { MessageTemplateEntity } from "domain/entities/message-template.entity";
import { IMessageTemplateRepository } from "domain/repositories/message-template.repository.interface";

describe("DeleteMessageTemplateUsecase", () => {
    const template = MessageTemplateEntity.reconstitute(
        "template-1",
        "지점 템플릿",
        "안녕하세요",
        [],
        new Date("2026-07-27T00:00:00.000Z"),
        new Date("2026-07-27T00:00:00.000Z"),
    );

    let repository: jest.Mocked<IMessageTemplateRepository>;
    let usecase: DeleteMessageTemplateUsecase;

    beforeEach(() => {
        repository = {
            findById: jest.fn(),
            findAll: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
        };
        usecase = new DeleteMessageTemplateUsecase(repository);
    });

    it("uses the same branch scope for ownership lookup and deletion", async () => {
        repository.findById.mockResolvedValue(template);

        await usecase.execute("branch-a", "template-1");

        expect(repository.findById).toHaveBeenCalledWith("branch-a", "template-1");
        expect(repository.delete).toHaveBeenCalledWith("branch-a", "template-1");
    });

    it("does not delete a template that is outside the requested branch", async () => {
        repository.findById.mockResolvedValue(null);

        await expect(usecase.execute("branch-b", "template-1")).rejects.toBeInstanceOf(
            NotFoundException,
        );
        expect(repository.delete).not.toHaveBeenCalled();
    });
});
