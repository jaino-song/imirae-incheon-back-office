import { EmployeeEntity } from "domain/entities/employee.entity";
import { normalizeEmployeeGrade } from "domain/constants/employee-grade.constants";

type EmployeeRow = {
    id: number;
    name: string;
    workArea: string[];
    phone: string;
    grade: string;
    openToNextWork: boolean;
    companyRegisteredDate: Date | null;
    birthday: string | null;
    deletedAt?: Date | null;
    phoneNormalized?: string | null;
};

export class EmployeeMapper {
    static toDomain(row: EmployeeRow): EmployeeEntity {
        return new EmployeeEntity(
            row.id,
            row.name,
            row.workArea,
            row.phone,
            normalizeEmployeeGrade(row.grade),
            row.openToNextWork,
            row.companyRegisteredDate,
            row.birthday ?? undefined,
            row.deletedAt ?? undefined,
            row.phoneNormalized,
        );
    }

    static toPrismaCreate(entity: EmployeeEntity) {
        return {
            name: entity.name,
            workArea: entity.workArea,
            phone: entity.phone,
            phoneNormalized: entity.phoneNormalized,
            grade: normalizeEmployeeGrade(entity.grade),
            openToNextWork: entity.openToNextWork,
            companyRegisteredDate: entity.registeredDate,
            birthday: entity.birthday ?? null,
        };
    }

    static toPrismaUpdate(entity: EmployeeEntity) {
        return {
            name: entity.name,
            workArea: entity.workArea,
            phone: entity.phone,
            phoneNormalized: entity.phoneNormalized,
            grade: normalizeEmployeeGrade(entity.grade),
            openToNextWork: entity.openToNextWork,
            birthday: entity.birthday ?? null,
        };
    }
}
