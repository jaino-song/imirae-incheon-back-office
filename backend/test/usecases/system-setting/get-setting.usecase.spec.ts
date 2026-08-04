import { GetSettingUsecase } from "application/usecases/system-setting/get-setting.usecase";
import { ISystemSettingRepository } from "domain/repositories/system-setting.repository.interface";
import { SystemSettingEntity } from "domain/entities/system-setting.entity";

describe("GetSettingUsecase", () => {
    const createMockRepository = (): jest.Mocked<ISystemSettingRepository> => ({
        findByKey: jest.fn(),
        upsert: jest.fn(),
        compareAndSet: jest.fn(),
    });

    let usecase: GetSettingUsecase;
    let repository: jest.Mocked<ISystemSettingRepository>;

    beforeEach(() => {
        repository = createMockRepository();
        usecase = new GetSettingUsecase(repository);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe("execute", () => {
        describe("given setting exists", () => {
            it("should return the setting value", async () => {
                const entity = new SystemSettingEntity(
                    "alimtalk_provider",
                    "aligo_alimtalk",
                    new Date()
                );
                repository.findByKey.mockResolvedValue(entity);

                const result = await usecase.execute("alimtalk_provider");

                expect(repository.findByKey).toHaveBeenCalledWith("alimtalk_provider");
                expect(result).toBe("aligo_alimtalk");
            });
        });

        describe("given setting does not exist", () => {
            it("should return null", async () => {
                repository.findByKey.mockResolvedValue(null);

                const result = await usecase.execute("nonexistent_key");

                expect(result).toBeNull();
            });
        });
    });

    describe("executeEntity", () => {
        it("should return the setting entity with its updatedAt", async () => {
            const entity = new SystemSettingEntity(
                "alimtalk_provider",
                "aligo_alimtalk",
                new Date("2026-05-28T12:00:00.000Z")
            );
            repository.findByKey.mockResolvedValue(entity);

            const result = await usecase.executeEntity("alimtalk_provider");

            expect(repository.findByKey).toHaveBeenCalledWith("alimtalk_provider");
            expect(result).toBe(entity);
        });
    });

    describe("executeWithDefault", () => {
        describe("given setting exists", () => {
            it("should return the setting value", async () => {
                const entity = new SystemSettingEntity(
                    "alimtalk_provider",
                    "aligo_alimtalk",
                    new Date()
                );
                repository.findByKey.mockResolvedValue(entity);

                const result = await usecase.executeWithDefault(
                    "alimtalk_provider",
                    "aligo_alimtalk"
                );

                expect(result).toBe("aligo_alimtalk");
            });
        });

        describe("given setting does not exist", () => {
            it("should return the default value", async () => {
                repository.findByKey.mockResolvedValue(null);

                const result = await usecase.executeWithDefault(
                    "alimtalk_provider",
                    "aligo_alimtalk"
                );

                expect(result).toBe("aligo_alimtalk");
            });
        });
    });
});
