import fs from "node:fs";

const source = fs.readFileSync(require.resolve("./VersionHistory"), "utf8");

describe("mobile VersionHistory mutation lifecycle", () => {
  it("locks and retains the approval dialog while applying a version", () => {
    expect(source).toContain(
      "const isApplying = rollbackMutation.isPending || resetMutation.isPending",
    );
    expect(source).toContain("if (!open && !isApplying)");
    expect(source.match(/disabled=\{isApplying\}/g)).toHaveLength(2);
  });
});
