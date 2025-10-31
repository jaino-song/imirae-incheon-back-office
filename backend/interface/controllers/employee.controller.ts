import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { EmployeeService } from "application/services/employee.service";
import {
    ChangeEmployeeOpenStatusDto,
    CreateEmployeeDto,
    EmployeesByRegisteredRangeDto,
    UpdateEmployeeDto,
} from "interface/dto/employee.dto";

@Controller("employees")
export class EmployeeController {
    constructor(private readonly employeeService: EmployeeService) {}

    @Post()
    create(@Body() dto: CreateEmployeeDto) {
        return this.employeeService.create(dto);
    }

    @Get()
    findAll() {
        return this.employeeService.findAll();
    }

    @Get(":id")
    findById(@Param("id") id: string) {
        return this.employeeService.findById(Number(id));
    }

    @Patch(":id")
    update(@Param("id") id: string, @Body() dto: UpdateEmployeeDto) {
        return this.employeeService.update(Number(id), dto);
    }

    @Delete(":id")
    delete(@Param("id") id: string) {
        return this.employeeService.delete(Number(id));
    }

    @Get("work-area/:workArea")
    findByWorkArea(@Param("workArea") workArea: string) {
        return this.employeeService.findByWorkArea(workArea);
    }

    @Get("grade/:grade")
    findByGrade(@Param("grade") grade: string) {
        return this.employeeService.findByGrade(grade);
    }

    @Get("open-status")
    findByOpenStatus(@Query("openToNextWork") openToNextWork?: string) {
        const flag = openToNextWork === undefined ? true : openToNextWork === "true";
        return this.employeeService.findByOpenStatus(flag);
    }

    @Get("registered-date/:date")
    findByRegisteredDate(@Param("date") date: string) {
        return this.employeeService.findByRegisteredDate(new Date(date));
    }

    @Get("registered-range")
    findByRegisteredDateRange(@Query() query: EmployeesByRegisteredRangeDto) {
        return this.employeeService.findByRegisteredDateRange(new Date(query.startDate), new Date(query.endDate));
    }

    @Patch(":id/open-status")
    changeOpenStatus(@Param("id") id: string, @Body() dto: ChangeEmployeeOpenStatusDto) {
        return this.employeeService.changeOpenStatus(Number(id), dto.openToNextWork);
    }

    @Get("open-to-next-work")
    findAllOpenToNextWork() {
        return this.employeeService.findAllOpenToNextWork();
    }
}

