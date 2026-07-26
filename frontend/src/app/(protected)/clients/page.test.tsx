import fs from "node:fs";

const source = fs.readFileSync(require.resolve("./page"), "utf8");

describe("ClientsPage deletion conflicts", () => {
  it("should close the confirmation and show the backend conflict guidance", () => {
    const handler = source.slice(
      source.indexOf("const handleDeleteConfirm"),
      source.indexOf("const clearSelectedClientScheduleChange"),
    );

    expect(handler).toContain("setDeleteTargetClientId(null)");
    expect(handler).toContain("getApiErrorMessage");
    expect(source).toContain('data-component="desktop_clients_modals_delete-error-notification"');
  });
});
