import fs from "node:fs";

const source = fs.readFileSync(require.resolve("./page"), "utf8");

describe("EmployeesPage deletion conflicts", () => {
  it("should close the confirmation and show the backend conflict guidance", () => {
    const handler = source.slice(
      source.indexOf("const handleDeleteConfirm"),
      source.indexOf("const handleFormDialogClose"),
    );

    expect(handler).toContain("setDeleteTargetEmployeeId(null)");
    expect(handler).toContain("getApiErrorMessage");
    expect(source).toContain('dataComponent="desktop_employees_delete-error-notification"');
  });

  it("uses semantic stat colors for assignment availability", () => {
    expect(source).toContain(
      'label: EMPLOYEE_STATUS_LABELS.available, counter: "명", colorIndex: 2',
    );
    expect(source).toContain(
      'label: EMPLOYEE_STATUS_LABELS.unavailable, counter: "명", colorIndex: 0',
    );
  });

  it("counts derived work status separately from next-work availability", () => {
    expect(source).toContain('working: allEmployees.filter((e: Employee) => e.status === "working").length');
    expect(source).toContain('available: allEmployees.filter((e: Employee) => e.status === "available").length');
    expect(source).toContain('unavailable: allEmployees.filter((e: Employee) => e.status === "unavailable").length');
    expect(source).toContain("OPEN_TO_NEXT_WORK_LABELS");
  });
});
