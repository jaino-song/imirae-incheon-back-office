import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import { EmployeeScheduleService } from "application/services/employee-schedule.service";
import { CreateEmployeeScheduleDto, UpdateEmployeeScheduleDto } from "interface/dto/employee-schedule.dto";

@Controller("employee-schedules")
export class EmployeeScheduleController {
    constructor(private readonly employeeScheduleService: EmployeeScheduleService) {}

    @Post()
    create(@Body() dto: CreateEmployeeScheduleDto) {
        return this.employeeScheduleService.create({
            employeeId: dto.employeeId,
            workAddress: dto.workAddress,
            startDate: dto.startDate,
            endDate: dto.endDate,
            replaced: dto.replaced,
        });
    }

    @Get()
    findAll() {
        return this.employeeScheduleService.findAll();
    }

    @Get("employee/:employeeId")
    findByEmployee(@Param("employeeId") employeeId: string) {
        return this.employeeScheduleService.findByEmployeeId(Number(employeeId));
    }

    @Get(":id")
    findById(@Param("id") id: string) {
        return this.employeeScheduleService.findById(Number(id));
    }

    @Patch(":id")
    update(@Param("id") id: string, @Body() dto: UpdateEmployeeScheduleDto) {
        return this.employeeScheduleService.update(Number(id), {
            workAddress: dto.workAddress,
            startDate: dto.startDate,
            endDate: dto.endDate,
            replaced: dto.replaced,
        });
    }

    @Delete(":id")
    delete(@Param("id") id: string) {
        return this.employeeScheduleService.delete(Number(id));
    }
}
