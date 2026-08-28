import { AvailableAreaEntity } from "domain/entities/area-template.entity";
import { PrismaService } from "infrastructure/database/prisma.service";
import { SbAreaTemplateRepository } from "infrastructure/database/repositories/sb.area-template.repository";

describe("SbAreaTemplateRepository", () => {
    const areaModel = {
        findMany: jest.fn(),
    };
    const prisma = { area: areaModel } as unknown as PrismaService;
    const repository = new SbAreaTemplateRepository(prisma);

    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe("findAvailableAreas", () => {
        it("returns only branch-local and global areas in a stable display order", async () => {
            areaModel.findMany.mockResolvedValue([
                { id: "GlobalSupport", name: "Global support", koreanName: "공통 지원 지역" },
                { id: "Yeonsugu", name: "Yeonsu-gu", koreanName: "연수구" },
            ]);

            const result = await repository.findAvailableAreas("branch-1");

            expect(areaModel.findMany).toHaveBeenCalledWith({
                where: {
                    OR: [
                        { branchId: "branch-1" },
                        { branchId: null },
                    ],
                },
                select: {
                    id: true,
                    name: true,
                    koreanName: true,
                },
                orderBy: [
                    { koreanName: "asc" },
                    { id: "asc" },
                ],
            });
            expect(result).toEqual([
                new AvailableAreaEntity("GlobalSupport", "Global support", "공통 지원 지역"),
                new AvailableAreaEntity("Yeonsugu", "Yeonsu-gu", "연수구"),
            ]);
        });
    });
});
