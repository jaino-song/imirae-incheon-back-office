import { SystemTemplateKey } from '../constants/system-template-registry';
import { SystemTemplateEntity } from '../entities/system-template.entity';
import { SystemTemplateVersionEntity } from '../entities/system-template-version.entity';
import type { Prisma } from '@prisma/client';

export const SYSTEM_TEMPLATE_REPOSITORY = Symbol('SYSTEM_TEMPLATE_REPOSITORY');

export interface ISystemTemplateRepository {
  findByKey(key: SystemTemplateKey, transaction?: Prisma.TransactionClient): Promise<SystemTemplateEntity | null>;
  findAll(): Promise<SystemTemplateEntity[]>;
  save(template: SystemTemplateEntity, transaction?: Prisma.TransactionClient): Promise<SystemTemplateEntity>;
  getVersionHistory(templateKey: SystemTemplateKey): Promise<SystemTemplateVersionEntity[]>;
  getVersionByNumber(
    templateKey: SystemTemplateKey,
    versionNumber: number,
    transaction?: Prisma.TransactionClient,
  ): Promise<SystemTemplateVersionEntity | null>;
  createVersion(
    templateId: string,
    content: string,
    userId: string | null,
    transaction?: Prisma.TransactionClient,
  ): Promise<SystemTemplateVersionEntity>;
}
