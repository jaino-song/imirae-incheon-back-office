import { SbSystemSettingRepository } from "infrastructure/database/repositories/sb.system-setting.repository";
import { PrismaService } from "infrastructure/database/prisma.service";
import { SystemSettingEntity } from "domain/entities/system-setting.entity";

describe("SbSystemSettingRepository", () => {
    const createMockPrismaClient = () => ({
        $transaction: jest.fn(),
        $queryRawUnsafe: jest.fn(),
        findUnique: jest.fn(),
        upsert: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
    });

    const createSystemSettingRow = (overrides = {}) => ({
        key: "alimtalk_provider",
        value: "aligo_alimtalk",
        updatedAt: new Date("2025-01-14T00:00:00Z"),
        ...overrides,
    });

    let systemSettingModel: ReturnType<typeof createMockPrismaClient>;
    let prisma: PrismaService;
    let repository: SbSystemSettingRepository;

    beforeEach(() => {
        systemSettingModel = createMockPrismaClient();
        prisma = {
            system_setting: systemSettingModel,
            $transaction: jest.fn(),
            $queryRawUnsafe: jest.fn(),
        } as unknown as PrismaService;
        (prisma.$transaction as jest.Mock).mockImplementation(async (callback: (transaction: typeof prisma) => Promise<unknown>) => callback(prisma));
        repository = new SbSystemSettingRepository(prisma);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe("findByKey", () => {
        describe("given a setting exists", () => {
            it("should return the mapped SystemSettingEntity", async () => {
                const row = createSystemSettingRow();
                systemSettingModel.findUnique.mockResolvedValue(row);

                const result = await repository.findByKey("alimtalk_provider");

                expect(systemSettingModel.findUnique).toHaveBeenCalledWith({
                    where: { key: "alimtalk_provider" },
                });
                expect(result).toBeInstanceOf(SystemSettingEntity);
                expect(result?.key).toBe("alimtalk_provider");
                expect(result?.value).toBe("aligo_alimtalk");
            });
        });

        describe("given a setting does not exist", () => {
            it("should return null", async () => {
                systemSettingModel.findUnique.mockResolvedValue(null);

                const result = await repository.findByKey("nonexistent_key");

                expect(result).toBeNull();
            });
        });
    });

    describe("upsert", () => {
        describe("given a new setting", () => {
            it("should create and return the setting", async () => {
                const entity = SystemSettingEntity.create("alimtalk_provider", "aligo_alimtalk");
                const row = createSystemSettingRow({ value: "aligo_alimtalk" });
                systemSettingModel.upsert.mockResolvedValue(row);

                const result = await repository.upsert(entity);

                expect(systemSettingModel.upsert).toHaveBeenCalledWith({
                    where: { key: "alimtalk_provider" },
                    create: {
                        key: "alimtalk_provider",
                        value: "aligo_alimtalk",
                        updatedAt: entity.updatedAt,
                    },
                    update: {
                        value: "aligo_alimtalk",
                        updatedAt: entity.updatedAt,
                    },
                });
                expect(result).toBeInstanceOf(SystemSettingEntity);
                expect(result.value).toBe("aligo_alimtalk");
            });
        });

        describe("given an existing setting", () => {
            it("should update and return the setting", async () => {
                const entity = new SystemSettingEntity(
                    "alimtalk_provider",
                    "none",
                    new Date()
                );
                const row = createSystemSettingRow({ value: "none" });
                systemSettingModel.upsert.mockResolvedValue(row);

                const result = await repository.upsert(entity);

                expect(systemSettingModel.upsert).toHaveBeenCalledWith({
                    where: { key: "alimtalk_provider" },
                    create: {
                        key: "alimtalk_provider",
                        value: "none",
                        updatedAt: entity.updatedAt,
                    },
                    update: {
                        value: "none",
                        updatedAt: entity.updatedAt,
                    },
                });
                expect(result.value).toBe("none");
            });
        });
    });

    describe("compareAndSet", () => {
        it("locks and updates an existing setting only when its version matches", async () => {
            const current = createSystemSettingRow({ value: "old" });
            const updated = createSystemSettingRow({ value: "new" });
            systemSettingModel.findUnique.mockResolvedValue(current);
            systemSettingModel.update.mockResolvedValue(updated);
            const entity = SystemSettingEntity.create("alimtalk_provider", "new");

            await expect(repository.compareAndSet("alimtalk_provider", "old", entity, (value) => value ?? "missing"))
                .resolves.toEqual(expect.objectContaining({ value: "new" }));
            expect((prisma.$transaction as jest.Mock)).toHaveBeenCalled();
            expect((prisma.$queryRawUnsafe as jest.Mock)).toHaveBeenCalledWith(
                'SELECT "key" FROM "system_setting" WHERE "key" = $1 FOR UPDATE',
                "alimtalk_provider",
            );
            expect(systemSettingModel.update).toHaveBeenCalledWith(expect.objectContaining({ where: { key: "alimtalk_provider" } }));
        });

        it("does not write when the version is stale", async () => {
            systemSettingModel.findUnique.mockResolvedValue(createSystemSettingRow({ value: "newer" }));
            const entity = SystemSettingEntity.create("alimtalk_provider", "new");

            await expect(repository.compareAndSet("alimtalk_provider", "old", entity, (value) => value ?? "missing"))
                .resolves.toBeNull();
            expect(systemSettingModel.update).not.toHaveBeenCalled();
            expect(systemSettingModel.create).not.toHaveBeenCalled();
        });
    });
});
