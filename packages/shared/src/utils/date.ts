const KST_TIME_ZONE = "Asia/Seoul";

// Fully anchored date-only pattern: `YYYY-M-DD` or `YYYY-MM-DD` and nothing
// else in the string. This is the fix for the desktop bug in
// frontend/src/lib/date/format-date-for-display.ts (and its mobile twin),
// where `/^(\d{4})-(\d{1,2})-(\d{1,2})(?:$|T)/` also matched full timestamps
// (e.g. "2026-07-16T15:30:00Z") because of the `(?:$|T)` alternation, and
// rendered them without any timezone conversion — a stored UTC instant of
// 00:30 KST on 2026-07-17 displayed as "2026.07.16", one calendar day off
// (P0-2). Anchoring the pattern with `$` right after the day group means a
// trailing "T..." no longer matches, so timestamps fall through to the KST
// conversion branch below instead.
const DATE_ONLY_PATTERN = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;

const KST_DATE_PARTS_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: KST_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const KST_DATETIME_PARTS_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: KST_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function partsToMap(parts: Intl.DateTimeFormatPart[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  return map;
}

/**
 * Formats a value for display as `YYYY.MM.DD`, Korea-Standard-Time-aware.
 *
 * - A pure date-only string (fully anchored `YYYY-M-DD` / `YYYY-MM-DD`, no
 *   time component) renders as-is, zero-padded, with NO timezone
 *   conversion: the caller already means an unambiguous calendar date, and
 *   converting it would be wrong (there is no instant to convert).
 * - Anything else (a full timestamp string, epoch number, or `Date`) is an
 *   absolute instant, so it is converted into Asia/Seoul before rendering.
 */
export function formatDateForDisplay(
  value: string | number | Date | null | undefined,
  fallback = "-",
): string {
  if (value === null || value === undefined || value === "") return fallback;

  if (typeof value === "string") {
    const match = value.trim().match(DATE_ONLY_PATTERN);
    if (match) {
      return `${match[1]}.${match[2].padStart(2, "0")}.${match[3].padStart(2, "0")}`;
    }
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;

  const parts = partsToMap(KST_DATE_PARTS_FORMATTER.formatToParts(date));
  return `${parts.year}.${parts.month}.${parts.day}`;
}

/**
 * Formats a value as `YYYY.MM.DD HH:mm`, with the date and the time both
 * computed from the SAME Asia/Seoul conversion.
 *
 * Fixes the desktop bug in ClientServiceRecordsTab.tsx (and its mobile
 * near-twin in client-service-records.tsx), where the date portion came
 * from a UTC/raw calendar date (no explicit timezone) while the time
 * portion came from either the server process's local clock
 * (`date.getHours()`) or an `Intl.DateTimeFormat` call with no `timeZone`
 * option — two different, implicit timezone assumptions combined into one
 * string, which can disagree across the UTC/KST midnight boundary. Here
 * both the date and the time come from one `Intl.DateTimeFormat` call
 * pinned to `Asia/Seoul`, so they can never drift apart.
 */
export function formatDateTimeKo(
  value: string | number | Date | null | undefined,
  fallback = "-",
): string {
  if (value === null || value === undefined || value === "") return fallback;

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;

  const parts = partsToMap(KST_DATETIME_PARTS_FORMATTER.formatToParts(date));
  // Keep the public contract at 00–23 even on ICU builds that expose 24 for midnight.
  const hour = parts.hour === "24" ? "00" : parts.hour;
  return `${parts.year}.${parts.month}.${parts.day} ${hour}:${parts.minute}`;
}

/**
 * Parses a value into a `Date` instant, honoring the same date-only vs.
 * timestamp distinction as `formatDateForDisplay`. A pure date-only string
 * is parsed as UTC midnight of that calendar date (so it round-trips
 * through `formatDateForDisplay` without drifting to an adjacent day);
 * anything else is parsed as an absolute instant via the native `Date`
 * constructor.
 */
export function parseDateForDisplay(
  value: string | number | Date | null | undefined,
): Date | null {
  if (value === null || value === undefined || value === "") return null;

  if (typeof value === "string") {
    const match = value.trim().match(DATE_ONLY_PATTERN);
    if (match) {
      const year = Number(match[1]);
      const month = Number(match[2]);
      const day = Number(match[3]);
      const date = new Date(Date.UTC(year, month - 1, day));
      return Number.isNaN(date.getTime()) ? null : date;
    }
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
