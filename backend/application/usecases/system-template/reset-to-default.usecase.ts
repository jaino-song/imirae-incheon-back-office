import { Inject, Injectable } from "@nestjs/common";
import { MessageTemplateAutomationLockService } from "application/services/message-template-automation-lock.service";
import { SystemTemplateMutationGuardService } from "application/services/system-template-mutation-guard.service";
import {
  CustomVariable,
  SystemTemplateKey,
  SYSTEM_TEMPLATE_REGISTRY,
} from "domain/constants/system-template-registry";
import { SystemTemplateEntity } from "domain/entities/system-template.entity";
import { ISystemTemplateRepository, SYSTEM_TEMPLATE_REPOSITORY } from "domain/repositories/system-template.repository.interface";

@Injectable()
export class ResetToDefaultUseCase {
  constructor(
    @Inject(SYSTEM_TEMPLATE_REPOSITORY)
    private readonly repository: ISystemTemplateRepository,
    private readonly mutationGuard: SystemTemplateMutationGuardService,
    private readonly automationLock: MessageTemplateAutomationLockService,
  ) {}

  async execute(key: SystemTemplateKey, userId: string): Promise<SystemTemplateEntity> {
    return this.automationLock.runExclusive(key, async (transaction) => {
      const contract = SYSTEM_TEMPLATE_REGISTRY[key];
      const defaultCustomVariables: CustomVariable[] = [];
      await this.mutationGuard.assertValid(
        key,
        contract.defaultContent,
        defaultCustomVariables,
        transaction,
      );

      let template = await this.repository.findByKey(key, transaction);
      if (!template) {
        template = SystemTemplateEntity.create(key, contract.defaultContent);
      }

      template = await this.repository.save(template, transaction);
      await this.repository.createVersion(
        template.id,
        template.content,
        userId,
        transaction,
      );

      const resetTemplate = SystemTemplateEntity.reconstitute(
        template.id,
        template.templateKey,
        contract.defaultContent,
        template.createdAt,
        new Date(),
        defaultCustomVariables,
      );
      return this.repository.save(resetTemplate, transaction);
    });
  }
}
