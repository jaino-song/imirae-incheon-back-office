import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
    CustomVariable,
    SYSTEM_TEMPLATE_REGISTRY,
    SystemTemplateKey,
} from "domain/constants/system-template-registry";
import {
    findUnsupportedRequiredMessageTriggerVariables,
    getMessageTriggerTemplateKeysForSystemTemplate,
} from "domain/constants/message-trigger-variable-sources";
import { SystemTemplateEntity, VariableValidationResult } from "domain/entities/system-template.entity";
import {
    IMessageTriggerRuleRepository,
    MESSAGE_TRIGGER_RULE_REPOSITORY,
} from "domain/repositories/message-trigger-rule.repository.interface";

export function validateSystemTemplateCandidate(
    key: SystemTemplateKey,
    content: string,
    customVariables: CustomVariable[] = [],
): VariableValidationResult {
    const contract = SYSTEM_TEMPLATE_REGISTRY[key];
    const registryKeys = contract.requiredVariables.map((variable) => variable.key);
    const registryRequiredKeys = contract.requiredVariables
        .filter((variable) => variable.required)
        .map((variable) => variable.key);
    const customVariableKeys = customVariables.map((variable) => variable.key);
    const requiredCustomVariableKeys = customVariables
        .filter((variable) => variable.required)
        .map((variable) => variable.key);
    const allowedKeys = new Set([...registryKeys, ...customVariableKeys]);
    const requiredKeys = [...registryRequiredKeys, ...requiredCustomVariableKeys];
    const template = SystemTemplateEntity.create(key, content, customVariables);
    const contentVariables = template.extractVariables();
    const contentSet = new Set(contentVariables);
    const missingVariables = requiredKeys.filter((variable) => !contentSet.has(variable));
    const unknownVariables = contentVariables.filter((variable) => !allowedKeys.has(variable));
    const syntaxErrors = content.match(/\{\{(?![^{]*\}\})/g)
        ? ["템플릿에 닫히지 않은 {{ 가 있습니다"]
        : [];

    return {
        valid:
            missingVariables.length === 0
            && unknownVariables.length === 0
            && syntaxErrors.length === 0,
        missingVariables,
        unknownVariables,
        syntaxErrors,
    };
}

@Injectable()
export class SystemTemplateMutationGuardService {
    constructor(
        @Inject(MESSAGE_TRIGGER_RULE_REPOSITORY)
        private readonly messageTriggerRuleRepository: IMessageTriggerRuleRepository,
    ) {}

    async assertValid(
        key: SystemTemplateKey,
        content: string,
        customVariables: CustomVariable[] = [],
        transaction?: Prisma.TransactionClient,
    ): Promise<void> {
        const validation = validateSystemTemplateCandidate(key, content, customVariables);
        if (!validation.valid) {
            throw new BadRequestException({
                message: "Template validation failed",
                errors: [
                    ...validation.missingVariables.map((variable) => ({
                        field: "content",
                        message: `필수 변수 누락: {{${variable}}}`,
                    })),
                    ...validation.unknownVariables.map((variable) => ({
                        field: "content",
                        message: `정의되지 않은 변수: {{${variable}}}`,
                    })),
                    ...validation.syntaxErrors.map((message) => ({ field: "content", message })),
                ],
            });
        }

        const unsupportedByTriggerTemplate = new Map(
            getMessageTriggerTemplateKeysForSystemTemplate(key)
                .map((triggerTemplateKey) => [
                    triggerTemplateKey,
                    findUnsupportedRequiredMessageTriggerVariables(
                        triggerTemplateKey,
                        customVariables,
                    ),
                ] as const)
                .filter(([, unsupportedVariables]) => unsupportedVariables.length > 0),
        );
        if (unsupportedByTriggerTemplate.size === 0) return;

        const activeTemplateKeys = await this.messageTriggerRuleRepository.findActiveTemplateKeys(
            [...unsupportedByTriggerTemplate.keys()],
            transaction,
        );
        const unsupportedActiveVariables = [...new Set(
            activeTemplateKeys.flatMap(
                (templateKey) => unsupportedByTriggerTemplate.get(templateKey) ?? [],
            ),
        )];
        if (unsupportedActiveVariables.length === 0) return;

        throw new BadRequestException({
            message: "활성 자동 발송 규칙에서 입력할 수 없는 필수 템플릿 변수가 있습니다.",
            unsupportedVariables: unsupportedActiveVariables,
        });
    }
}
