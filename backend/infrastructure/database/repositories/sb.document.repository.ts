import { Injectable } from "@nestjs/common";
import { IDocumentRepository } from "domain/repositories/document.repository.interface";
import { DocumentEntity } from "domain/entities/document.entity";
import { PrismaService } from "infrastructure/database/prisma.service";
import { DocumentMapper } from "infrastructure/database/mapper/document.mapper";

const documentCategoryLabelInclude = {
    documentCategory: { select: { label: true } },
} as const;

@Injectable()
export class DocumentRepository implements IDocumentRepository {
    constructor(private readonly prismaService: PrismaService) {}

    async findById(branchid: string, id: string): Promise<DocumentEntity | null> {
        const doc = await this.prismaService.document.findFirst({
            where: {
                id,
                OR: [
                    { branchId: branchid },
                    { visibilityScope: "all_branches" },
                ],
            },
            include: documentCategoryLabelInclude,
        });
        return doc ? DocumentMapper.toDomain(doc) : null;
    }

    async findBranchById(branchid: string, id: string): Promise<DocumentEntity | null> {
        const doc = await this.prismaService.document.findFirst({
            where: { id, branchId: branchid },
            include: documentCategoryLabelInclude,
        });
        return doc ? DocumentMapper.toDomain(doc) : null;
    }

    async findByOrgId(branchid: string, orgId: string): Promise<DocumentEntity[]> {
        const docs = await this.prismaService.document.findMany({
            where: {
                orgId,
                OR: [
                    { branchId: branchid },
                    { visibilityScope: "all_branches" },
                ],
            },
            include: documentCategoryLabelInclude,
        });
        return docs.map(DocumentMapper.toDomain);
    }

    async findByCategoryId(branchid: string, categoryId: string): Promise<DocumentEntity[]> {
        const docs = await this.prismaService.document.findMany({
            where: {
                categoryId,
                OR: [
                    { branchId: branchid },
                    { visibilityScope: "all_branches" },
                ],
            },
            include: documentCategoryLabelInclude,
        });
        return docs.map(DocumentMapper.toDomain);
    }

    async findAll(branchid: string): Promise<DocumentEntity[]> {
        const docs = await this.prismaService.document.findMany({
            where: {
                OR: [
                    { branchId: branchid },
                    { visibilityScope: "all_branches" },
                ],
            },
            include: documentCategoryLabelInclude,
        });
        return docs.map(DocumentMapper.toDomain);
    }

    async existsByStoragePath(storagePath: string): Promise<boolean> {
        const existingDocument = await this.prismaService.document.findFirst({
            where: { storagePath },
            select: { id: true },
        });

        return existingDocument !== null;
    }

    async create(branchid: string, doc: DocumentEntity): Promise<DocumentEntity> {
        const created = await this.prismaService.document.create({
            data: {
                ...DocumentMapper.toPrismaCreate(doc),
                branchId: branchid,
            },
            include: documentCategoryLabelInclude,
        });
        return DocumentMapper.toDomain(created);
    }

    async update(branchid: string, doc: DocumentEntity): Promise<DocumentEntity> {
        if (!doc.id) {
            throw new Error("Cannot update document without id");
        }
        const result = await this.prismaService.document.updateMany({
            where: { id: doc.id, branchId: branchid },
            data: DocumentMapper.toPrismaUpdate(doc),
        });
        if (result.count === 0) {
            throw new Error("Document not found for branch");
        }
        const updated = await this.prismaService.document.findFirst({
            where: { id: doc.id, branchId: branchid },
            include: documentCategoryLabelInclude,
        });
        if (!updated) {
            throw new Error("Document not found after update");
        }
        return DocumentMapper.toDomain(updated);
    }

    async delete(branchid: string, id: string): Promise<void> {
        await this.prismaService.document.deleteMany({
            where: { id, branchId: branchid },
        });
    }
}
