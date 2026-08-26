import { CreateAreaTemplateUsecase } from "application/usecases/area-template/create-area-template.usecase";
import { UpdateAreaTemplateUsecase } from "application/usecases/area-template/update-area-template.usecase";
import { AreaTemplateEntity } from "domain/entities/area-template.entity";
import { IAreaTemplateRepository } from "domain/repositories/area-template.repository.interface";

describe("Area template usecases", () => {
    let repository: jest.Mocked<IAreaTemplateRepository>;

    beforeEach(() => {
        repository = {
            findAll: jest.fn(),
            findAvailableAreas: jest.fn(),
            findByArea: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
        };
    });

    describe("CreateAreaTemplateUsecase", () => {
        it.each(["", "   "])(
            "should reject an empty templateId (%j) before repository mutation",
            (templateId) => {
                const usecase = new CreateAreaTemplateUsecase(repository);

                expect(() => usecase.execute("branch-1", "Seoul", templateId)).toThrow(
                    "Area template templateId must be a non-empty string",
                );
                expect(repository.create).not.toHaveBeenCalled();
            },
        );

        it("should pass a trimmed templateId to the repository", async () => {
            const created = new AreaTemplateEntity("id", "Seoul", "valid-template", null);
            repository.create.mockResolvedValue(created);
            const usecase = new CreateAreaTemplateUsecase(repository);

            await usecase.execute("branch-1", "Seoul", "  valid-template  ");

            expect(repository.create).toHaveBeenCalledWith(
                "branch-1",
                expect.objectContaining({ templateId: "valid-template" }),
            );
        });
    });

    describe("UpdateAreaTemplateUsecase", () => {
        it.each(["", "   "])(
            "should reject an empty templateId (%j) before repository update",
            async (templateId) => {
                repository.findByArea.mockResolvedValue(
                    new AreaTemplateEntity("id", "Seoul", "existing-template", "Name"),
                );
                const usecase = new UpdateAreaTemplateUsecase(repository);

                await expect(
                    usecase.execute("branch-1", "Seoul", { templateId }),
                ).rejects.toThrow("Area template templateId must be a non-empty string");
                expect(repository.update).not.toHaveBeenCalled();
            },
        );

        it("should preserve partial update semantics while trimming templateId", async () => {
            repository.findByArea.mockResolvedValue(
                new AreaTemplateEntity("id", "Seoul", "existing-template", "Name"),
            );
            repository.update.mockResolvedValue(
                new AreaTemplateEntity("id", "Seoul", "valid-template", "Name"),
            );
            const usecase = new UpdateAreaTemplateUsecase(repository);

            await usecase.execute("branch-1", "Seoul", { templateId: "  valid-template  " });

            expect(repository.update).toHaveBeenCalledWith(
                "branch-1",
                expect.objectContaining({
                    templateId: "valid-template",
                    templateName: "Name",
                }),
            );
        });
    });
});
