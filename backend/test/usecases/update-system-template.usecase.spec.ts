import { UpdateSystemTemplateUseCase } from "application/usecases/system-template/update-system-template.usecase";
import { SystemTemplateMutationGuardService } from "application/services/system-template-mutation-guard.service";
import {
    MessageTriggerEventType,
    MessageTriggerOffsetType,
    MessageTriggerRecipientType,
    MessageTriggerTemplateKey,
} from "domain/constants/message-trigger-catalog";
import { SystemTemplateKey } from "domain/constants/system-template-registry";
import { MessageTriggerRuleEntity } from "domain/entities/message-trigger-rule.entity";
import { SystemTemplateEntity } from "domain/entities/system-template.entity";

describe("UpdateSystemTemplateUseCase automation variable safety", () => {
    const activeServiceInfoRule = MessageTriggerRuleEntity.create({
        branchId: "branch-1",
        name: "서비스 안내 자동 발송",
        isActive: true,
        eventType: MessageTriggerEventType.SERVICE_START,
        offsetType: MessageTriggerOffsetType.BEFORE_DAYS,
        offsetDays: 7,
        recipientType: MessageTriggerRecipientType.CLIENT,
        templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
    });

    const createHarness = () => {
        const existingTemplate = SystemTemplateEntity.reconstitute(
            "template-service-info",
            SystemTemplateKey.SERVICE_INFO,
            "{{name}} 안내",
            new Date("2026-08-01T00:00:00.000Z"),
            new Date("2026-08-01T00:00:00.000Z"),
            [],
        );
        const repository = {
            findByKey: jest.fn().mockResolvedValue(existingTemplate),
            save: jest.fn().mockImplementation(async (template: SystemTemplateEntity) => template),
            createVersion: jest.fn().mockResolvedValue(undefined),
        };
        const messageTriggerRuleRepository = {
            findActiveTemplateKeys: jest.fn().mockResolvedValue([
                activeServiceInfoRule.templateKey,
            ]),
        };
        const transaction = {};
        const automationLock = {
            runExclusive: jest.fn().mockImplementation(async (
                _key: SystemTemplateKey,
                work: (writeTransaction: unknown) => Promise<unknown>,
            ) => work(transaction)),
        };
        const mutationGuard = new SystemTemplateMutationGuardService(
            messageTriggerRuleRepository as never,
        );
        const useCase = new UpdateSystemTemplateUseCase(
            repository as never,
            mutationGuard,
            automationLock as never,
        );
        return {
            useCase,
            repository,
            messageTriggerRuleRepository,
            transaction,
            automationLock,
        };
    };

    it("rejects a template edit that would break an active automation rule", async () => {
        const {
            useCase,
            repository,
            messageTriggerRuleRepository,
            automationLock,
        } = createHarness();

        await expect(useCase.execute(
            SystemTemplateKey.SERVICE_INFO,
            "{{name}} 예약 번호: {{reservationCode}}",
            "user-1",
            [{ key: "reservationCode", label: "예약 코드", required: true }],
        )).rejects.toMatchObject({
            response: expect.objectContaining({
                unsupportedVariables: ["reservationCode"],
            }),
        });

        expect(messageTriggerRuleRepository.findActiveTemplateKeys).toHaveBeenCalledWith(
            [MessageTriggerTemplateKey.SERVICE_INFO],
            expect.any(Object),
        );
        expect(repository.findByKey).not.toHaveBeenCalled();
        expect(repository.save).not.toHaveBeenCalled();
        expect(repository.createVersion).not.toHaveBeenCalled();
        expect(automationLock.runExclusive).toHaveBeenCalledWith(
            SystemTemplateKey.SERVICE_INFO,
            expect.any(Function),
        );
    });

    it("allows a required custom variable that the automation job deliberately supplies", async () => {
        const { useCase, repository, messageTriggerRuleRepository } = createHarness();

        await expect(useCase.execute(
            SystemTemplateKey.SERVICE_INFO,
            "{{name}} 연락처: {{phone}}",
            "user-1",
            [{ key: "phone", label: "고객 연락처", required: true }],
        )).resolves.toEqual(expect.objectContaining({
            templateKey: SystemTemplateKey.SERVICE_INFO,
            content: "{{name}} 연락처: {{phone}}",
        }));

        expect(messageTriggerRuleRepository.findActiveTemplateKeys).not.toHaveBeenCalled();
        expect(repository.save).toHaveBeenCalledTimes(2);
    });
});
