import { Body, Controller, Delete, Get, Query, Patch, Post, UseGuards } from "@nestjs/common";
import { EmployeeScheduleService } from "application/services/employee-schedule.service";
import { CreateEmployeeScheduleDto, UpdateEmployeeScheduleDto } from "interface/dto/employee-schedule.dto";
import { CurrentTenant, TenantGuard } from "infrastructure/tenant";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { OwnerOrAdminGuard } from "infrastructure/auth/owner-or-admin.guard";
import { parseInteger } from "interface/parse-integer";

@Controller("employee-schedules")
@UseGuards(JwtGuard, TenantGuard)
export class EmployeeScheduleController {
    constructor(private readonly employeeScheduleService: EmployeeScheduleService) {}

    @Post()
    @UseGuards(OwnerOrAdminGuard)
    create(@CurrentTenant() tenant: { branchId?: string }, @Body() dto: CreateEmployeeScheduleDto) {
        return this.employeeScheduleService.create(tenant.branchId ?? "", {
            clientId: dto.clientId,
            primaryEmployeeId: dto.primaryEmployeeId,
            secondaryEmployeeId: dto.secondaryEmployeeId ?? null,
            workAddress: dto.workAddress,
            startDate: dto.startDate,
            endDate: dto.endDate,
            replaced: dto.replaced,
        });
    }

    @Get()
    findAll(@CurrentTenant() tenant: { branchId?: string }) {
        return this.employeeScheduleService.findAll(tenant.branchId ?? "");
    }

    @Get("primary-employee")
    findByPrimaryEmployee(
        @CurrentTenant() tenant: { branchId?: string },
        @Query("primaryEmployeeId") primaryEmployeeId: string
    ) {
        return this.employeeScheduleService.findByPrimaryEmployeeId(
            tenant.branchId ?? "",
            parseInteger(primaryEmployeeId, "primaryEmployeeId", { min: 1 })
        );
    }

    @Get("secondary-employee")
    findBySecondaryEmployee(
        @CurrentTenant() tenant: { branchId?: string },
        @Query("secondaryEmployeeId") secondaryEmployeeId: string
    ) {
        return this.employeeScheduleService.findBySecondaryEmployeeId(
            tenant.branchId ?? "",
            parseInteger(secondaryEmployeeId, "secondaryEmployeeId", { min: 1 })
        );
    }

    @Get("id")
    findById(@CurrentTenant() tenant: { branchId?: string }, @Query("id") id: string) {
        return this.employeeScheduleService.findById(tenant.branchId ?? "", parseInteger(id, "id", { min: 1 }));
    }

    @Patch()
    @UseGuards(OwnerOrAdminGuard)
    update(
        @CurrentTenant() tenant: { branchId?: string },
        @Query("id") id: string,
        @Body() dto: UpdateEmployeeScheduleDto
    ) {
        return this.employeeScheduleService.update(tenant.branchId ?? "", parseInteger(id, "id", { min: 1 }), {
            workAddress: dto.workAddress,
            startDate: dto.startDate,
            endDate: dto.endDate,
            replaced: dto.replaced,
        });
    }

    @Delete()
    @UseGuards(OwnerOrAdminGuard)
    delete(@CurrentTenant() tenant: { branchId?: string }, @Query("id") id: string) {
        return this.employeeScheduleService.delete(tenant.branchId ?? "", parseInteger(id, "id", { min: 1 }));
    }
}
