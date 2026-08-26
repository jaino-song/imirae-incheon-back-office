import { EMPLOYEE_STATUS_LABELS } from "@babyjamjam/shared/constants/employee-status";
import { parseDateForDisplay } from "@babyjamjam/shared/utils/date";

import type { Employee, EmployeeStatus } from "@/hooks/useEmployees";

interface EmployeeGroupBase {
  title: string;
  badge: string;
  badgeTone: "orange" | "green" | "muted";
  badgeMini: "orange" | "green" | "muted";
}

interface KnownEmployeeGroup extends EmployeeGroupBase {
  key: EmployeeStatus;
}

interface UnknownEmployeeGroup extends EmployeeGroupBase {
  key: "unknown";
}

export type EmployeeGroup = KnownEmployeeGroup | UnknownEmployeeGroup;

export const GROUPS: KnownEmployeeGroup[] = [
  { key: "available", title: EMPLOYEE_STATUS_LABELS.available, badge: EMPLOYEE_STATUS_LABELS.available, badgeTone: "orange", badgeMini: "orange" },
  { key: "working", title: EMPLOYEE_STATUS_LABELS.working, badge: EMPLOYEE_STATUS_LABELS.working, badgeTone: "green", badgeMini: "green" },
  { key: "unavailable", title: EMPLOYEE_STATUS_LABELS.unavailable, badge: EMPLOYEE_STATUS_LABELS.unavailable, badgeTone: "muted", badgeMini: "muted" },
];

const UNKNOWN_EMPLOYEE_GROUP: EmployeeGroup = {
  key: "unknown",
  title: "상태 미정",
  badge: "상태 미정",
  badgeTone: "muted",
  badgeMini: "muted",
};

// "최근 활동순" 정렬 키 — employees는 활동 timestamp가 없어 등록일(registeredDate) 기준, 동률은 최신 id.
// Unknown dates are kept as a separate, deterministic last group; they must not
// be represented as the Unix epoch because that would turn missing data into a
// fabricated chronology.
function employeeRecency(e: Employee): number | null {
  return parseDateForDisplay(e.registeredDate)?.getTime() ?? null;
}

export function buildAllEmployeeRowsForList(employees: Employee[]): Employee[] {
  return [...employees].sort((a, b) => {
    const aRecency = employeeRecency(a);
    const bRecency = employeeRecency(b);

    if (aRecency === null || bRecency === null) {
      if (aRecency === null && bRecency === null) return b.id - a.id;
      return aRecency === null ? 1 : -1;
    }

    return bRecency - aRecency || b.id - a.id;
  });
}

export function groupForEmployee(e: Employee): EmployeeGroup {
  return GROUPS.find((g) => g.key === e.status) ?? UNKNOWN_EMPLOYEE_GROUP;
}
