const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})/;
const EXACT_ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const YYMMDD_PATTERN = /^\d{6}$/;

function twoDigit(value: number): string {
  return String(value).padStart(2, "0");
}

export function isStrictIsoDate(value: string): boolean {
  if (!EXACT_ISO_DATE_PATTERN.test(value)) {
    return false;
  }

  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function normalizeIsoDate(value: string | null | undefined): string {
  if (!value) {
    return "";
  }

  const match = value.match(ISO_DATE_PATTERN);
  if (!match) {
    return "";
  }

  const isoDate = `${match[1]}-${match[2]}-${match[3]}`;
  return isStrictIsoDate(isoDate) ? isoDate : "";
}

/**
 * Types out to YYYY-MM-DD, inserting the dashes as the digits arrive, so a date
 * can be keyed straight in instead of going through the native picker. Shapes
 * the text only — use isStrictIsoDate to find out whether it is a real date.
 */
export function formatIsoDateInput(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 8);

  if (digits.length <= 4) {
    return digits;
  }
  if (digits.length <= 6) {
    return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  }

  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

export function yymmddToIso(value: string): string {
  const trimmed = value.trim();

  if (!YYMMDD_PATTERN.test(trimmed)) {
    return "";
  }

  return normalizeIsoDate(`20${trimmed.slice(0, 2)}-${trimmed.slice(2, 4)}-${trimmed.slice(4, 6)}`);
}

export function isoToYymmdd(value: string | null | undefined): string {
  const isoDate = normalizeIsoDate(value);

  if (!isoDate) {
    return "";
  }

  return `${isoDate.slice(2, 4)}${isoDate.slice(5, 7)}${isoDate.slice(8, 10)}`;
}

export function todayIsoDate(date = new Date()): string {
  return `${date.getFullYear()}-${twoDigit(date.getMonth() + 1)}-${twoDigit(date.getDate())}`;
}
