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

describe("buildAllEmployeeRowsForList", () => {
  it("keeps employees with unknown statuses visible in the all filter", () => {
    const rows = buildAllEmployeeRowsForList([
      createEmployee(1, "available"),
      createEmployee(2, "paused" as Employee["status"]),
    ]);

    expect(rows.map((employee) => employee.id)).toEqual([2, 1]);
  });
});

describe("groupForEmployee", () => {
  it("does not label unknown statuses as available", () => {
    expect(groupForEmployee(createEmployee(1, "paused" as Employee["status"])).badge).toBe("상태 미정");
  });
});
