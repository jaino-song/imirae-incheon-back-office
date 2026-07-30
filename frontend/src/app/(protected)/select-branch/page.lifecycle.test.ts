import fs from "node:fs";

const source = fs.readFileSync(require.resolve("./page"), "utf8");

describe("frontend select-branch navigation lifecycle", () => {
  it("keeps automatic branch selection loading until navigation takes over", () => {
    expect(source).toContain("Promise<boolean>");
    expect(source).toContain("let keepLoadingForNavigation = false");
    expect(source).toContain("keepLoadingForNavigation = await handleSelectBranch");
    expect(source).toContain("if (!keepLoadingForNavigation)");
  });
});
