import { BadRequestException } from "@nestjs/common";

export type EmployeeAssignmentCandidate = {
    id: number;
    branchId: string | null;
    deletedAt: Date | null;
    openToNextWork: boolean;
};

const INVALID_EMPLOYEE_ASSIGNMENT_MESSAGE =
    "선택한 제공인력이 해당 지점 소속이 아니거나 배정 가능한 상태가 아닙니다.";
const EMPTY_RETAINED_EMPLOYEE_IDS: ReadonlySet<number> = new Set();

/**
 * Validate role structure before reading or mutating persistence state.
 * A secondary employee is meaningful only alongside a primary employee, and
 * one employee cannot occupy both roles in a new assignment.
 */
export function assertEmployeeAssignmentShape(
    primaryEmployeeId: number | null,
    secondaryEmployeeId: number | null,
): void {
    if (primaryEmployeeId === null) {
        if (secondaryEmployeeId !== null) {
            throw new BadRequestException("보조 담당 인력을 선택하려면 주 담당 인력이 먼저 필요합니다.");
        }
        return;
    }

    if (primaryEmployeeId === secondaryEmployeeId) {
        throw new BadRequestException("주담당과 부담당은 같은 직원일 수 없습니다.");
    }
}

/**
 * The canonical persisted employee predicate for an assignment write.
 * New assignees must be open to next work; retained assignees may remain
 * unavailable while branch and soft-delete checks still apply.
 */
export function isEmployeeAssignmentEligible(
    employee: EmployeeAssignmentCandidate,
    branchId: string,
    retainedEmployeeIds: ReadonlySet<number> = EMPTY_RETAINED_EMPLOYEE_IDS,
): boolean {
    return employee.branchId === branchId
        && employee.deletedAt === null
        && (employee.openToNextWork === true || retainedEmployeeIds.has(employee.id));
}

/**
 * Refuse unless every requested employee is present and satisfies the branch,
 * soft-delete, and new-versus-retained availability policy.
 */
export function assertEmployeeAssignmentEligibility(
    branchId: string,
    primaryEmployeeId: number | null,
    secondaryEmployeeId: number | null,
    employees: readonly EmployeeAssignmentCandidate[],
    retainedEmployeeIds: ReadonlySet<number> = EMPTY_RETAINED_EMPLOYEE_IDS,
): void {
    assertEmployeeAssignmentShape(primaryEmployeeId, secondaryEmployeeId);
    if (primaryEmployeeId === null) return;

    const byId = new Map(employees.map((employee) => [employee.id, employee]));
    const employeeIds = [primaryEmployeeId, secondaryEmployeeId]
        .filter((employeeId): employeeId is number => employeeId !== null);
    if (employeeIds.some((employeeId) => {
        const employee = byId.get(employeeId);
        return employee === undefined || !isEmployeeAssignmentEligible(employee, branchId, retainedEmployeeIds);
    })) {
        throw new BadRequestException(INVALID_EMPLOYEE_ASSIGNMENT_MESSAGE);
    }
}
