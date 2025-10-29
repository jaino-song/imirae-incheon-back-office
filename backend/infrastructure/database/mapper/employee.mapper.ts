import { EmployeeEntity } from "domain/entities/employee.entity";

type EmployeeRow = {
    id: number;
    name: string;
    workArea: string;
    phone: string;
    grade: string;
    openToNextWork: boolean;
    registeredDate: Date;
};

export class EmployeeMapper {
    static toDomain(row: EmployeeRow): EmployeeEntity {
        return new EmployeeEntity(
            row.id,
            row.name,
            row.workArea,
            row.phone,
            row.grade,
            row.openToNextWork,
            row.registeredDate,
        );
    }

    static toPrismaCreate(entity: EmployeeEntity) {
        return {
            name: entity.name,
            workArea: entity.workArea,
            phone: entity.phone,
            grade: entity.grade,
            openToNextWork: entity.openToNextWork,
            registeredDate: entity.registeredDate,
        };
    }

    static toPrismaUpdate(entity: EmployeeEntity) {
        return {
            name: entity.name,
            workArea: entity.workArea,
            phone: entity.phone,
            grade: entity.grade,
            openToNextWork: entity.openToNextWork,
        };
    }
}


