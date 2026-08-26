import { BadRequestException } from "@nestjs/common";

export type EmployeeAssignmentCandidate = {
    id: number;
    branchId: string | null;
    deletedAt: Date | null;
    openToNextWork: boolean;
};

const INVALID_EMPLOYEE_ASSIGNMENT_MESSAGE =
    "selected employees must belong to the client branch and be open to next work";

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
            throw new BadRequestException("primary employee is required when a secondary employee is selected");
        }
        return;
    }

    if (primaryEmployeeId === secondaryEmployeeId) {
        throw new BadRequestException("주담당과 부담당은 같은 직원일 수 없습니다.");
    }
}

/**
 * The canonical persisted employee predicate for new assignments.
 * Historical schedules do not use this predicate when they are read.
 */
export function isEmployeeAssignmentEligible(
    employee: EmployeeAssignmentCandidate,
    branchId: string,
): boolean {
    return employee.branchId === branchId
        && employee.deletedAt === null
        && employee.openToNextWork === true;
}

/**
 * Refuse unless every requested employee is present and satisfies the same
 * branch, soft-delete, and availability policy.
 */
export function assertEmployeeAssignmentEligibility(
    branchId: string,
    primaryEmployeeId: number | null,
    secondaryEmployeeId: number | null,
    employees: readonly EmployeeAssignmentCandidate[],
): void {
    assertEmployeeAssignmentShape(primaryEmployeeId, secondaryEmployeeId);
    if (primaryEmployeeId === null) return;

    const byId = new Map(employees.map((employee) => [employee.id, employee]));
    const employeeIds = [primaryEmployeeId, secondaryEmployeeId]
        .filter((employeeId): employeeId is number => employeeId !== null);
    if (employeeIds.some((employeeId) => {
        const employee = byId.get(employeeId);
        return employee === undefined || !isEmployeeAssignmentEligible(employee, branchId);
    })) {
        throw new BadRequestException(INVALID_EMPLOYEE_ASSIGNMENT_MESSAGE);
    }
}
