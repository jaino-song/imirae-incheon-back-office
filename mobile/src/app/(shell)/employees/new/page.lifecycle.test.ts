import fs from "node:fs";

const source = fs.readFileSync(require.resolve("./page"), "utf8");

describe("mobile employee form navigation lifecycle", () => {
  it("locks both header exits while creating or navigating", () => {
    expect(source).toContain("const isBusy = createEmployee.isPending || isNavigationPending");
    expect(source).toContain("if (isBusy) return");
    expect(source.match(/disabled=\{isBusy\}/g)).toHaveLength(2);
  });
});
