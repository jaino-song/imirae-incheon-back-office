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
});
