const COMPACT_DATE_PATTERN = /^\d{6}$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const CLIENT_REGISTRATION_ERROR_MESSAGES = {
    birthday: "생년월일은 유효한 YYMMDD 6자리여야 합니다.",
    dueDate: "출산 예정일은 유효한 날짜여야 합니다.",
    phone: "연락처는 11자리 휴대폰 번호여야 합니다.",
} as const;

export function isStrictIsoDate(value: string): boolean {
    if (!ISO_DATE_PATTERN.test(value)) return false;

    const date = new Date(`${value}T00:00:00`);
    return (
        !Number.isNaN(date.getTime())
        && date.getFullYear() === Number(value.slice(0, 4))
        && date.getMonth() + 1 === Number(value.slice(5, 7))
        && date.getDate() === Number(value.slice(8, 10))
    );
}

export function isValidClientBirthdayInput(value: string): boolean {
    if (!COMPACT_DATE_PATTERN.test(value)) return false;

    const year = 2000 + Number(value.slice(0, 2));
    const month = Number(value.slice(2, 4));
    const day = Number(value.slice(4, 6));
    const date = new Date(Date.UTC(year, month - 1, day));

    return (
        date.getUTCFullYear() === year
        && date.getUTCMonth() + 1 === month
        && date.getUTCDate() === day
    );
}
