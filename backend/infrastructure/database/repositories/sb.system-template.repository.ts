import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SystemTemplateKey } from 'domain/constants/system-template-registry';
import { SystemTemplateEntity } from 'domain/entities/system-template.entity';
import { SystemTemplateVersionEntity } from 'domain/entities/system-template-version.entity';
import { ISystemTemplateRepository } from 'domain/repositories/system-template.repository.interface';
import { PrismaService } from '../prisma.service';
import { SystemTemplateMapper } from '../mapper/system-template.mapper';

@Injectable()
export class SbSystemTemplateRepository implements ISystemTemplateRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByKey(
    key: SystemTemplateKey,
    transaction?: Prisma.TransactionClient,
  ): Promise<SystemTemplateEntity | null> {
    const row = await (transaction ?? this.prisma).system_template.findUnique({
      where: { templateKey: key },
    });
    return row ? SystemTemplateMapper.toDomain(row) : null;
  }

  async findAll(): Promise<SystemTemplateEntity[]> {
    const rows = await this.prisma.system_template.findMany({
      orderBy: { templateKey: 'asc' },
    });
    return rows.map((row) => SystemTemplateMapper.toDomain(row));
  }

  async save(
    template: SystemTemplateEntity,
    transaction?: Prisma.TransactionClient,
  ): Promise<SystemTemplateEntity> {
    const row = await (transaction ?? this.prisma).system_template.upsert({
      where: { templateKey: template.templateKey },
      create: { templateKey: template.templateKey, content: template.content, customVariables: (template.customVariables ?? []) as any },
      update: { content: template.content, customVariables: (template.customVariables ?? []) as any, updatedAt: new Date() },
    });
    return SystemTemplateMapper.toDomain(row);
  }

  async getVersionHistory(templateKey: SystemTemplateKey): Promise<SystemTemplateVersionEntity[]> {
    const template = await this.prisma.system_template.findUnique({ where: { templateKey } });
    if (!template) return [];
    const rows = await this.prisma.system_template_version.findMany({
      where: { templateId: template.id },
      orderBy: { versionNumber: 'desc' },
    });
    return rows.map((row) => SystemTemplateMapper.versionToDomain(row));
  }

  async getVersionByNumber(
    templateKey: SystemTemplateKey,
    versionNumber: number,
    transaction?: Prisma.TransactionClient,
  ): Promise<SystemTemplateVersionEntity | null> {
    const client = transaction ?? this.prisma;
    const template = await client.system_template.findUnique({ where: { templateKey } });
    if (!template) return null;
    const row = await client.system_template_version.findUnique({
      where: { templateId_versionNumber: { templateId: template.id, versionNumber } },
    });
    return row ? SystemTemplateMapper.versionToDomain(row) : null;
  }

  async createVersion(
    templateId: string,
    content: string,
    userId: string | null,
    transaction?: Prisma.TransactionClient,
  ): Promise<SystemTemplateVersionEntity> {
    const create = async (tx: Prisma.TransactionClient) => {
      const maxVersion = await tx.system_template_version.aggregate({
        where: { templateId },
        _max: { versionNumber: true },
      });
      const nextVersionNumber = (maxVersion._max.versionNumber ?? 0) + 1;
      return tx.system_template_version.create({
        data: { templateId, content, versionNumber: nextVersionNumber, createdBy: userId },
      });
    };
    const row = transaction
      ? await create(transaction)
      : await this.prisma.$transaction(create);
    return SystemTemplateMapper.versionToDomain(row);
  }
}
