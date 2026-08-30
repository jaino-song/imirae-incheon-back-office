import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { EmployeeService } from "application/services/employee.service";
import {
    ChangeEmployeeOpenStatusDto,
    CreateEmployeeDto,
    EmployeesByRegisteredDateDto,
    EmployeesByRegisteredRangeDto,
    UpdateEmployeeDto,
} from "interface/dto/employee.dto";
import { CurrentTenant, TenantGuard } from "infrastructure/tenant";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { OwnerOrAdminGuard } from "infrastructure/auth/owner-or-admin.guard";
import { parseBooleanQuery } from "interface/parse-boolean";
import { parseInteger } from "interface/parse-integer";

@Controller("employees")
@UseGuards(JwtGuard, TenantGuard)
export class EmployeeController {
    constructor(private readonly employeeService: EmployeeService) {}

    @Post()
    @UseGuards(OwnerOrAdminGuard)
    create(@CurrentTenant() tenant: { branchId?: string }, @Body() dto: CreateEmployeeDto) {
        return this.employeeService.create(tenant.branchId ?? "", dto);
    }

    @Get()
    findAll(@CurrentTenant() tenant: { branchId?: string }) {
        return this.employeeService.findAll(tenant.branchId ?? "");
    }

    @Get("check-phone")
    async checkPhone(@CurrentTenant() tenant: { branchId?: string }, @Query("phone") phone?: string) {
        return { exists: await this.employeeService.checkPhoneExists(tenant.branchId ?? "", phone) };
    }

    @Get("work-area")
    findByWorkArea(
        @CurrentTenant() tenant: { branchId?: string },
        @Query("workArea") workArea: string
    ) {
        return this.employeeService.findByWorkArea(tenant.branchId ?? "", workArea);
    }

    @Get("grade")
    findByGrade(@CurrentTenant() tenant: { branchId?: string }, @Query("grade") grade: string) {
        return this.employeeService.findByGrade(tenant.branchId ?? "", grade);
    }

    @Get("open-status")
    findByOpenStatus(
        @CurrentTenant() tenant: { branchId?: string },
        @Query("openToNextWork") openToNextWork?: string
    ) {
        const flag = parseBooleanQuery(openToNextWork, "openToNextWork", true);
        return this.employeeService.findByOpenStatus(tenant.branchId ?? "", flag);
    }

    @Get("registered-date")
    findByRegisteredDate(
        @CurrentTenant() tenant: { branchId?: string },
        @Query() query: EmployeesByRegisteredDateDto
    ) {
        return this.employeeService.findByRegisteredDate(tenant.branchId ?? "", new Date(query.date));
    }

    @Get("registered-range")
    findByRegisteredDateRange(
        @CurrentTenant() tenant: { branchId?: string },
        @Query() query: EmployeesByRegisteredRangeDto
    ) {
        return this.employeeService.findByRegisteredDateRange(
            tenant.branchId ?? "",
            new Date(query.startDate),
            new Date(query.endDate)
        );
    }

    @Get("open-to-next-work")
    findAllOpenToNextWork(@CurrentTenant() tenant: { branchId?: string }) {
        return this.employeeService.findAllOpenToNextWork(tenant.branchId ?? "");
    }

    @Get("id")
    findById(@CurrentTenant() tenant: { branchId?: string }, @Query("id") id: string) {
        return this.employeeService.findById(tenant.branchId ?? "", parseInteger(id, "id", { min: 1 }));
    }

    @Get(":id/active-clients")
    listActiveClients(
        @CurrentTenant() tenant: { branchId?: string },
        @Param("id") id: string,
    ) {
        return this.employeeService.listActiveClients(
            tenant.branchId ?? "",
            parseInteger(id, "id", { min: 1 }),
        );
    }

    @Get(":id/work-history")
    listWorkHistory(
        @CurrentTenant() tenant: { branchId?: string },
        @Param("id") id: string,
        @Query("page") page?: string,
        @Query("limit") limit?: string,
    ) {
        return this.employeeService.listWorkHistory(
            tenant.branchId ?? "",
            parseInteger(id, "id", { min: 1 }),
            parseInteger(page, "page", { defaultValue: 1, min: 1 }),
            parseInteger(limit, "limit", { defaultValue: 20, min: 1, max: 100 }),
        );
    }

    @Patch("open-status")
    @UseGuards(OwnerOrAdminGuard)
    changeOpenStatus(
        @CurrentTenant() tenant: { branchId?: string },
        @Query("id") id: string,
        @Body() dto: ChangeEmployeeOpenStatusDto
    ) {
        return this.employeeService.changeOpenStatus(
            tenant.branchId ?? "",
            parseInteger(id, "id", { min: 1 }),
            dto.openToNextWork
        );
    }

    @Patch()
    @UseGuards(OwnerOrAdminGuard)
    update(
        @CurrentTenant() tenant: { branchId?: string },
        @Query("id") id: string,
        @Body() dto: UpdateEmployeeDto
    ) {
        return this.employeeService.update(tenant.branchId ?? "", parseInteger(id, "id", { min: 1 }), dto);
    }

    @Delete()
    @UseGuards(OwnerOrAdminGuard)
    delete(@CurrentTenant() tenant: { branchId?: string }, @Query("id") id: string) {
        return this.employeeService.delete(tenant.branchId ?? "", parseInteger(id, "id", { min: 1 }));
    }
}
