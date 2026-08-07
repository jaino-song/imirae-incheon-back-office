import { ConflictException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { DocumentCategoryService } from "application/services/document-category.service";
import { PrismaService } from "infrastructure/database/prisma.service";

describe("DocumentCategoryService", () => {
    const createPrismaService = () => ({
        document_category: {
            findMany: jest.fn(),
            findFirst: jest.fn(),
            create: jest.fn(),
            deleteMany: jest.fn(),
        },
    });

    const uniqueViolation = () =>
        new Prisma.PrismaClientKnownRequestError("duplicate", {
            code: "P2002",
            clientVersion: "test",
            meta: { target: ["branch_id", "value"] },
        });

    let prisma: ReturnType<typeof createPrismaService>;
    let service: DocumentCategoryService;

    beforeEach(() => {
        prisma = createPrismaService();
        service = new DocumentCategoryService(prisma as unknown as PrismaService);
    });

    it("should list global and branch-specific categories only", async () => {
        prisma.document_category.findMany.mockResolvedValue([
            {
                id: "global-category",
                value: "contract",
                label: "계약서",
                color: "primary",
                isCustom: false,
                createdAt: new Date("2026-01-01T00:00:00.000Z"),
            },
        ]);

        await service.findAll("branch-1");

        expect(prisma.document_category.findMany).toHaveBeenCalledWith({
            where: {
                OR: [
                    { branchId: "branch-1" },
                    { branchId: null },
                ],
            },
            orderBy: { createdAt: "asc" },
        });
    });

    it("should return global categories alongside the branch's own", async () => {
        prisma.document_category.findMany.mockResolvedValue([
            {
                id: "global-category",
                value: "contract",
                label: "계약서",
                color: "primary",
                isCustom: false,
                createdAt: new Date("2026-01-01T00:00:00.000Z"),
                branchId: null,
            },
            {
                id: "branch-category",
                value: "branch-only",
                label: "Branch Only",
                color: "secondary",
                isCustom: true,
                createdAt: new Date("2026-01-02T00:00:00.000Z"),
                branchId: "branch-1",
            },
        ]);

        const result = await service.findAll("branch-1");

        expect(result.map((c) => c.id)).toEqual(["global-category", "branch-category"]);
        expect(result[0]).toMatchObject({ value: "contract", isCustom: false });
        expect(result[1]).toMatchObject({ value: "branch-only", isCustom: true });
    });

    it("should persist custom categories under the selected branch", async () => {
        prisma.document_category.findFirst.mockResolvedValue(null);
        prisma.document_category.create.mockResolvedValue({
            id: "category-1",
            value: "branch-contract",
            label: "Branch Contract",
            color: "primary",
            isCustom: true,
            createdAt: new Date("2026-01-01T00:00:00.000Z"),
        });

        await service.create({
            branchId: "branch-1",
            value: "branch-contract",
            label: "Branch Contract",
            color: "primary",
        });

        expect(prisma.document_category.findFirst).toHaveBeenCalledWith({
            where: { value: "branch-contract", branchId: null },
            select: { id: true },
        });
        expect(prisma.document_category.create).toHaveBeenCalledWith({
            data: {
                branchId: "branch-1",
                value: "branch-contract",
                label: "Branch Contract",
                color: "primary",
                isCustom: true,
            },
        });
    });

    // value is unique per (branchId, value) — not globally — so two branches may
    // legitimately own the same category value. The guarantee itself lives in the
    // composite unique index of 20260807000000_scope_document_category_value_per_branch;
    // this test pins the service contract on top of it (no cross-branch pre-check,
    // both creates go through with their own branchId).
    it("should let two different branches create a category with the same value", async () => {
        prisma.document_category.findFirst.mockResolvedValue(null);
        prisma.document_category.create
            .mockResolvedValueOnce({
                id: "category-a",
                value: "onboarding",
                label: "Onboarding",
                color: "primary",
                isCustom: true,
                createdAt: new Date("2026-01-01T00:00:00.000Z"),
            })
            .mockResolvedValueOnce({
                id: "category-b",
                value: "onboarding",
                label: "Onboarding",
                color: "primary",
                isCustom: true,
                createdAt: new Date("2026-01-02T00:00:00.000Z"),
            });

        const first = await service.create({
            branchId: "branch-1",
            value: "onboarding",
            label: "Onboarding",
            color: "primary",
        });
        const second = await service.create({
            branchId: "branch-2",
            value: "onboarding",
            label: "Onboarding",
            color: "primary",
        });

        expect(first).toMatchObject({ id: "category-a", value: "onboarding" });
        expect(second).toMatchObject({ id: "category-b", value: "onboarding" });
        expect(prisma.document_category.create).toHaveBeenNthCalledWith(1, {
            data: {
                branchId: "branch-1",
                value: "onboarding",
                label: "Onboarding",
                color: "primary",
                isCustom: true,
            },
        });
        expect(prisma.document_category.create).toHaveBeenNthCalledWith(2, {
            data: {
                branchId: "branch-2",
                value: "onboarding",
                label: "Onboarding",
                color: "primary",
                isCustom: true,
            },
        });
    });

    // Without this guard a branch could shadow a global category: the composite
    // unique never fires against branch-null rows, findAll would then return the
    // same value twice for that branch.
    it("should reject a value that collides with a global category, naming the value", async () => {
        prisma.document_category.findFirst.mockResolvedValue({ id: "global-contract" });

        const promise = service.create({
            branchId: "branch-2",
            value: "contract",
            label: "계약서",
            color: "primary",
        });

        await expect(promise).rejects.toBeInstanceOf(ConflictException);
        await expect(promise).rejects.toMatchObject({
            status: 409,
            response: expect.objectContaining({
                statusCode: 409,
                code: "GLOBAL_CATEGORY_CONFLICT",
                error: "Conflict",
                field: "value",
                message: expect.stringContaining("'contract'"),
            }),
        });
        expect(prisma.document_category.findFirst).toHaveBeenCalledWith({
            where: { value: "contract", branchId: null },
            select: { id: true },
        });
        expect(prisma.document_category.create).not.toHaveBeenCalled();
    });

    it("should translate a same-branch duplicate (P2002) into a conflict naming the value", async () => {
        prisma.document_category.findFirst.mockResolvedValue(null);
        prisma.document_category.create.mockRejectedValue(uniqueViolation());

        const promise = service.create({
            branchId: "branch-1",
            value: "branch-contract",
            label: "Branch Contract",
            color: "primary",
        });

        await expect(promise).rejects.toBeInstanceOf(ConflictException);
        await expect(promise).rejects.toMatchObject({
            status: 409,
            response: expect.objectContaining({
                statusCode: 409,
                code: "P2002",
                error: "Conflict",
                field: "value",
                message: expect.stringContaining("'branch-contract'"),
            }),
        });
    });

    it("should rethrow non-unique-constraint errors untouched", async () => {
        prisma.document_category.findFirst.mockResolvedValue(null);
        const dbDown = new Error("connection refused");
        prisma.document_category.create.mockRejectedValue(dbDown);

        await expect(
            service.create({
                branchId: "branch-1",
                value: "branch-contract",
                label: "Branch Contract",
                color: "primary",
            }),
        ).rejects.toBe(dbDown);
    });

    it("should delete only custom categories in the selected branch", async () => {
        prisma.document_category.deleteMany.mockResolvedValue({ count: 1 });

        await service.delete("branch-1", "category-1");

        expect(prisma.document_category.deleteMany).toHaveBeenCalledWith({
            where: {
                id: "category-1",
                branchId: "branch-1",
                isCustom: true,
            },
        });
    });

    // A global category has branchId = NULL and isCustom = false, so the scoped
    // deleteMany filter can never match it — count 0, nothing deleted, no error.
    it("should not delete a global category: the branch-scoped filter cannot match it", async () => {
        prisma.document_category.deleteMany.mockResolvedValue({ count: 0 });

        await expect(service.delete("branch-1", "global-category")).resolves.toBeUndefined();

        expect(prisma.document_category.deleteMany).toHaveBeenCalledWith({
            where: {
                id: "global-category",
                branchId: "branch-1",
                isCustom: true,
            },
        });
    });
});
