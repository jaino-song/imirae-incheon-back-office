import { SystemTemplateMutationGuardService } from "application/services/system-template-mutation-guard.service";
import { ResetToDefaultUseCase } from "application/usecases/system-template/reset-to-default.usecase";
import { RollbackToVersionUseCase } from "application/usecases/system-template/rollback-to-version.usecase";
import { MessageTriggerTemplateKey } from "domain/constants/message-trigger-catalog";
import { SystemTemplateKey } from "domain/constants/system-template-registry";
import { SystemTemplateEntity } from "domain/entities/system-template.entity";
import { SystemTemplateVersionEntity } from "domain/entities/system-template-version.entity";

describe("system template rollback and reset mutation safety", () => {
    const transaction = { id: "template-mutation-transaction" };
    const createLock = () => ({
        runExclusive: jest.fn().mockImplementation(async (
            _key: SystemTemplateKey,
            work: (writeTransaction: unknown) => Promise<unknown>,
        ) => work(transaction)),
    });
    const createRuleRepository = () => ({
        findActiveTemplateKeys: jest.fn().mockResolvedValue([
            MessageTriggerTemplateKey.SERVICE_INFO,
        ]),
    });

    it("rejects a historical rollback whose removed custom variable can no longer be resolved", async () => {
        const currentTemplate = SystemTemplateEntity.reconstitute(
            "template-service-info",
            SystemTemplateKey.SERVICE_INFO,
            "{{name}} 안내",
            new Date("2026-08-01T00:00:00.000Z"),
            new Date("2026-08-02T00:00:00.000Z"),
            [],
        );
        const historicalVersion = SystemTemplateVersionEntity.reconstitute(
            "version-1",
            currentTemplate.id,
            "{{name}} 예약 번호: {{reservationCode}}",
            1,
            "owner-1",
            new Date("2026-07-01T00:00:00.000Z"),
        );
        const repository = {
            getVersionByNumber: jest.fn().mockResolvedValue(historicalVersion),
            findByKey: jest.fn().mockResolvedValue(currentTemplate),
            createVersion: jest.fn(),
            save: jest.fn(),
        };
        const guard = new SystemTemplateMutationGuardService(
            createRuleRepository() as never,
        );
        const useCase = new RollbackToVersionUseCase(
            repository as never,
            guard,
            createLock() as never,
        );

        await expect(useCase.execute(
            SystemTemplateKey.SERVICE_INFO,
            1,
            "owner-1",
        )).rejects.toMatchObject({
            response: expect.objectContaining({
                errors: expect.arrayContaining([
                    expect.objectContaining({
                        message: "정의되지 않은 변수: {{reservationCode}}",
                    }),
                ]),
            }),
        });

        expect(repository.getVersionByNumber).toHaveBeenCalledWith(
            SystemTemplateKey.SERVICE_INFO,
            1,
            transaction,
        );
        expect(repository.createVersion).not.toHaveBeenCalled();
        expect(repository.save).not.toHaveBeenCalled();
    });

    it("reset restores the default content and clears obsolete custom-variable requirements atomically", async () => {
        const currentTemplate = SystemTemplateEntity.reconstitute(
            "template-service-info",
            SystemTemplateKey.SERVICE_INFO,
            "{{name}} 예약 번호: {{reservationCode}}",
            new Date("2026-08-01T00:00:00.000Z"),
            new Date("2026-08-02T00:00:00.000Z"),
            [{ key: "reservationCode", label: "예약 번호", required: true }],
        );
        const repository = {
            findByKey: jest.fn().mockResolvedValue(currentTemplate),
            save: jest.fn().mockImplementation(async (template: SystemTemplateEntity) => template),
            createVersion: jest.fn().mockResolvedValue(undefined),
        };
        const guard = new SystemTemplateMutationGuardService(
            createRuleRepository() as never,
        );
        const lock = createLock();
        const useCase = new ResetToDefaultUseCase(
            repository as never,
            guard,
            lock as never,
        );

        const result = await useCase.execute(SystemTemplateKey.SERVICE_INFO, "owner-1");

        expect(result.customVariables).toEqual([]);
        expect(result.content).not.toContain("reservationCode");
        expect(repository.createVersion).toHaveBeenCalledWith(
            currentTemplate.id,
            currentTemplate.content,
            "owner-1",
            transaction,
        );
        expect(repository.save).toHaveBeenLastCalledWith(
            expect.objectContaining({ customVariables: [] }),
            transaction,
        );
        expect(lock.runExclusive).toHaveBeenCalledWith(
            SystemTemplateKey.SERVICE_INFO,
            expect.any(Function),
        );
    });
});
