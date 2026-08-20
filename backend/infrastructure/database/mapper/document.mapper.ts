import { Prisma, document as PrismaDocument } from '@prisma/client';
import { DocumentEntity } from 'domain/entities/document.entity';

type DocumentRow = PrismaDocument & {
    documentCategory?: { label: string } | null;
};

export class DocumentMapper {
    static toDomain(row: DocumentRow): DocumentEntity {
        return DocumentEntity.reconstitute(
            row.id,
            row.name,
            row.description ?? null,
            row.categoryId,
            row.tags,
            row.mimeType,
            row.fileSize,
            row.storagePath,
            row.storageUrl ?? null,
            row.orgId ?? null,
            row.uploadedBy,
            row.createdAt,
            row.updatedAt,
            row.branchId ?? null,
            row.visibilityScope === "all_branches" ? "all_branches" : "branch",
            row.documentCategory?.label ?? null,
        );
    }

    static toPrismaCreate(entity: DocumentEntity): Omit<Prisma.documentUncheckedCreateInput, 'branchId'> {
        const now = new Date();
        return {
            name: entity.name,
            description: entity.description ?? null,
            categoryId: entity.categoryId,
            tags: entity.tags,
            mimeType: entity.mimeType,
            fileSize: entity.fileSize,
            storagePath: entity.storagePath,
            storageUrl: entity.storageUrl,
            orgId: entity.orgId,
            uploadedBy: entity.uploadedBy,
            visibilityScope: entity.visibilityScope,
            updatedAt: now,
        };
    }

    static toPrismaUpdate(entity: DocumentEntity): Prisma.documentUncheckedUpdateInput {
        return {
            name: entity.name,
            description: entity.description ?? null,
            categoryId: entity.categoryId,
            tags: entity.tags,
            updatedAt: new Date(),
        };
    }
}
