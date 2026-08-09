import {
  formatIsoDateInput,
  isStrictIsoDate,
  isoToYymmdd,
  normalizeIsoDate,
  toIsoDate,
  todayIsoDate,
  yymmddToIso,
} from "../date-input";

describe("contract date input helpers", () => {
  it("converts valid YYMMDD input to ISO dates", () => {
    expect(yymmddToIso("260603")).toBe("2026-06-03");
    expect(yymmddToIso("240229")).toBe("2024-02-29");
  });

  it("rejects impossible YYMMDD calendar dates", () => {
    expect(yymmddToIso("260230")).toBe("");
    expect(yymmddToIso("260431")).toBe("");
    expect(yymmddToIso("230229")).toBe("");
  });

  it("validates exact ISO calendar dates", () => {
    expect(isStrictIsoDate("2026-06-03")).toBe(true);
    expect(isStrictIsoDate("2026-02-30")).toBe(false);
    expect(isStrictIsoDate("2026-04-31")).toBe(false);
    expect(isStrictIsoDate("2026-06-03T00:00:00.000Z")).toBe(false);
  });

  it("normalizes valid ISO datetime prefixes and rejects invalid prefixes", () => {
    expect(normalizeIsoDate("2026-06-03T00:00:00.000Z")).toBe("2026-06-03");
    expect(normalizeIsoDate("2026-02-30T00:00:00.000Z")).toBe("");
  });

  it("converts normalized ISO values back to YYMMDD display input", () => {
    expect(isoToYymmdd("2026-06-03T00:00:00.000Z")).toBe("260603");
    expect(isoToYymmdd("2026-02-30T00:00:00.000Z")).toBe("");
  });

  it("formats today's local calendar date as ISO", () => {
    expect(todayIsoDate(new Date(2026, 5, 4))).toBe("2026-06-04");
  });

  describe("toIsoDate", () => {
    // The client wizard stores ISO, but its prefill sources — a contract
    // document, an eformsign edit — still hand over six digits. Taking those
    // verbatim puts "260611" in a YYYY-MM-DD field, and the submit path drops
    // anything that is not ISO to null, so the date vanishes without a word.
    it("lifts a six-digit date to ISO", () => {
      expect(toIsoDate("260611")).toBe("2026-06-11");
    });

    it("passes an ISO date through untouched", () => {
      expect(toIsoDate("2026-06-11")).toBe("2026-06-11");
    });

    it("returns empty for anything it cannot read", () => {
      expect(toIsoDate("2026-06")).toBe("");
      expect(toIsoDate("20260611")).toBe("");
      expect(toIsoDate("")).toBe("");
      expect(toIsoDate(null)).toBe("");
      expect(toIsoDate(undefined)).toBe("");
    });

    it("rejects a six-digit run that is not a real date", () => {
      expect(toIsoDate("261301")).toBe("");
      expect(toIsoDate("250229")).toBe("");
    });
  });

  describe("formatIsoDateInput", () => {
    it("inserts the dashes as the digits arrive", () => {
      expect(formatIsoDateInput("2026")).toBe("2026");
      expect(formatIsoDateInput("202612")).toBe("2026-12");
      expect(formatIsoDateInput("20261231")).toBe("2026-12-31");
    });

    it("ignores punctuation already present and caps at eight digits", () => {
      expect(formatIsoDateInput("2026-12-31")).toBe("2026-12-31");
      expect(formatIsoDateInput("2026123199")).toBe("2026-12-31");
    });
  });
});
