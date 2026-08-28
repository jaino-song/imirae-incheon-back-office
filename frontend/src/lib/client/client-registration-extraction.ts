import {
    isValidClientBirthdayInput,
    isValidCompactDateInput,
    parseCompactDateInput,
} from "./client-registration-formats";

export interface ClientRegistrationDraft {
    name?: string;
    phone?: string;
    birthday?: string;
    address?: string;
    employeeName?: string;
    dueDate?: string;
    skippedFields?: Array<"dueDate">;
}

const PHONE_PATTERN = /(?:\+?82[-.\s]?)?0?1[0-9][-.\s]?\d{3,4}[-.\s]?\d{4}/;
const ISO_DATE_PATTERN = /(?:20\d{2})[-./년\s]*(?:0?[1-9]|1[0-2])[-./월\s]*(?:0?[1-9]|[12]\d|3[01])(?:일)?/;
const SHORT_DATE_PATTERN = /(?:19|20)?(\d{2})[-./년\s]*(0?[1-9]|1[0-2])[-./월\s]*(0?[1-9]|[12]\d|3[01])(?:일)?/;
const REGISTRATION_COMMANDS = /산모\s*등록|고객\s*등록|등록해줘|추가해줘/g;

function digits(value: string): string {
    return value.replace(/\D/g, "");
}

function normalizePhone(value: string): string | undefined {
    const rawDigits = digits(value);
    if (!rawDigits) return undefined;

    if (rawDigits.startsWith("82")) {
        const domestic = rawDigits.slice(2);
        return (domestic.startsWith("0") ? domestic : `0${domestic}`).slice(0, 11) || undefined;
    }

    return rawDigits.startsWith("0") ? rawDigits.slice(0, 11) : `0${rawDigits}`.slice(0, 11);
}

function normalizeIsoDate(value: string): string | undefined {
    const parts = value.match(/(\d+)/g) ?? [];
    if (parts.length < 3) return undefined;

    const year = Number(parts[0]);
    const month = Number(parts[1]);
    const day = Number(parts[2]);
    const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const compact = iso.slice(2).replace(/\D/g, "");
    return isValidCompactDateInput(compact) ? compact : undefined;
}

function extractDueDate(message: string): string | undefined {
    const datePattern = /(?:20\d{2}|\d{2})[-./년\s]*(?:0?[1-9]|1[0-2])[-./월\s]*(?:0?[1-9]|[12]\d|3[01])(?:일)?/;
    const labelMatch = message.match(/출산[^,]*(예정일|날짜)/);
    if (labelMatch) {
        const labelIndex = message.indexOf(labelMatch[0]) + labelMatch[0].length;
        const afterLabel = message.slice(labelIndex);
        const dateCandidate = afterLabel.match(datePattern)?.[0];
        const compact = parseCompactDateInput(dateCandidate ?? "");
        if (isValidCompactDateInput(compact)) return compact;
    }

    const candidate = message.match(ISO_DATE_PATTERN)?.[0]
        ?? message.match(SHORT_DATE_PATTERN)?.[0];
    if (!candidate) return undefined;

    if (/^\d{4}/.test(digits(candidate))) {
        return normalizeIsoDate(candidate);
    }

    const compact = parseCompactDateInput(candidate);
    return isValidCompactDateInput(compact) ? compact : undefined;
}

export function extractClientRegistrationDraft(
    message: string,
    previous?: ClientRegistrationDraft,
): ClientRegistrationDraft & { missingFields: Array<"phone" | "birthday" | "address" | "dueDate"> } {
    const draft: ClientRegistrationDraft = {};

    if (previous) {
        Object.assign(draft, previous);
        delete draft.skippedFields;
    }

    const declined = /^(?:없어|없습니다|없어요|모르겠어요|모릅니다)$/.test(message.trim());

    const employeeNameMatch = message.match(/(?:제공인력|관리사|이모님)(?:은|는)?\s*([가-힣]{2,3})(?:이야|입니다|님)?/);

    const phoneMatch = message.match(PHONE_PATTERN);
    if (phoneMatch?.[0]) draft.phone = normalizePhone(phoneMatch[0]);

    const dueDate = extractDueDate(message);
    if (declined && !draft.dueDate) {
        draft.skippedFields = ["dueDate"];
    } else if (dueDate) {
        draft.dueDate = dueDate;
        delete draft.skippedFields;
    }

    const birthdayLabel = message.match(/(?:생년월일|생일|태어난)[^,\d]{0,8}(\d{2,4}[-./년\s]*\d{1,2}[-./월\s]*\d{1,2}(?:일)?|\d{6})/);
    const birthdayCandidate = parseCompactDateInput(birthdayLabel?.[1] ?? "");
    if (isValidClientBirthdayInput(birthdayCandidate)) draft.birthday = birthdayCandidate;

    const nameMatch = message.match(/(?:이름은|이름:|성함은|성함)\s*([가-힣]{2,3})(?:이야|입니다|님)?/);
    const bareName = message
        .replace(PHONE_PATTERN, "")
        .replace(REGISTRATION_COMMANDS, "")
        .split(/[.,]/)[0]?.trim() ?? "";
    const inferredName = bareName.match(/^([가-힣]{2,4})(?:님)?/);
    const name = nameMatch?.[1] ?? inferredName?.[1];
    if (name && !employeeNameMatch) draft.name = name;

    const addressMatch = message.match(/(?:주소는|주소:|사는 곳은|거주지는)\s*([^,.]+)/);
    if (addressMatch?.[1]) {
        draft.address = addressMatch[1].trim();
    } else {
        const sentence = message.split(/[.,]/).find((part) =>
            part.includes("주소") || /^(?:사는 곳|거주지)/.test(part.trim())
        );
        if (sentence) draft.address = sentence.trim();
    }

    if (employeeNameMatch?.[1]) draft.employeeName = employeeNameMatch[1];

    return finishDraft(draft);
}

function finishDraft(draft: ClientRegistrationDraft): ClientRegistrationDraft & { missingFields: Array<"phone" | "birthday" | "address" | "dueDate"> } {

    const normalized = Object.fromEntries(
        Object.entries(draft)
            .filter(([key, value]) => key !== "skippedFields" && Boolean(value))
            .map(([key, value]) => [key, value] as [Exclude<keyof ClientRegistrationDraft, "skippedFields">, string]),
    );
    const missingFields: Array<"phone" | "birthday" | "address" | "dueDate"> = [];
    if (!normalized.phone) missingFields.push("phone");
    if (!normalized.birthday) missingFields.push("birthday");
    if (!normalized.address) missingFields.push("address");
    if (!normalized.dueDate && !draft.skippedFields?.includes("dueDate")) missingFields.push("dueDate");

    return {
        ...normalized,
        missingFields,
    };
}
