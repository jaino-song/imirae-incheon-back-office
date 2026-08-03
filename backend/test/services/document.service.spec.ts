import { ForbiddenException } from "@nestjs/common";

import { DocumentService } from "application/services/document.service";
import { DocumentEntity } from "domain/entities/document.entity";
import { IDocumentRepository } from "domain/repositories/document.repository.interface";

type MockDocumentRepository = jest.Mocked<IDocumentRepository>;

function createDocumentEntity(branchId: string, storagePath = "documents/contract.pdf"): DocumentEntity {
    return DocumentEntity.reconstitute(
        "doc-1",
        "Contract",
        null,
        "contract",
        ["signed"],
        "application/pdf",
        100,
        storagePath,
        null,
        branchId,
        "user-1",
        new Date("2026-01-01T00:00:00.000Z"),
        new Date("2026-01-01T00:00:00.000Z"),
    );
}

function createRepository(): MockDocumentRepository {
    return {
        findById: jest.fn(),
        findByOrgId: jest.fn(),
        findByCategoryId: jest.fn(),
        findAll: jest.fn(),
        existsByStoragePathOutsideBranch: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
    };
}

describe("DocumentService", () => {
    let documentRepository: MockDocumentRepository;
    let service: DocumentService;

    beforeEach(() => {
        documentRepository = createRepository();
        service = new DocumentService(documentRepository);
    });

    it("rejects document creation when another branch already claims the storage path", async () => {
        documentRepository.existsByStoragePathOutsideBranch.mockResolvedValue(true);

        await expect(service.create("branch-1", {
            name: "Contract",
            description: "Branch contract",
            categoryId: "contract",
            tags: ["signed"],
            mimetype: "application/pdf",
            filesize: 100,
            storagepath: "documents/shared.pdf",
            branchid: "branch-1",
            uploadedby: "user-1",
        })).rejects.toThrow(new ForbiddenException("storage path unavailable"));

        expect(documentRepository.existsByStoragePathOutsideBranch).toHaveBeenCalledWith(
            "branch-1",
            "documents/shared.pdf",
        );
        expect(documentRepository.create).not.toHaveBeenCalled();
    });

    it("preserves same-branch storage path re-creation behavior", async () => {
        const createdEntity = createDocumentEntity("branch-1");
        documentRepository.existsByStoragePathOutsideBranch.mockResolvedValue(false);
        documentRepository.create.mockResolvedValue(createdEntity);

        const result = await service.create("branch-1", {
            name: "Contract",
            description: "Branch contract",
            categoryId: "contract",
            tags: ["signed"],
            mimetype: "application/pdf",
            filesize: 100,
            storagepath: "documents/contract.pdf",
            branchid: "branch-1",
            uploadedby: "user-1",
        });

        expect(result).toBe(createdEntity);
        expect(documentRepository.existsByStoragePathOutsideBranch).toHaveBeenCalledWith(
            "branch-1",
            "documents/contract.pdf",
        );
        expect(documentRepository.create).toHaveBeenCalledWith(
            "branch-1",
            expect.objectContaining({
                storagePath: "documents/contract.pdf",
                orgId: "branch-1",
            }),
        );
    });

    it("deletes the storage object before removing branch-owned metadata", async () => {
        const document = createDocumentEntity("branch-1");
        const storage = { delete: jest.fn().mockResolvedValue(undefined) };
        documentRepository.findById.mockResolvedValue(document);
        documentRepository.delete.mockResolvedValue(undefined);
        service = new DocumentService(documentRepository, storage as never);

        await service.deleteWithStorage("branch-1", document.id);

        expect(storage.delete).toHaveBeenCalledWith(document.storagePath);
        expect(documentRepository.delete).toHaveBeenCalledWith("branch-1", document.id);
        expect(storage.delete.mock.invocationCallOrder[0]).toBeLessThan(documentRepository.delete.mock.invocationCallOrder[0]!);
    });
});
