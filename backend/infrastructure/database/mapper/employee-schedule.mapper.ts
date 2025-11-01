import { EmployeeScheduleEntity } from "domain/entities/employee-schedule.entity";

type EmployeeScheduleRow = {
    id: number;
    employee_id: number;
    work_address: string;
    start_date: Date;
    end_date: Date;
    replaced: boolean;
};

export class EmployeeScheduleMapper {
    static toDomain(row: EmployeeScheduleRow): EmployeeScheduleEntity {
        return new EmployeeScheduleEntity(
            row.id,
            row.employee_id,
            row.work_address,
            row.start_date,
            row.end_date,
            row.replaced,
        );
    }

    static toPrismaCreate(entity: EmployeeScheduleEntity) {
        return {
            employee_id: entity.employeeId,
            work_address: entity.workAddress,
            start_date: entity.startDate,
            end_date: entity.endDate,
            replaced: entity.replaced,
        };
    }

    static toPrismaUpdate(entity: EmployeeScheduleEntity) {
        return {
            work_address: entity.workAddress,
            start_date: entity.startDate,
            end_date: entity.endDate,
            replaced: entity.replaced,
        };
    }
}
