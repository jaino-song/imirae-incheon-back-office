const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const MIN_KST_YEAR = 1000;
const MAX_KST_YEAR = 9999;

const KST_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const KST_TIME_PATTERN = /^(\d{2}):(\d{2})$/;

/**
 * Parse a wall-clock KST schedule without allowing JavaScript Date overflow.
 *
 * The round-trip check is intentional: Date accepts values such as 24:00 and
 * normalizes invalid calendar days into the following month, which is not a
 * valid user-selected schedule.
 */
export function parseKstSchedule(
    date: string | undefined,
    time: string | undefined,
): Date | null {
    const dateParts = typeof date === "string" ? KST_DATE_PATTERN.exec(date) : null;
    const timeParts = typeof time === "string" ? KST_TIME_PATTERN.exec(time) : null;
    if (!dateParts || !timeParts) return null;

    const year = Number(dateParts[1]);
    const month = Number(dateParts[2]);
    const day = Number(dateParts[3]);
    const hour = Number(timeParts[1]);
    const minute = Number(timeParts[2]);

    if (year < MIN_KST_YEAR || year > MAX_KST_YEAR) return null;
    const daysInMonth = month >= 1 && month <= 12
        ? new Date(Date.UTC(year, month, 0)).getUTCDate()
        : 0;
    if (day < 1 || day > daysInMonth || hour > 23 || minute > 59) return null;

    const scheduledAt = new Date(`${date}T${time}:00+09:00`);
    if (Number.isNaN(scheduledAt.getTime())) return null;

    const local = new Date(scheduledAt.getTime() + KST_OFFSET_MS);
    const isSameWallClock = local.getUTCFullYear() === year
        && local.getUTCMonth() + 1 === month
        && local.getUTCDate() === day
        && local.getUTCHours() === hour
        && local.getUTCMinutes() === minute;

    return isSameWallClock ? scheduledAt : null;
}
