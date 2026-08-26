import { isStrictIsoDate } from "@/lib/contracts/date-input";

const ISO_DATE_PATTERN = /^(\d{4})-\d{2}-\d{2}$/;

/**
 * Resolve the voucher policy year using the same precedence as the desktop
 * client form: an effective service year, then the current year, then the
 * newest year the server exposes.
 */
export function resolveVoucherLookupYear(
  endDate: string | null | undefined,
  availableYears: readonly number[],
  currentYear: number = new Date().getFullYear(),
): number {
  const normalizedEndDate = endDate?.trim() ?? "";
  const endDateYear = isStrictIsoDate(normalizedEndDate)
    ? Number(ISO_DATE_PATTERN.exec(normalizedEndDate)?.[1])
    : Number.NaN;
  if (Number.isFinite(endDateYear) && (availableYears.length === 0 || availableYears.includes(endDateYear))) {
    return endDateYear;
  }

  if (availableYears.length === 0 || availableYears.includes(currentYear)) {
    return currentYear;
  }

  return Math.max(...availableYears);
}
