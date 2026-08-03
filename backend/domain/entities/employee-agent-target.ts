import { createHash } from "node:crypto";

import type { EmployeeEntity } from "./employee.entity";

/**
 * Stable approval target identity for employee mutations.
 *
 * Keep this list limited to fields that an employee action can change (plus
 * deletion state). The repository and capability provider both use this
 * helper so the value compared under the row lock is identical to the value
 * captured during proposal inspection.
 */
export function employeeAgentTargetVersion(employee: EmployeeEntity | null | undefined): string {
    if (!employee) return "missing";

    return createHash("sha256").update(JSON.stringify({
        id: employee.id,
        name: employee.name,
        workArea: employee.workArea,
        phone: employee.phone,
        grade: employee.grade,
        openToNextWork: employee.openToNextWork,
        birthday: employee.birthday ?? null,
        deletedAt: employee.deletedAt?.toISOString() ?? null,
    })).digest("hex");
}
