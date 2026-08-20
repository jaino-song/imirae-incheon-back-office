import { DocumentRepository } from "infrastructure/database/repositories/sb.document.repository";

describe("DocumentRepository visibility", () => {
    function setup() {
        const prisma = {
            document: {
                findFirst: jest.fn().mockResolvedValue(null),
                findMany: jest.fn().mockResolvedValue([]),
                create: jest.fn(),
                updateMany: jest.fn(),
                deleteMany: jest.fn(),
            },
        };
        return {
            prisma,
            repository: new DocumentRepository(prisma as never),
        };
    }

    it("lists current-branch documents together with owner publications", async () => {
        const { prisma, repository } = setup();

        await repository.findAll("branch-reader");

        expect(prisma.document.findMany).toHaveBeenCalledWith({
            where: {
                OR: [
                    { branchId: "branch-reader" },
                    { visibilityScope: "all_branches" },
                ],
            },
            include: { documentCategory: { select: { label: true } } },
        });
    });

    it("reads an owner publication by id from another branch", async () => {
        const { prisma, repository } = setup();

        await repository.findById("branch-reader", "doc-global");

        expect(prisma.document.findFirst).toHaveBeenCalledWith({
            where: {
                id: "doc-global",
                OR: [
                    { branchId: "branch-reader" },
                    { visibilityScope: "all_branches" },
                ],
            },
            include: { documentCategory: { select: { label: true } } },
        });
    });

    it("includes readable owner publications when filtering by source branch", async () => {
        const { prisma, repository } = setup();

        await repository.findByOrgId("branch-reader", "branch-origin");

        expect(prisma.document.findMany).toHaveBeenCalledWith({
            where: {
                orgId: "branch-origin",
                OR: [
                    { branchId: "branch-reader" },
                    { visibilityScope: "all_branches" },
                ],
            },
            include: { documentCategory: { select: { label: true } } },
        });
    });

    it("keeps mutation lookup restricted to the current branch", async () => {
        const { prisma, repository } = setup();

        await (repository as unknown as { findBranchById(branchId: string, id: string): Promise<unknown> })
            .findBranchById("branch-reader", "doc-global");

        expect(prisma.document.findFirst).toHaveBeenCalledWith({
            where: { id: "doc-global", branchId: "branch-reader" },
            include: { documentCategory: { select: { label: true } } },
        });
    });

    it("detects a claimed storage path across all branches", async () => {
        const { prisma, repository } = setup();

        await repository.existsByStoragePath("documents/branch-1/file.pdf");

        expect(prisma.document.findFirst).toHaveBeenCalledWith({
            where: { storagePath: "documents/branch-1/file.pdf" },
            select: { id: true },
        });
    });

    it("carries the source category label with a globally readable document", async () => {
        const { prisma, repository } = setup();
        prisma.document.findMany.mockResolvedValue([{
            id: "doc-global",
            name: "Owner notice",
            description: null,
            tags: [],
            mimeType: "application/pdf",
            fileSize: 100,
            storagePath: "documents/branch-origin/notice.pdf",
            storageUrl: null,
            orgId: "branch-origin",
            uploadedBy: "owner-1",
            createdAt: new Date("2026-08-20T00:00:00.000Z"),
            updatedAt: new Date("2026-08-20T00:00:00.000Z"),
            categoryId: "branch-origin-custom",
            branchId: "branch-origin",
            visibilityScope: "all_branches",
            documentCategory: { label: "원본 지점 분류" },
        }]);

        const [document] = await repository.findAll("branch-reader");

        expect(document?.categoryLabel).toBe("원본 지점 분류");
    });
});
