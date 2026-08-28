import fs from "node:fs";

const source = fs.readFileSync(require.resolve("./page"), "utf8");

describe("mobile logout navigation lifecycle", () => {
  it("waits for server logout before redirecting and surfaces a failed revocation", () => {
    const resultIndex = source.indexOf("const result = await logout(pushEndpoint)");
    const redirectIndex = source.indexOf('window.location.replace("/login")');

    expect(resultIndex).toBeGreaterThanOrEqual(0);
    expect(redirectIndex).toBeGreaterThan(resultIndex);
    expect(source).toContain("setError(result.error ||");
    expect(source).toContain("setTimeout(() => {");
  });
});
