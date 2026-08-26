import { EmployeeEntity } from "domain/entities/employee.entity";

/**
 * EmployeeEntity를 생성하기 위한 테스트 팩토리
 */
export interface CreateEmployeeFactoryParams {
    id?: number;
    name?: string;
    workArea?: string[];
    phone?: string;
    grade?: string;
    openToNextWork?: boolean;
    registeredDate?: Date | null;
}

export class EmployeeFactory {
    /**
     * 기본값이 적용된 EmployeeEntity 생성
     */
    static create(params: CreateEmployeeFactoryParams = {}): EmployeeEntity {
        return EmployeeEntity.reconstitute(
            params.id ?? 1,
            params.name ?? "Test Employee",
            params.workArea ?? ["인천 연수구", "인천 남동구"],
            params.phone ?? "010-9876-5432",
            params.grade ?? "프리미엄",
            params.openToNextWork ?? true,
            params.registeredDate === undefined ? new Date("2023-01-15") : params.registeredDate,
        );
    }

    /**
     * 여러 EmployeeEntity 생성
     */
    static createMany(count: number, baseParams: CreateEmployeeFactoryParams = {}): EmployeeEntity[] {
        return Array.from({ length: count }, (_, index) =>
            EmployeeFactory.create({
                ...baseParams,
                id: baseParams.id ?? index + 1,
                name: baseParams.name ?? `Test Employee ${index + 1}`,
            })
        );
    }

    /**
     * 근무 가능한 직원 생성
     */
    static createAvailable(params: CreateEmployeeFactoryParams = {}): EmployeeEntity {
        return EmployeeFactory.create({
            ...params,
            openToNextWork: true,
        });
    }

    /**
     * 근무 불가능한 직원 생성
     */
    static createUnavailable(params: CreateEmployeeFactoryParams = {}): EmployeeEntity {
        return EmployeeFactory.create({
            ...params,
            openToNextWork: false,
        });
    }

    /**
     * 특정 지역 담당 직원 생성
     */
    static createForArea(area: string, params: CreateEmployeeFactoryParams = {}): EmployeeEntity {
        return EmployeeFactory.create({
            ...params,
            workArea: [area, ...(params.workArea ?? [])],
        });
    }
}
