import { IAreaTemplateRepository } from "domain/repositories/area-template.repository.interface";
import { PrismaService } from "../prisma.service";
import {
    AreaTemplateEntity,
    AvailableAreaEntity,
} from "domain/entities/area-template.entity";
import { Injectable } from "@nestjs/common";
import { AreaTemplateMapper } from "../mapper/area-template.mapper";

@Injectable()
export class SbAreaTemplateRepository implements IAreaTemplateRepository {
    constructor(private prismaService: PrismaService) {}

    async findAll(branchid: string): Promise<AreaTemplateEntity[]> {
        const docTemplates = await this.prismaService.doc_template.findMany({
            where: { area: { branchId: branchid } },
        });
        return docTemplates.map(AreaTemplateMapper.toDomain);
    }

    async findAvailableAreas(branchid: string): Promise<AvailableAreaEntity[]> {
        const areas = await this.prismaService.area.findMany({
            where: {
                OR: [
                    { branchId: branchid },
                    { branchId: null },
                ],
            },
            select: {
                id: true,
                name: true,
                koreanName: true,
            },
            orderBy: [
                { koreanName: "asc" },
                { id: "asc" },
            ],
        });
        return areas.map(
            (area) => new AvailableAreaEntity(area.id, area.name, area.koreanName),
        );
    }

    async findByArea(branchid: string, area: string): Promise<AreaTemplateEntity | null> {
        const docTemplate = await this.prismaService.doc_template.findFirst({
            where: { areaId: area, area: { branchId: branchid } },
        });
        return docTemplate ? AreaTemplateMapper.toDomain(docTemplate) : null;
    }

    async create(branchid: string, areaTemplate: AreaTemplateEntity): Promise<AreaTemplateEntity> {
        const area = await this.prismaService.area.findFirst({
            where: { id: areaTemplate.areaId, branchId: branchid },
            select: { id: true },
        });
        if (!area) {
            throw new Error("Area not found for branch");
        }
        const created = await this.prismaService.doc_template.create({
            data: AreaTemplateMapper.toPrismaCreate(areaTemplate),
        });
        return AreaTemplateMapper.toDomain(created);
    }

    async update(branchid: string, areaTemplate: AreaTemplateEntity): Promise<AreaTemplateEntity> {
        const existing = await this.prismaService.doc_template.findFirst({
            where: { id: areaTemplate.id, area: { branchId: branchid } },
        });
        if (!existing) {
            throw new Error("Area template not found for branch");
        }
        const updated = await this.prismaService.doc_template.update({
            where: { id: areaTemplate.id },
            data: AreaTemplateMapper.toPrismaUpdate(areaTemplate),
        });
        return AreaTemplateMapper.toDomain(updated);
    }

    async delete(branchid: string, id: string): Promise<void> {
        await this.prismaService.doc_template.deleteMany({
            where: { id, area: { branchId: branchid } },
        });
    }
}
