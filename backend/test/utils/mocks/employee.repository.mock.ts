import { EmployeeEntity } from "domain/entities/employee.entity";
import { IEmployeeRepository } from "domain/repositories/employee.repository.interface";
import type { Prisma } from "@prisma/client";
import { employeeAgentTargetVersion } from "domain/entities/employee-agent-target";

/**
 * 테스트용 Mock Employee Repository
 * In-memory 저장소로 동작하며, 테스트 간 독립성 보장
 */
export class MockEmployeeRepository implements IEmployeeRepository {
    private employees: Map<number, EmployeeEntity> = new Map();
    private nextId: number = 1;

    /**
     * 테스트 데이터 초기화
     */
    reset(): void {
        this.employees.clear();
        this.nextId = 1;
    }

    /**
     * 테스트 데이터 직접 설정
     */
    setData(employees: EmployeeEntity[]): void {
        this.employees.clear();
        employees.forEach(employee => {
            this.employees.set(employee.id, employee);
            if (employee.id >= this.nextId) {
                this.nextId = employee.id + 1;
            }
        });
    }

    /**
     * 저장된 모든 데이터 조회 (테스트 검증용)
     */
    getAllData(): EmployeeEntity[] {
        return Array.from(this.employees.values());
    }

    async findById(_branchid: string, id: number): Promise<EmployeeEntity | null> {
        return this.employees.get(id) ?? null;
    }

    async findByIdForUpdate(_branchid: string, id: number, _transaction: Prisma.TransactionClient): Promise<EmployeeEntity | null> {
        void _transaction;
        return this.employees.get(id) ?? null;
    }

    async findByPhone(_branchid: string, normalizedPhone: string): Promise<EmployeeEntity | null> {
        return Array.from(this.employees.values()).find(
            (employee) => employee.phoneNormalized === normalizedPhone,
        ) ?? null;
    }

    async findAll(): Promise<EmployeeEntity[]> {
        return Array.from(this.employees.values());
    }

    async create(_branchid: string, employee: EmployeeEntity): Promise<EmployeeEntity> {
        const id = employee.id > 0 ? employee.id : this.nextId++;
        const newEmployee = EmployeeEntity.reconstitute(
            id,
            employee.name,
            employee.workArea,
            employee.phone,
            employee.grade,
            employee.openToNextWork,
            employee.registeredDate,
            employee.birthday,
            employee.deletedAt,
            employee.phoneNormalized,
        );
        this.employees.set(id, newEmployee);
        return newEmployee;
    }

    async update(_branchid: string, employee: EmployeeEntity): Promise<EmployeeEntity> {
        if (!this.employees.has(employee.id)) {
            throw new Error(`Employee with id ${employee.id} not found`);
        }
        this.employees.set(employee.id, employee);
        return employee;
    }

    async updateIfTargetVersion(
        _branchid: string,
        id: number,
        expectedTargetVersion: string,
        updates: Partial<Pick<EmployeeEntity, "name" | "workArea" | "phone" | "grade" | "openToNextWork" | "birthday">>,
        _transaction?: Prisma.TransactionClient,
    ): Promise<EmployeeEntity | null> {
        void _transaction;
        const employee = this.employees.get(id);
        if (!employee || employee.deletedAt || employeeAgentTargetVersion(employee) !== expectedTargetVersion) return null;
        employee.updateProfile(updates.name, updates.workArea, updates.phone, updates.grade, updates.openToNextWork, updates.birthday);
        this.employees.set(id, employee);
        return employee;
    }

    async delete(_branchid: string, id: number): Promise<void> {
        if (!this.employees.has(id)) {
            throw new Error(`Employee with id ${id} not found`);
        }
        this.employees.delete(id);
    }

    async findByWorkArea(_branchid: string, workArea: string): Promise<EmployeeEntity[]> {
        return Array.from(this.employees.values()).filter(employee =>
            employee.workArea.includes(workArea),
        );
    }

    async findByGrade(_branchid: string, grade: string): Promise<EmployeeEntity[]> {
        return Array.from(this.employees.values()).filter(
            employee => employee.grade === grade,
        );
    }

    async findByOpenToNextWork(
        _branchid: string,
        openToNextWork: boolean
    ): Promise<EmployeeEntity[]> {
        return Array.from(this.employees.values()).filter(
            employee => employee.openToNextWork === openToNextWork,
        );
    }

    async findByRegisteredDate(_branchid: string, registeredDate: Date): Promise<EmployeeEntity[]> {
        return Array.from(this.employees.values()).filter(
            employee =>
                employee.registeredDate !== null &&
                employee.registeredDate.toDateString() === registeredDate.toDateString(),
        );
    }

    async findByRegisteredDateRange(
        _branchid: string,
        startDate: Date,
        endDate: Date,
    ): Promise<EmployeeEntity[]> {
        return Array.from(this.employees.values()).filter(
            employee =>
                employee.registeredDate !== null &&
                employee.registeredDate >= startDate &&
                employee.registeredDate <= endDate,
        );
    }

    async changeOpenToNextWork(
        _branchid: string,
        id: number,
        openToNextWork: boolean
    ): Promise<void> {
        const employee = this.employees.get(id);
        if (!employee) {
            throw new Error(`Employee with id ${id} not found`);
        }
        const updated = EmployeeEntity.reconstitute(
            employee.id,
            employee.name,
            employee.workArea,
            employee.phone,
            employee.grade,
            openToNextWork,
            employee.registeredDate,
        );
        this.employees.set(id, updated);
    }

    async findAllOpenToNextWork(): Promise<EmployeeEntity[]> {
        return Array.from(this.employees.values()).filter(
            employee => employee.openToNextWork === true,
        );
    }
}
