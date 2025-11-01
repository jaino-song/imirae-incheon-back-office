import { EmployeeEntity } from "domain/entities/employee.entity";

type EmployeeRow = {
    id: number;
    name: string;
    work_area: string;
    phone: string;
    grade: string;
    open_to_next_work: boolean;
    company_registered_date: Date | null;
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
            row.company_registered_date ?? new Date(),
        );
    }

    static toPrismaCreate(entity: EmployeeEntity) {
        return {
            id: entity.id,
            name: entity.name,
            work_area: entity.workArea,
            phone: entity.phone,
            grade: entity.grade,
            open_to_next_work: entity.openToNextWork,
            company_registered_date: entity.registeredDate,
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


