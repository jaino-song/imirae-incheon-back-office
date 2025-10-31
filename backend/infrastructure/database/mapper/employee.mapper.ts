import { EmployeeEntity } from "domain/entities/employee.entity";

type EmployeeRow = {
    id: number;
    name: string;
    work_area: string;
    phone: string;
    grade: string;
    open_to_next_work: boolean;
    registered_date: Date;
};

export class EmployeeMapper {
    static toDomain(row: EmployeeRow): EmployeeEntity {
        return new EmployeeEntity(
            row.id,
            row.name,
            row.work_area,
            row.phone,
            row.grade,
            row.open_to_next_work,
            row.registered_date,
        );
    }

    static toPrismaCreate(entity: EmployeeEntity) {
        return {
            name: entity.name,
            work_area: entity.workArea,
            phone: entity.phone,
            grade: entity.grade,
            open_to_next_work: entity.openToNextWork,
            registered_date: entity.registeredDate,
        };
    }

    static toPrismaUpdate(entity: EmployeeEntity) {
        return {
            name: entity.name,
            work_area: entity.workArea,
            phone: entity.phone,
            grade: entity.grade,
            open_to_next_work: entity.openToNextWork,
        };
    }
}


