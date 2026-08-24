import {
    AreaTemplateEntity,
    AvailableAreaEntity,
} from "domain/entities/area-template.entity";

export interface IAreaTemplateRepository {
    findAll(branchid: string): Promise<AreaTemplateEntity[]>;
    findAvailableAreas(branchid: string): Promise<AvailableAreaEntity[]>;
    findByArea(branchid: string, area: string): Promise<AreaTemplateEntity | null>;
    create(branchid: string, areaTemplate: AreaTemplateEntity): Promise<AreaTemplateEntity>;
    update(branchid: string, areaTemplate: AreaTemplateEntity): Promise<AreaTemplateEntity>;
    delete(branchid: string, id: string): Promise<void>;
}

export const AREA_TEMPLATE_REPOSITORY = 'AREA_TEMPLATE_REPOSITORY';
