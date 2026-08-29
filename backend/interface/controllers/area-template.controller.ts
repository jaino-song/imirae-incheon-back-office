import { Controller, Post, Body, Get, Query, Patch, Delete, UseGuards } from "@nestjs/common";
import { AreaTemplateService } from "application/services/area-template.service";
import {
    CreateAreaTemplateDto,
    UpdateAreaTemplateDto,
} from "interface/dto/area-template.dto";
import { CurrentTenant, TenantGuard } from "infrastructure/tenant";
import { JwtGuard } from "infrastructure/auth/jwt.guard";

@Controller("area-templates")
@UseGuards(JwtGuard, TenantGuard)
export class AreaTemplateController {
    constructor(private readonly areaTemplateService: AreaTemplateService) {}

    @Post()
    create(@CurrentTenant() tenant: { branchId?: string }, @Body() dto: CreateAreaTemplateDto) {
        return this.areaTemplateService.create(tenant.branchId ?? "", dto);
    }

    @Get("area")
    findByArea(@CurrentTenant() tenant: { branchId?: string }, @Query("area") area: string) {
        return this.areaTemplateService.findByArea(tenant.branchId ?? "", area);
    }

    @Get("available-areas")
    findAvailableAreas(@CurrentTenant() tenant: { branchId?: string }) {
        return this.areaTemplateService.findAvailableAreas(tenant.branchId ?? "");
    }

    @Get()
    findAll(@CurrentTenant() tenant: { branchId?: string }) {
        return this.areaTemplateService.findAll(tenant.branchId ?? "");
    }

    @Patch()
    update(
        @CurrentTenant() tenant: { branchId?: string },
        @Query("area") area: string,
        @Body() dto: UpdateAreaTemplateDto
    ) {
        return this.areaTemplateService.update(tenant.branchId ?? "", area, dto);
    }

    @Delete()
    delete(@CurrentTenant() tenant: { branchId?: string }, @Query("area") area: string) {
        return this.areaTemplateService.delete(tenant.branchId ?? "", area);
    }
}
