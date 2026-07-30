import fs from "node:fs";

const source = fs.readFileSync(require.resolve("./page"), "utf8");

describe("mobile client form navigation lifecycle", () => {
  it("locks both header exits while saving or navigating", () => {
    expect(source).toContain("if (isSaving) return");
    expect(source.match(/disabled=\{isSaving\}/g)).toHaveLength(2);
  });
});
