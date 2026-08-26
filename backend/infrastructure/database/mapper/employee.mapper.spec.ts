import { EmployeeEntity } from "domain/entities/employee.entity";

import { EmployeeMapper } from "./employee.mapper";

const employeeRow = {
    id: 42,
    name: "레거시 직원",
    workArea: ["서울"],
    phone: "010-1234-5678",
    grade: "베스트",
    openToNextWork: true,
    companyRegisteredDate: null,
    birthday: null,
    deletedAt: null,
};

describe("EmployeeMapper", () => {
    it("preserves a null companyRegisteredDate without read-time substitution", () => {
        const firstRead = EmployeeMapper.toDomain(employeeRow);
        const secondRead = EmployeeMapper.toDomain(employeeRow);

        expect(firstRead.registeredDate).toBeNull();
        expect(secondRead.registeredDate).toBeNull();
    });

    it("round-trips an explicit companyRegisteredDate", () => {
        const registeredDate = new Date("2024-01-15T00:00:00.000Z");

        const employee = EmployeeMapper.toDomain({
            ...employeeRow,
            companyRegisteredDate: registeredDate,
        });

        expect(employee.registeredDate).toBe(registeredDate);
        expect(EmployeeMapper.toPrismaCreate(employee)).toEqual(
            expect.objectContaining({ companyRegisteredDate: registeredDate }),
        );
    });

    it("maps an omitted registeredDate to a nullable create value", () => {
        const employee = EmployeeEntity.create(
            "신규 직원",
            ["서울"],
            "010-9999-8888",
            "스탠다드",
            false,
        );

        expect(employee.registeredDate).toBeNull();
        expect(EmployeeMapper.toPrismaCreate(employee)).toEqual(
            expect.objectContaining({ companyRegisteredDate: null }),
        );
    });
});
