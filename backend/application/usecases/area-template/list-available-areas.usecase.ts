import { Inject, Injectable } from "@nestjs/common";

import { AvailableAreaEntity } from "domain/entities/area-template.entity";
import {
    AREA_TEMPLATE_REPOSITORY,
    IAreaTemplateRepository,
} from "domain/repositories/area-template.repository.interface";

@Injectable()
export class ListAvailableAreasUsecase {
    constructor(
        @Inject(AREA_TEMPLATE_REPOSITORY)
        private readonly areaTemplateRepository: IAreaTemplateRepository,
    ) {}

    execute(branchid: string): Promise<AvailableAreaEntity[]> {
        return this.areaTemplateRepository.findAvailableAreas(branchid);
    }
}
