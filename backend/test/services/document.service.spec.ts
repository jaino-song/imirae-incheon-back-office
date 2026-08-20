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
        findBranchById: jest.fn(),
        findByOrgId: jest.fn(),
        findByCategoryId: jest.fn(),
        findAll: jest.fn(),
        existsByStoragePath: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
    } as MockDocumentRepository;
}

describe("DocumentService", () => {
    let documentRepository: MockDocumentRepository;
    let service: DocumentService;

    beforeEach(() => {
        documentRepository = createRepository();
        service = new DocumentService(documentRepository);
    });

    it("rejects document creation when any document already claims the storage path", async () => {
        documentRepository.existsByStoragePath.mockResolvedValue(true);

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

        expect(documentRepository.existsByStoragePath).toHaveBeenCalledWith("documents/shared.pdf");
        expect(documentRepository.create).not.toHaveBeenCalled();
    });

    it("creates a document only when the server-generated storage path is unclaimed", async () => {
        const createdEntity = createDocumentEntity("branch-1");
        documentRepository.existsByStoragePath.mockResolvedValue(false);
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
        expect(documentRepository.existsByStoragePath).toHaveBeenCalledWith("documents/contract.pdf");
        expect(documentRepository.create).toHaveBeenCalledWith(
            "branch-1",
            expect.objectContaining({
                storagePath: "documents/contract.pdf",
                orgId: "branch-1",
            }),
        );
    });

    it("persists the server-derived all-branches visibility on an owner upload", async () => {
        const createdEntity = createDocumentEntity("branch-1");
        documentRepository.existsByStoragePath.mockResolvedValue(false);
        documentRepository.create.mockResolvedValue(createdEntity);

        await service.create("branch-1", {
            name: "Owner notice",
            categoryId: "notice",
            tags: [],
            mimetype: "application/pdf",
            filesize: 100,
            storagepath: "documents/owner-notice.pdf",
            branchid: "branch-1",
            uploadedby: "owner-1",
            visibilityScope: "all_branches",
        } as never);

        expect(documentRepository.create).toHaveBeenCalledWith(
            "branch-1",
            expect.objectContaining({ visibilityScope: "all_branches" }),
        );
    });

    it("does not let a globally readable document become writable from another branch", async () => {
        const globallyReadable = createDocumentEntity("branch-origin");
        documentRepository.findById.mockResolvedValue(globallyReadable);
        documentRepository.findBranchById.mockResolvedValue(null);

        await expect(service.update("branch-reader", globallyReadable.id, { name: "tampered" }))
            .rejects.toThrow("not found");

        expect(documentRepository.update).not.toHaveBeenCalled();
    });

    it("deletes the storage object before removing branch-owned metadata", async () => {
        const document = createDocumentEntity("branch-1");
        const storage = { delete: jest.fn().mockResolvedValue(undefined) };
        documentRepository.findBranchById.mockResolvedValue(document);
        documentRepository.delete.mockResolvedValue(undefined);
        service = new DocumentService(documentRepository, storage as never);

        await service.deleteWithStorage("branch-1", document.id);

        expect(storage.delete).toHaveBeenCalledWith(document.storagePath);
        expect(documentRepository.delete).toHaveBeenCalledWith("branch-1", document.id);
        expect(storage.delete.mock.invocationCallOrder[0]).toBeLessThan(documentRepository.delete.mock.invocationCallOrder[0]!);
    });

    it("finishes staged metadata cleanup without replaying storage deletion", async () => {
        const document = createDocumentEntity("branch-1");
        const storage = { delete: jest.fn().mockResolvedValue(undefined) };
        documentRepository.findBranchById.mockResolvedValueOnce(document).mockResolvedValueOnce(document);
        documentRepository.delete.mockResolvedValue(undefined);
        service = new DocumentService(documentRepository, storage as never);

        await service.deleteStorageForDocument("branch-1", document.id);
        await service.deleteMetadataAfterStorageDeletion("branch-1", document.id);

        expect(storage.delete).toHaveBeenCalledTimes(1);
        expect(documentRepository.delete).toHaveBeenCalledWith("branch-1", document.id);
    });

    it("repeats a staged delete safely and becomes a no-op after metadata is gone", async () => {
        const document = createDocumentEntity("branch-1");
        const storage = { delete: jest.fn().mockResolvedValue(undefined) };
        documentRepository.findBranchById.mockResolvedValueOnce(document).mockResolvedValueOnce(null);
        documentRepository.delete.mockResolvedValue(undefined);
        service = new DocumentService(documentRepository, storage as never);

        await service.recoverStagedDeletion("branch-1", document.id);
        await service.recoverStagedDeletion("branch-1", document.id);

        expect(storage.delete).toHaveBeenCalledTimes(1);
        expect(documentRepository.delete).toHaveBeenCalledTimes(1);
        expect(documentRepository.delete).toHaveBeenCalledWith("branch-1", document.id);
    });

    it("deletes only the exact staged storage path without reading mutable metadata", async () => {
        const storage = { delete: jest.fn().mockResolvedValue(undefined) };
        service = new DocumentService(documentRepository, storage as never);

        await service.deleteStoragePath("documents/staged-contract.pdf");

        expect(storage.delete).toHaveBeenCalledWith("documents/staged-contract.pdf");
        expect(documentRepository.findById).not.toHaveBeenCalled();
        expect(documentRepository.delete).not.toHaveBeenCalled();
    });

    it("treats already-missing metadata as a completed staged deletion", async () => {
        const storage = { delete: jest.fn() };
        documentRepository.findBranchById.mockResolvedValue(null);
        service = new DocumentService(documentRepository, storage as never);

        await expect(service.recoverStagedDeletion("branch-1", "doc-1")).resolves.toBeUndefined();

        expect(storage.delete).not.toHaveBeenCalled();
        expect(documentRepository.delete).not.toHaveBeenCalled();
    });
});
