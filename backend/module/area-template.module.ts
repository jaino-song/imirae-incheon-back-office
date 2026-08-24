import { Module } from "@nestjs/common";
import {
    CreateAreaTemplateUsecase,
    FindAreaTemplateByAreaUsecase,
    ListAreaTemplatesUsecase,
    ListAvailableAreasUsecase,
    UpdateAreaTemplateUsecase,
    DeleteAreaTemplateUsecase,
} from "application/usecases/area-template";
import {
    SbAreaTemplateRepository,
} from "infrastructure/database/repositories/sb.area-template.repository";
import { AreaTemplateService } from "application/services/area-template.service";
import { AreaTemplateController } from "interface/controllers/area-template.controller";
import { AREA_TEMPLATE_REPOSITORY } from "domain/repositories/area-template.repository.interface";
import { DatabaseModule } from "infrastructure/database/database.module";

@Module({
    imports: [DatabaseModule],
    controllers: [AreaTemplateController],
    providers: [
        CreateAreaTemplateUsecase,
        FindAreaTemplateByAreaUsecase,
        ListAreaTemplatesUsecase,
        ListAvailableAreasUsecase,
        UpdateAreaTemplateUsecase,
        DeleteAreaTemplateUsecase,
        AreaTemplateService,
        {
            provide: AREA_TEMPLATE_REPOSITORY,
            useClass: SbAreaTemplateRepository,
        },
    ],
    exports: [AreaTemplateService],
})
export class AreaTemplateModule {}
