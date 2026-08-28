import type { CreateClientDto } from "@/lib/client/types";

const COMPACT_DATE_PATTERN = /^\d{6}$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const BIRTH_YEAR_PIVOT = 70;
const MOBILE_PHONE_DIGITS = 11;

export const CLIENT_REGISTRATION_ERROR_MESSAGES = {
    birthday: "생년월일은 유효한 YYMMDD 6자리여야 합니다.",
    dueDate: "출산 예정일은 유효한 날짜여야 합니다.",
    phone: "연락처는 11자리 휴대폰 번호여야 합니다.",
} as const;

export function parseCompactDateInput(value: string): string {
    return value.replace(/\D/g, "").slice(0, 6);
}

function compactToIso(value: string): string | null {
    if (!COMPACT_DATE_PATTERN.test(value)) return null;

    const yearPrefix = Number(value.slice(0, 2)) >= BIRTH_YEAR_PIVOT ? "19" : "20";
    return `${yearPrefix}${value.slice(0, 2)}-${value.slice(2, 4)}-${value.slice(4, 6)}`;
}

export function normalizeCompactDateForSubmit(value: string): string {
    return compactToIso(parseCompactDateInput(value)) ?? "";
}

export function isValidCompactDateInput(value: string): boolean {
    const isoDate = compactToIso(parseCompactDateInput(value));
    return isoDate !== null && isStrictIsoDate(isoDate);
}

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

    const date = new Date(Date.UTC(
        2000 + Number(value.slice(0, 2)),
        Number(value.slice(2, 4)) - 1,
        Number(value.slice(4, 6)),
    ));
    return (
        date.getUTCFullYear() === 2000 + Number(value.slice(0, 2))
        && date.getUTCMonth() + 1 === Number(value.slice(2, 4))
        && date.getUTCDate() === Number(value.slice(4, 6))
    );
}

export function formatKoreanPhoneNumber(value: string): string {
    const digits = value.replace(/\D/g, "");

    if (digits.length <= 3) return digits;
    if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7, MOBILE_PHONE_DIGITS)}`;
}

export interface ClientRegistrationBasicsInput {
    name: string;
    phone: string;
    birthday: string;
    address: string;
    dueDate: string;
}

export function buildCanonicalClientRegistrationBasics(input: ClientRegistrationBasicsInput): Pick<
    CreateClientDto,
    "name" | "phone" | "birthday" | "address" | "dueDate"
> {
    const birthday = parseCompactDateInput(input.birthday);
    return {
        name: input.name.trim(),
        phone: formatKoreanPhoneNumber(input.phone),
        birthday,
        address: input.address.trim(),
        dueDate: normalizeCompactDateForSubmit(input.dueDate),
    };
}

export function getCanonicalClientRegistrationError(input: ClientRegistrationBasicsInput): string | null {
    if (!input.name.trim()) return "이름을 입력해 주세요.";
    if (input.phone.replace(/\D/g, "").length !== MOBILE_PHONE_DIGITS) {
        return CLIENT_REGISTRATION_ERROR_MESSAGES.phone;
    }
    if (!isValidClientBirthdayInput(parseCompactDateInput(input.birthday))) {
        return CLIENT_REGISTRATION_ERROR_MESSAGES.birthday;
    }
    if (!input.address.trim()) return "주소를 입력해 주세요.";
    if (!isValidCompactDateInput(input.dueDate)) {
        return CLIENT_REGISTRATION_ERROR_MESSAGES.dueDate;
    }
    return null;
}
