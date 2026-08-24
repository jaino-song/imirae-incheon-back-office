import { Inject, Injectable } from "@nestjs/common";
import { MessageTemplateAutomationLockService } from "application/services/message-template-automation-lock.service";
import { SystemTemplateMutationGuardService } from "application/services/system-template-mutation-guard.service";
import {
    CustomVariable,
    SYSTEM_TEMPLATE_REGISTRY,
    SystemTemplateKey,
} from "domain/constants/system-template-registry";
import { SystemTemplateEntity } from "domain/entities/system-template.entity";
import {
    ISystemTemplateRepository,
    SYSTEM_TEMPLATE_REPOSITORY,
} from "domain/repositories/system-template.repository.interface";

@Injectable()
export class UpdateSystemTemplateUseCase {
    constructor(
        @Inject(SYSTEM_TEMPLATE_REPOSITORY)
        private readonly repository: ISystemTemplateRepository,
        private readonly mutationGuard: SystemTemplateMutationGuardService,
        private readonly automationLock: MessageTemplateAutomationLockService,
    ) {}

    async execute(
        key: SystemTemplateKey,
        content: string,
        userId: string,
        customVariables: CustomVariable[] = [],
    ): Promise<SystemTemplateEntity> {
        return this.automationLock.runExclusive(key, async (transaction) => {
            await this.mutationGuard.assertValid(key, content, customVariables, transaction);

            const contract = SYSTEM_TEMPLATE_REGISTRY[key];
            let template = await this.repository.findByKey(key, transaction);
            if (!template) {
                template = SystemTemplateEntity.create(
                    key,
                    contract.defaultContent,
                    customVariables,
                );
            }

            template = await this.repository.save(template, transaction);
            await this.repository.createVersion(
                template.id,
                template.content,
                userId,
                transaction,
            );

            const updatedTemplate = SystemTemplateEntity.reconstitute(
                template.id,
                template.templateKey,
                content,
                template.createdAt,
                new Date(),
                customVariables,
            );
            return this.repository.save(updatedTemplate, transaction);
        });
    }
}
