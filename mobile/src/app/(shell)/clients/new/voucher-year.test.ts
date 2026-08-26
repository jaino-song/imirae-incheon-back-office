import { resolveVoucherLookupYear } from "./voucher-year";

describe("resolveVoucherLookupYear", () => {
  it("uses the current year at a calendar-year rollover when no service date is set", () => {
    expect(resolveVoucherLookupYear("", [2026, 2027], 2027)).toBe(2027);
  });

  it("preserves a historical service year after the calendar rolls forward", () => {
    expect(resolveVoucherLookupYear("2026-12-31", [2026, 2027], 2027)).toBe(2026);
  });

  it("uses the newest available year when the service date is missing and current year is unavailable", () => {
    expect(resolveVoucherLookupYear(undefined, [2025, 2026], 2027)).toBe(2026);
  });

  it("keeps a valid service year while the years query is still empty", () => {
    expect(resolveVoucherLookupYear("2026-01-03", [], 2027)).toBe(2026);
  });

  it("does not infer a policy year from an invalid service date", () => {
    expect(resolveVoucherLookupYear("2026-02-30", [2025, 2026], 2027)).toBe(2026);
  });

  it.each([
    ["service year is available", "2026-01-03", [2025, 2026], 2027, 2026],
    ["service year is unavailable but current year is available", "2024-01-03", [2026, 2027], 2027, 2027],
    ["neither service nor current year is available", "2024-01-03", [2025, 2026], 2027, 2026],
    ["no date and current year is available", undefined, [2026, 2027], 2027, 2027],
  ])("matches the desktop fallback order when %s", (_caseName, endDate, years, currentYear, expected) => {
    expect(resolveVoucherLookupYear(endDate, years, currentYear)).toBe(expected);
  });
});
