import fs from "node:fs";

const source = fs.readFileSync(require.resolve("./VoucherPriceTable"), "utf8");

describe("VoucherPriceTable filters", () => {
  it("clears every filter group from the 모두 해제 action", () => {
    expect(source).toContain("const clearAllFilters = useCallback");
    expect(source).toContain("clearCategories()");
    expect(source).toContain("clearSubtypes()");
    expect(source).toContain("clearGrades()");
    expect(source).toContain("clearDurations()");
    expect(source).toContain("onClick={clearAllFilters}");
  });
});
