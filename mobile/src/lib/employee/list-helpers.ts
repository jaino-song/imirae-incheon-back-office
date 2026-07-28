import { EMPLOYEE_STATUS_LABELS } from "@babyjamjam/shared/constants/employee-status";

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
function employeeRecency(e: Employee): number {
  const t = e.registeredDate ? new Date(e.registeredDate).getTime() : NaN;
  return Number.isFinite(t) ? t : 0;
}

export function buildAllEmployeeRowsForList(employees: Employee[]): Employee[] {
  return [...employees].sort((a, b) => employeeRecency(b) - employeeRecency(a) || b.id - a.id);
}

export function groupForEmployee(e: Employee): EmployeeGroup {
  return GROUPS.find((g) => g.key === e.status) ?? UNKNOWN_EMPLOYEE_GROUP;
}
