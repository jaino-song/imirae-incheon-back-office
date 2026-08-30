import fs from "node:fs";

const source = fs.readFileSync(require.resolve("./page"), "utf8");

describe("mobile client form navigation lifecycle", () => {
  it("locks both header exits while saving or navigating", () => {
    expect(source).toContain("if (isSaving) return");
    expect(source.match(/disabled=\{isSaving\}/g)).toHaveLength(2);
  });

  it("uses the resolved service policy year for voucher pricing", () => {
    expect(source).toContain("useVoucherYears");
    expect(source).toContain("resolveVoucherLookupYear");
    expect(source).toContain("useVoucherPriceInfos(");
    expect(source).toContain("resolvedVoucherYear");
    expect(source).toContain("voucher-year-field");
  });
});
