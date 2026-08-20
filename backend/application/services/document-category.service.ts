import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "infrastructure/database/prisma.service";

export interface DocumentCategory {
    id: string;
    value: string;
    label: string;
    color: string;
    isCustom: boolean;
    createdAt: Date;
}

@Injectable()
export class DocumentCategoryService {
    constructor(private readonly prisma: PrismaService) {}

    async assertAvailableToBranch(branchId: string, categoryId: string): Promise<void> {
        const category = await this.prisma.document_category.findFirst({
            where: {
                id: categoryId,
                OR: [
                    { branchId },
                    { branchId: null },
                ],
            },
            select: { id: true },
        });

        if (!category) {
            throw new NotFoundException("Document category not found");
        }
    }

    async findAll(branchId: string): Promise<DocumentCategory[]> {
        const categories = await this.prisma.document_category.findMany({
            where: {
                OR: [
                    { branchId },
                    { branchId: null },
                ],
            },
            orderBy: { createdAt: "asc" },
        });
        return categories.map((c) => ({
            id: c.id,
            value: c.value,
            label: c.label,
            color: c.color,
            isCustom: c.isCustom,
            createdAt: c.createdAt,
        }));
    }

    async create(params: {
        branchId: string;
        value: string;
        label: string;
        color: string;
    }): Promise<DocumentCategory> {
        // Global (branch-null) categories are visible to every branch through
        // findAll's branch-null fallback. The per-branch unique index cannot stop
        // a branch from shadowing one (NULL branch_id never collides with a
        // concrete branch_id), so reject the collision here — otherwise findAll
        // would list the same value twice for this branch.
        const globalCategory = await this.prisma.document_category.findFirst({
            where: { value: params.value, branchId: null },
            select: { id: true },
        });
        if (globalCategory) {
            throw new ConflictException({
                statusCode: 409,
                code: "GLOBAL_CATEGORY_CONFLICT",
                error: "Conflict",
                field: "value",
                message: `Category value '${params.value}' is already used by a global category`,
            });
        }

        try {
            const category = await this.prisma.document_category.create({
                data: {
                    branchId: params.branchId,
                    value: params.value,
                    label: params.label,
                    color: params.color,
                    isCustom: true,
                },
            });
            return {
                id: category.id,
                value: category.value,
                label: category.label,
                color: category.color,
                isCustom: category.isCustom,
                createdAt: category.createdAt,
            };
        } catch (error) {
            // The only unique constraint this insert can violate is the per-branch
            // (branch_id, value) index, so name the colliding value instead of
            // surfacing a bare 409 through PrismaExceptionFilter.
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
                throw new ConflictException({
                    statusCode: 409,
                    code: "P2002",
                    error: "Conflict",
                    field: "value",
                    message: `Category value '${params.value}' already exists in this branch`,
                });
            }
            throw error;
        }
    }

    async delete(branchId: string, id: string): Promise<void> {
        await this.prisma.document_category.deleteMany({
            where: {
                id,
                branchId,
                isCustom: true,
            },
        });
    }
}
