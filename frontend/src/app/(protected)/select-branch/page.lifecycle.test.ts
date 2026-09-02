import fs from "node:fs";

const source = fs.readFileSync(require.resolve("./page"), "utf8");

describe("frontend select-branch navigation lifecycle", () => {
  it("keeps automatic branch selection loading until navigation takes over", () => {
    expect(source).toContain("Promise<boolean>");
    expect(source).toContain("let keepLoadingForNavigation = false");
    expect(source).toContain("keepLoadingForNavigation = await handleSelectBranch");
    expect(source).toContain("if (!keepLoadingForNavigation)");
  });

  it("resets authority state before changing the selected branch", () => {
    expect(source).toContain('import { resetAuthorityState } from "@/lib/auth/authority-state"');
    expect(source).toContain("await resetAuthorityState(queryClient)");
  });

  it("uses the shared server logout action instead of client cookie mutation", () => {
    expect(source).toContain('import { logout } from "@/app/logout/actions"');
    expect(source).toContain("const result = await logout(pushEndpoint)");
    expect(source).not.toContain(["document", "cookie"].join("."));
  });
});
