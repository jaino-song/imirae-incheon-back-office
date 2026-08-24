import { Injectable } from "@nestjs/common";
import {
    CreateAreaTemplateUsecase,
    ListAreaTemplatesUsecase,
    ListAvailableAreasUsecase,
    FindAreaTemplateByAreaUsecase,
    UpdateAreaTemplateUsecase,
    DeleteAreaTemplateUsecase,
} from "application/usecases/area-template";
import {
    AreaTemplateEntity,
    AvailableAreaEntity,
} from "domain/entities/area-template.entity";

@Injectable()
export class AreaTemplateService {
    constructor(
        private readonly listAreaTemplatesUsecase: ListAreaTemplatesUsecase,
        private readonly listAvailableAreasUsecase: ListAvailableAreasUsecase,
        private readonly createAreaTemplateUsecase: CreateAreaTemplateUsecase,
        private readonly findAreaTemplateByAreaUsecase: FindAreaTemplateByAreaUsecase,
        private readonly updateAreaTemplateUsecase: UpdateAreaTemplateUsecase,
        private readonly deleteAreaTemplateUsecase: DeleteAreaTemplateUsecase,
    ) {}

    create(
        branchid: string,
        params: { area: string; templateId: string; templateName?: string | null }
    ): Promise<AreaTemplateEntity> {
        return this.createAreaTemplateUsecase.execute(
            branchid,
            params.area,
            params.templateId,
            params.templateName ?? null
        );
    }

    findAll(branchid: string): Promise<AreaTemplateEntity[]> {
        return this.listAreaTemplatesUsecase.execute(branchid);
    }

    findAvailableAreas(branchid: string): Promise<AvailableAreaEntity[]> {
        return this.listAvailableAreasUsecase.execute(branchid);
    }

    findByArea(branchid: string, area: string): Promise<AreaTemplateEntity | null> {
        return this.findAreaTemplateByAreaUsecase.execute(branchid, area);
    }

    update(
        branchid: string,
        area: string,
        params: { templateId?: string; templateName?: string | null }
    ): Promise<AreaTemplateEntity> {
        return this.updateAreaTemplateUsecase.execute(branchid, area, params);
    }

    delete(branchid: string, area: string) {
        return this.deleteAreaTemplateUsecase.execute(branchid, area);
    }
}
