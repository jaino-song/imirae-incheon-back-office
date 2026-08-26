import type { Employee } from "@/hooks/useEmployees";

import {
  buildAllEmployeeRowsForList,
  groupForEmployee,
} from "@/lib/employee/list-helpers";

function createEmployee(id: number, status: Employee["status"]): Employee {
  return {
    id,
    name: `Employee ${id}`,
    status,
    registeredDate: `2026-06-0${id}`,
  } as Employee;
}

function createEmployeeWithRegisteredDate(
  id: number,
  registeredDate: string | null,
): Employee {
  return {
    ...createEmployee(id, "available"),
    registeredDate,
  };
}

describe("buildAllEmployeeRowsForList", () => {
  it("keeps employees with unknown statuses visible in the all filter", () => {
    const rows = buildAllEmployeeRowsForList([
      createEmployee(1, "available"),
      createEmployee(2, "paused" as Employee["status"]),
    ]);

    expect(rows.map((employee) => employee.id)).toEqual([2, 1]);
  });

  it("sorts unknown registration dates after dated employees without epoch substitution", () => {
    const rows = buildAllEmployeeRowsForList([
      createEmployeeWithRegisteredDate(1, null),
      createEmployeeWithRegisteredDate(2, "1960-01-01"),
      createEmployeeWithRegisteredDate(3, null),
      createEmployeeWithRegisteredDate(4, "2026-06-01"),
    ]);

    expect(rows.map((employee) => employee.id)).toEqual([4, 2, 3, 1]);
    expect(rows.slice(2).every((employee) => employee.registeredDate === null)).toBe(true);
  });
});

describe("groupForEmployee", () => {
  it("does not label unknown statuses as available", () => {
    expect(groupForEmployee(createEmployee(1, "paused" as Employee["status"])).badge).toBe("상태 미정");
  });
});
