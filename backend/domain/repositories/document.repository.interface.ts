import { DocumentEntity } from 'domain/entities/document.entity';

export interface DocumentFilter {
    category?: string;
    tags?: string[];
    uploadedBy?: string;
    orgId?: string;
}

export interface IDocumentRepository {
    findById(branchid: string, id: string): Promise<DocumentEntity | null>;
    findBranchById(branchid: string, id: string): Promise<DocumentEntity | null>;
    findByOrgId(branchid: string, orgId: string): Promise<DocumentEntity[]>;
    findByCategoryId(branchid: string, categoryId: string): Promise<DocumentEntity[]>;
    findAll(branchid: string): Promise<DocumentEntity[]>;
    existsByStoragePath(storagePath: string): Promise<boolean>;
    create(branchid: string, doc: DocumentEntity): Promise<DocumentEntity>;
    update(branchid: string, doc: DocumentEntity): Promise<DocumentEntity>;
    delete(branchid: string, id: string): Promise<void>;
}

export const DOCUMENT_REPOSITORY = 'DOCUMENT_REPOSITORY';
