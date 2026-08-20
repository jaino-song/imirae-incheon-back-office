import { DOCUMENT_MAX_FILE_SIZE_BYTES } from "domain/constants/document-storage.constants";

// maximum file size (25mb in bytes)
export const max_file_size = DOCUMENT_MAX_FILE_SIZE_BYTES;
export const MAX_FILE_SIZE = max_file_size;

export const DOCUMENT_VISIBILITY_SCOPE = {
    BRANCH: "branch",
    ALL_BRANCHES: "all_branches",
} as const;

export type DocumentVisibilityScope =
    typeof DOCUMENT_VISIBILITY_SCOPE[keyof typeof DOCUMENT_VISIBILITY_SCOPE];

// predefined document categories
export const predefined_categories = [
    'contract',
    'invoice',
    'receipt',
    'report',
    'certificate',
    'form',
    'notice',
    'employee-contract',
] as const;

export type documentcategory = typeof predefined_categories[number];
// Export PascalCase alias for compatibility
export type DocumentCategory = documentcategory;

export interface CreateDocumentProps {
    name: string;
    description?: string;
    categoryId: string;
    tags: string[];
    mimeType: string;
    fileSize: number;
    storagePath: string;
    storageUrl?: string | null;
    orgId?: string | null;
    uploadedBy: string;
    branchId: string;
    visibilityScope?: DocumentVisibilityScope;
}

interface UpdateDocumentProps {
    name?: string;
    description?: string;
    category?: DocumentCategory;
    tags?: string[];
}

export class DocumentEntity {
    constructor(
        public readonly id: string,
        public name: string,
        public description: string | null,
        public categoryId: string,
        public tags: string[],
        public readonly mimeType: string,
        public readonly fileSize: number,
        public readonly storagePath: string,
        public readonly storageUrl: string | null,
        public readonly orgId: string | null,
        public readonly uploadedBy: string,
        public readonly createdAt: Date,
        public updatedAt: Date,
        public readonly branchId: string | null = null,
        public readonly visibilityScope: DocumentVisibilityScope = DOCUMENT_VISIBILITY_SCOPE.BRANCH,
        public readonly categoryLabel: string | null = null,
    ) {}

    // Lowercase accessors for controller compatibility
    get mimetype(): string { return this.mimeType; }
    get filesize(): number { return this.fileSize; }
    get storagepath(): string { return this.storagePath; }
    get storageurl(): string | null { return this.storageUrl; }
    get branchid(): string | null { return this.orgId; }
    get uploadedby(): string { return this.uploadedBy; }
    get createdat(): Date { return this.createdAt; }
    get updatedat(): Date { return this.updatedAt; }

    // 파일 크기 검증
    static validateFileSize(size: number): boolean {
        return size > 0 && size <= MAX_FILE_SIZE;
    }

    // lowercase alias
    static validatefilesize(size: number): boolean {
        return DocumentEntity.validateFileSize(size);
    }

    static validateCategory(category: string): boolean {
        return predefined_categories.includes(category as documentcategory);
    }

    // lowercase alias
    static validatecategory(category: string): boolean {
        return DocumentEntity.validateCategory(category);
    }

    // 메타데이터만 업데이트 (파일 자체는 불변)
    update(props: UpdateDocumentProps): void {
        if (props.name !== undefined) this.name = props.name;
        if (props.description !== undefined) this.description = props.description;
        if (props.category !== undefined) {
            if (!DocumentEntity.validateCategory(props.category)) {
                throw new Error(`유효하지 않은 카테고리: ${props.category}`);
            }
            this.categoryId = props.category;
        }
        if (props.tags !== undefined) this.tags = props.tags;
        this.updatedAt = new Date();
    }

    // 새 문서 생성
    static create(props: CreateDocumentProps): DocumentEntity {
        // 검증
        if (!DocumentEntity.validateFileSize(props.fileSize)) {
            throw new Error(`파일 크기가 제한을 초과했습니다. 최대 ${MAX_FILE_SIZE / 1024 / 1024}MB`);
        }

        const now = new Date();
        return new DocumentEntity(
            '',
            props.name,
            props.description ?? null,
            props.categoryId,
            props.tags,
            props.mimeType,
            props.fileSize,
            props.storagePath,
            props.storageUrl ?? null,
            props.orgId ?? null,
            props.uploadedBy,
            now,
            now,
            props.branchId,
            props.visibilityScope ?? DOCUMENT_VISIBILITY_SCOPE.BRANCH,
        );
    }

    // DB에서 재구성
    static reconstitute(
        id: string,
        name: string,
        description: string | null,
        categoryId: string,
        tags: string[],
        mimeType: string,
        fileSize: number,
        storagePath: string,
        storageUrl: string | null,
        orgId: string | null,
        uploadedBy: string,
        createdAt: Date,
        updatedAt: Date,
        branchId: string | null = null,
        visibilityScope: DocumentVisibilityScope = DOCUMENT_VISIBILITY_SCOPE.BRANCH,
        categoryLabel: string | null = null,
    ): DocumentEntity {
        return new DocumentEntity(
            id,
            name,
            description,
            categoryId,
            tags,
            mimeType,
            fileSize,
            storagePath,
            storageUrl,
            orgId,
            uploadedBy,
            createdAt,
            updatedAt,
            branchId,
            visibilityScope,
            categoryLabel,
        );
    }
}
