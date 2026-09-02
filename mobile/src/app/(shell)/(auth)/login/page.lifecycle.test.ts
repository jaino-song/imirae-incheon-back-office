import fs from "node:fs";

const source = fs.readFileSync(require.resolve("./page"), "utf8");

describe("mobile login authority boundary", () => {
  it("resets browser authority state before accepting a replacement identity", () => {
    const resetIndex = source.indexOf("await resetAuthorityState();");
    const loginIndex = source.indexOf("const response = await loginWithEmail");

    expect(source).toContain('import { resetAuthorityState } from "@/lib/auth/authority-state"');
    expect(resetIndex).toBeGreaterThanOrEqual(0);
    expect(loginIndex).toBeGreaterThan(resetIndex);
  });
});
