import { formatDateForDisplay, formatDateTimeKo, parseDateForDisplay } from "./date";

describe("formatDateForDisplay", () => {
  it("formats date-only values with zero-padded dots and no timezone conversion", () => {
    expect(formatDateForDisplay("2026-7-4")).toBe("2026.07.04");
    expect(formatDateForDisplay("2026-07-14")).toBe("2026.07.14");
    expect(formatDateForDisplay("2026-07-16")).toBe("2026.07.16");
  });

  it("converts full timestamps into Asia/Seoul instead of matching them as date-only (P0-2)", () => {
    // 2026-07-16T15:30:00Z is 2026-07-17 00:30 KST. The old desktop regex
    // `/^(\d{4})-(\d{1,2})-(\d{1,2})(?:$|T)/` matched the "2026-07-16" prefix
    // of this string and returned "2026.07.16" with no timezone conversion —
    // one calendar day off.
    expect(formatDateForDisplay("2026-07-16T15:30:00Z")).toBe("2026.07.17");
    expect(formatDateForDisplay("2026-07-16T15:30:00.000Z")).toBe("2026.07.17");
  });

  it("preserves the calendar date from ISO timestamps that don't cross the KST day boundary", () => {
    expect(formatDateForDisplay("2026-07-14T00:00:00.000Z")).toBe("2026.07.14");
  });

  it("accepts epoch numbers and Date instances as absolute instants", () => {
    const epochMs = Date.parse("2026-07-16T15:30:00Z");
    expect(formatDateForDisplay(epochMs)).toBe("2026.07.17");
    expect(formatDateForDisplay(new Date("2026-07-16T15:30:00Z"))).toBe("2026.07.17");
  });

  it("returns the fallback for empty or invalid values", () => {
    expect(formatDateForDisplay(null)).toBe("-");
    expect(formatDateForDisplay(undefined)).toBe("-");
    expect(formatDateForDisplay("")).toBe("-");
    expect(formatDateForDisplay("invalid")).toBe("-");
  });

  it("supports a custom fallback", () => {
    expect(formatDateForDisplay(null, "N/A")).toBe("N/A");
  });
});

describe("formatDateTimeKo", () => {
  it("renders exact Seoul midnight as 00:00", () => {
    expect(formatDateTimeKo("2026-07-16T15:00:00Z")).toBe("2026.07.17 00:00");
  });

  it("renders the date and the time from the same Asia/Seoul conversion", () => {
    // 2026-07-16T15:30:00Z is 2026-07-17 00:30 KST — the date and the time
    // must agree on the same (post-midnight) calendar day.
    expect(formatDateTimeKo("2026-07-16T15:30:00Z")).toBe("2026.07.17 00:30");
  });

  it("does not mix a UTC date with a KST time across the midnight boundary", () => {
    // A minute before local midnight in Seoul (2026-07-16 23:59 KST).
    expect(formatDateTimeKo("2026-07-16T14:59:00Z")).toBe("2026.07.16 23:59");
    // A minute after local midnight in Seoul (2026-07-17 00:01 KST) — the
    // date must roll over together with the time, never independently.
    expect(formatDateTimeKo("2026-07-16T15:01:00Z")).toBe("2026.07.17 00:01");
  });

  it("formats midday timestamps consistently", () => {
    expect(formatDateTimeKo("2026-07-14T03:15:00Z")).toBe("2026.07.14 12:15");
  });

  it("normalizes ICU's alternate 24-hour midnight representation", () => {
    const formatToParts = jest
      .spyOn(Intl.DateTimeFormat.prototype, "formatToParts")
      .mockImplementation(() => [
        { type: "month", value: "07" },
        { type: "literal", value: "/" },
        { type: "day", value: "17" },
        { type: "literal", value: "/" },
        { type: "year", value: "2026" },
        { type: "literal", value: ", " },
        { type: "hour", value: "24" },
        { type: "literal", value: ":" },
        { type: "minute", value: "30" },
      ]);

    try {
      expect(formatDateTimeKo("2026-07-16T15:30:00Z")).toBe("2026.07.17 00:30");
    } finally {
      formatToParts.mockRestore();
    }
  });

  it("returns the fallback for empty or invalid values", () => {
    expect(formatDateTimeKo(null)).toBe("-");
    expect(formatDateTimeKo("invalid")).toBe("-");
  });
});

describe("parseDateForDisplay", () => {
  it("parses a pure date-only string as UTC midnight of that calendar date", () => {
    const date = parseDateForDisplay("2026-07-16");
    expect(date).not.toBeNull();
    expect(date?.toISOString()).toBe("2026-07-16T00:00:00.000Z");
  });

  it("round-trips a date-only value through formatDateForDisplay without drifting", () => {
    const date = parseDateForDisplay("2026-07-16");
    expect(formatDateForDisplay(date?.toISOString() ?? null)).toBe("2026.07.16");
  });

  it("parses a full timestamp as an absolute instant", () => {
    const date = parseDateForDisplay("2026-07-16T15:30:00Z");
    expect(date?.toISOString()).toBe("2026-07-16T15:30:00.000Z");
  });

  it("returns null for empty or invalid values", () => {
    expect(parseDateForDisplay(null)).toBeNull();
    expect(parseDateForDisplay(undefined)).toBeNull();
    expect(parseDateForDisplay("")).toBeNull();
    expect(parseDateForDisplay("invalid")).toBeNull();
  });
});
