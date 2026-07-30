import fs from "node:fs";

const source = fs.readFileSync(require.resolve("./page"), "utf8");

describe("mobile select-branch navigation lifecycle", () => {
  it("keeps automatic branch selection loading until navigation takes over", () => {
    expect(source).toContain("Promise<boolean>");
    expect(source).toContain("let keepLoadingForNavigation = false");
    expect(source).toContain("keepLoadingForNavigation = await confirmSelectBranch");
    expect(source).toContain("if (!keepLoadingForNavigation)");
  });

  it("locks logout against an in-flight branch selection", () => {
    expect(source).toContain("const [loggingOut, setLoggingOut] = useState(false)");
    expect(source).toContain("const isPageBusy = submitting || loggingOut");
    expect(source).toContain("if (isPageBusy) return");
    expect(source).toContain('disabled={isPageBusy}');
  });
});
