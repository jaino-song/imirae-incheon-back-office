import { Injectable, Inject, NotFoundException, ForbiddenException, Optional } from "@nestjs/common";
import { DocumentEntity } from "domain/entities/document.entity";
import { IDocumentRepository, DOCUMENT_REPOSITORY } from "domain/repositories/document.repository.interface";
import { FILE_STORAGE_PORT, FileStorageObjectNotFoundError, type FileStoragePort } from "domain/ports/file-storage.port";

@Injectable()
export class DocumentService {
    constructor(
        @Inject(DOCUMENT_REPOSITORY)
        private readonly documentRepository: IDocumentRepository,
        @Optional() @Inject(FILE_STORAGE_PORT)
        private readonly fileStorage?: FileStoragePort,
    ) {}

    async create(branchId: string, params: {
        name: string;
        description?: string;
        categoryId: string;
        tags: string[];
        mimetype: string;
        filesize: number;
        storagepath: string;
        storageurl?: string;
        branchid?: string;
        uploadedby: string;
    }): Promise<DocumentEntity> {
        const isClaimedOutsideBranch = await this.documentRepository.existsByStoragePathOutsideBranch(
            branchId,
            params.storagepath,
        );
        if (isClaimedOutsideBranch) {
            throw new ForbiddenException("storage path unavailable");
        }

        const doc = DocumentEntity.create({
            name: params.name,
            description: params.description,
            categoryId: params.categoryId,
            tags: params.tags,
            mimeType: params.mimetype,
            fileSize: params.filesize,
            storagePath: params.storagepath,
            storageUrl: params.storageurl,
            orgId: params.branchid,
            uploadedBy: params.uploadedby,
        });
        return this.documentRepository.create(branchId, doc);
    }

    /**
     * Find a document by ID
     */
    async findById(branchId: string, id: string): Promise<DocumentEntity> {
        const doc = await this.documentRepository.findById(branchId, id);
        if (!doc) {
            throw new NotFoundException(`Document with id ${id} not found`);
        }
        return doc;
    }

    /**
     * Find documents by branch ID
     */
    async findByOrgId(branchId: string, orgId: string): Promise<DocumentEntity[]> {
        return this.documentRepository.findByOrgId(branchId, orgId);
    }

    async findByCategoryId(branchId: string, categoryId: string): Promise<DocumentEntity[]> {
        return this.documentRepository.findByCategoryId(branchId, categoryId);
    }

    /**
     * List all documents
     */
    async findAll(branchId: string): Promise<DocumentEntity[]> {
        return this.documentRepository.findAll(branchId);
    }

    async update(
        branchId: string,
        id: string,
        updates: {
            name?: string;
            description?: string;
            categoryId?: string;
            tags?: string[];
        },
    ): Promise<DocumentEntity> {
        const existing = await this.findById(branchId, id);

        const updated = DocumentEntity.reconstitute(
            existing.id,
            updates.name ?? existing.name,
            updates.description ?? existing.description,
            updates.categoryId ?? existing.categoryId,
            updates.tags ?? existing.tags,
            existing.mimeType,
            existing.fileSize,
            existing.storagePath,
            existing.storageUrl,
            existing.orgId,
            existing.uploadedBy,
            existing.createdAt,
            new Date(),
        );

        return this.documentRepository.update(branchId, updated);
    }

    /**
     * Delete a document
     */
    async delete(branchId: string, id: string): Promise<void> {
        await this.findById(branchId, id); // Ensure it exists
        await this.documentRepository.delete(branchId, id);
    }

    /** Canonical deletion path used by HTTP and agent actions. */
    async deleteWithStorage(branchId: string, id: string): Promise<void> {
        await this.deleteStorageForDocument(branchId, id);
        await this.deleteMetadataAfterStorageDeletion(branchId, id);
    }

    /** Delete only the external object so an agent action can durably stage completion. */
    async deleteStorageForDocument(branchId: string, id: string): Promise<void> {
        const document = await this.findById(branchId, id);
        await this.deleteStorageObject(document);
    }

    /** Idempotently complete an action-bound deletion staged before the external call. */
    async recoverStagedDeletion(branchId: string, id: string): Promise<void> {
        const document = await this.documentRepository.findById(branchId, id);
        if (!document) return;
        await this.deleteStorageObject(document);
        await this.documentRepository.delete(branchId, id);
    }

    private async deleteStorageObject(document: DocumentEntity): Promise<void> {
        if (!this.fileStorage) throw new Error("File storage is unavailable");
        try {
            await this.fileStorage.delete(document.storagePath);
        } catch (error) {
            if (!(error instanceof FileStorageObjectNotFoundError)
                && !(error instanceof Error && error.message.toLowerCase().includes("object not found"))) throw error;
        }
    }

    /** Finish only branch-scoped metadata cleanup after storage deletion is proven. */
    async deleteMetadataAfterStorageDeletion(branchId: string, id: string): Promise<void> {
        const document = await this.documentRepository.findById(branchId, id);
        if (!document) return;
        await this.documentRepository.delete(branchId, id);
    }
}
