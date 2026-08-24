import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { MessageTemplateAutomationLockService } from "application/services/message-template-automation-lock.service";
import { SystemTemplateMutationGuardService } from "application/services/system-template-mutation-guard.service";
import { SystemTemplateKey } from "domain/constants/system-template-registry";
import { SystemTemplateEntity } from "domain/entities/system-template.entity";
import { ISystemTemplateRepository, SYSTEM_TEMPLATE_REPOSITORY } from "domain/repositories/system-template.repository.interface";

@Injectable()
export class RollbackToVersionUseCase {
  constructor(
    @Inject(SYSTEM_TEMPLATE_REPOSITORY) private readonly repository: ISystemTemplateRepository,
    private readonly mutationGuard: SystemTemplateMutationGuardService,
    private readonly automationLock: MessageTemplateAutomationLockService,
  ) {}

  async execute(key: SystemTemplateKey, versionNumber: number, userId: string): Promise<SystemTemplateEntity> {
    return this.automationLock.runExclusive(key, async (transaction) => {
      const version = await this.repository.getVersionByNumber(
        key,
        versionNumber,
        transaction,
      );
      if (!version) {
        throw new NotFoundException(`Version ${versionNumber} not found`);
      }

      const template = await this.repository.findByKey(key, transaction);
      if (!template) {
        throw new NotFoundException(`Template ${key} not found`);
      }

      // Versions predate custom-variable metadata. A rollback is safe only if
      // its historical content is valid against the current variable contract.
      await this.mutationGuard.assertValid(
        key,
        version.content,
        template.customVariables,
        transaction,
      );
      await this.repository.createVersion(
        template.id,
        template.content,
        userId,
        transaction,
      );

      template.updateContent(version.content);
      return this.repository.save(template, transaction);
    });
  }
}
