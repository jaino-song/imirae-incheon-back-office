import {
    isValidClientBirthdayInput,
    isValidCompactDateInput,
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
const REGISTRATION_COMMANDS = /산모\s*등록|고객\s*등록|등록해줘|추가해줘/g;

// A date token must contain a complete year/month/day shape. The month/day
// ranges are intentionally broad here; calendar validity is checked after
// extraction so malformed values cannot be replaced by a later date.
const DATE_TOKEN_PATTERN = /(?<!\d)(?:(?:19|20)\d{2}(?:(?:[-./]\s*\d{1,2}\s*[-./]\s*\d{1,2}일?)|(?:년\s*\d{1,2}월\s*\d{1,2}일?)|(?:\s+\d{1,2}\s+\d{1,2}일?)|\d{4})|\d{2}(?:(?:[-./]\s*\d{1,2}\s*[-./]\s*\d{1,2}일?)|(?:년\s*\d{1,2}월\s*\d{1,2}일?)|(?:\s+\d{1,2}\s+\d{1,2}일?))|\d{6}일?)(?![\dA-Za-z가-힣]|[-./](?=[\dA-Za-z가-힣]))/g;
const ISO_DATE_PARTS_PATTERN = /^((?:19|20)\d{2})[-./년\s]*(\d{1,2})[-./월\s]*(\d{1,2})(?:일)?$/;
const SHORT_DATE_PARTS_PATTERN = /^(\d{2})[-./년\s]*(\d{1,2})[-./월\s]*(\d{1,2})(?:일)?$/;

const DUE_DATE_LABEL_PATTERN = /(?:출산\s*(?:예정\s*(?:일자?|날짜)|날짜|일자?)|분만\s*(?:예정\s*(?:일자?|날짜)|날짜|일자?))/;
const BIRTHDAY_LABEL_PATTERN = /(?:생년월일자?|생일|태어난\s*(?:날짜|날)?)/;
const LABEL_VALUE_PREFIX = /^\s*(?:(?:은|는|이|가|을|를)\s*)?[:：=]?\s*/;

const PROVIDER_LABEL_PATTERN = /(?:제공인력|관리사님?|이모님)/;
const PROVIDER_SUBJECT_PARTICLE_PATTERN = /^(?:은|는|이|가|을|를|으로|로)/;
const PROVIDER_SUFFIXES = [
    "이에요",
    "예요",
    "입니다",
    "이야",
    "으로",
    "님",
    "로",
    "가",
    "를",
    "은",
    "는",
    "이",
    "야",
] as const;
const PROVIDER_PARTICLE_SUFFIXES = ["으로", "로", "가", "를", "은", "는", "이"] as const;
const PROVIDER_FIXED_SUFFIXES = PROVIDER_SUFFIXES.filter(
    (suffix) => !(PROVIDER_PARTICLE_SUFFIXES as readonly string[]).includes(suffix),
).sort((left, right) => right.length - left.length);

const COMPACT_YEAR_MIN = 1970;
const COMPACT_YEAR_MAX = 2069;

type DateLabelPattern = RegExp;

interface DateToken {
    raw: string;
    index: number;
}

interface LabeledDate {
    found: boolean;
    value?: string;
}

interface EmployeeExtraction {
    hasLabel: boolean;
    name?: string;
}

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

function normalizeDateCandidate(value: string): string | undefined {
    const isoMatch = value.match(ISO_DATE_PARTS_PATTERN);
    if (isoMatch) {
        const [, year, month, day] = isoMatch;
        const numericYear = Number(year);
        if (numericYear < COMPACT_YEAR_MIN || numericYear > COMPACT_YEAR_MAX) return undefined;

        const compact = `${year.slice(2)}${month.padStart(2, "0")}${day.padStart(2, "0")}`;
        return isValidCompactDateInput(compact) ? compact : undefined;
    }

    const shortMatch = value.match(SHORT_DATE_PARTS_PATTERN);
    if (!shortMatch) return undefined;

    const [, year, month, day] = shortMatch;
    const compact = `${year}${month.padStart(2, "0")}${day.padStart(2, "0")}`;
    return isValidCompactDateInput(compact) ? compact : undefined;
}

function collectDateTokens(message: string): DateToken[] {
    return Array.from(message.matchAll(DATE_TOKEN_PATTERN), (match) => ({
        raw: match[0],
        index: match.index ?? -1,
    }));
}

function extractLabeledDate(message: string, labelPattern: DateLabelPattern): LabeledDate {
    const labelMatch = message.match(labelPattern);
    if (!labelMatch || labelMatch.index === undefined) return { found: false };

    const afterLabel = message
        .slice(labelMatch.index + labelMatch[0].length)
        .replace(LABEL_VALUE_PREFIX, "");
    const candidate = afterLabel.match(DATE_TOKEN_PATTERN);

    // The value must begin immediately after the label (apart from the
    // allowed particle/separator prefix). A later unrelated date is never a
    // substitute for an absent or invalid labeled value.
    if (!candidate || !afterLabel.startsWith(candidate[0])) return { found: true };

    return {
        found: true,
        value: normalizeDateCandidate(candidate[0]),
    };
}

function extractBirthday(message: string): string | undefined {
    const labeledDate = extractLabeledDate(message, BIRTHDAY_LABEL_PATTERN);
    if (!labeledDate.value || !isValidClientBirthdayInput(labeledDate.value)) return undefined;

    return labeledDate.value;
}

function extractDueDate(message: string): string | undefined {
    const labeledDate = extractLabeledDate(message, DUE_DATE_LABEL_PATTERN);
    if (labeledDate.found) return labeledDate.value;

    // An unlabeled date is only safe when it is the sole complete date in the
    // request. In particular, a birthday label disables this fallback even if
    // its date is malformed, preventing a later date from being misassigned.
    if (BIRTHDAY_LABEL_PATTERN.test(message)) return undefined;

    const candidates = collectDateTokens(message);
    if (candidates.length !== 1) return undefined;

    return normalizeDateCandidate(candidates[0].raw);
}

function hasProviderLabel(message: string): boolean {
    return PROVIDER_LABEL_PATTERN.test(message);
}

function isProviderNameBoundary(value: string): boolean {
    return value.length === 0 || /^[\s,.;:!?]/.test(value);
}

function consumeProviderSuffix(remainder: string, suffix: string): string | undefined {
    if (!remainder.startsWith(suffix)) return undefined;

    let tail = remainder.slice(suffix.length);
    while (true) {
        const particle = PROVIDER_PARTICLE_SUFFIXES.find((candidate) => tail.startsWith(candidate));
        if (!particle) break;

        tail = tail.slice(particle.length);
    }

    return isProviderNameBoundary(tail) ? tail : undefined;
}

function hasProviderFollowingContext(tail: string): boolean {
    return /^\s*[가-힣]/.test(tail);
}

function hasFinalConsonant(value: string): boolean {
    const lastSyllable = value.codePointAt(value.length - 1);
    if (lastSyllable === undefined || lastSyllable < 0xac00 || lastSyllable > 0xd7a3) return false;

    return (lastSyllable - 0xac00) % 28 !== 0;
}

function isParticlePhonologicallyCompatible(name: string, suffix: string): boolean {
    // Three- and four-syllable names are common enough that an intentionally
    // spoken particle can be retained even when the input is not perfectly
    // grammatical (for example, "김영희이"). Keep that existing tolerance,
    // while using Korean particle rules to protect short names that end in a
    // particle-like syllable (for example, "김가은" or "김나이").
    if (name.length >= 3) return true;

    const finalConsonant = hasFinalConsonant(name);
    switch (suffix) {
        case "은":
        case "이":
        case "을":
            return finalConsonant;
        case "는":
        case "가":
        case "를":
            return !finalConsonant;
        case "으로":
            return finalConsonant;
        case "로":
            return !finalConsonant;
        default:
            return true;
    }
}

function extractEmployeeName(message: string): EmployeeExtraction {
    const labelMatch = message.match(PROVIDER_LABEL_PATTERN);
    if (!labelMatch || labelMatch.index === undefined) return { hasLabel: false };

    let afterLabel = message.slice(labelMatch.index + labelMatch[0].length);
    afterLabel = afterLabel.replace(PROVIDER_SUBJECT_PARTICLE_PATTERN, "");
    afterLabel = afterLabel.replace(/^\s*[:：=]?\s*/, "");

    const tokenMatch = afterLabel.match(/^([가-힣]+)/);
    if (!tokenMatch) return { hasLabel: true };

    const token = tokenMatch[1];

    // Copular endings and honorifics are unambiguous even when they are
    // attached directly to the name (e.g. "김민이야" or "김민님,"). Prefer
    // the longest ending before considering a shorter one such as 야.
    for (const suffix of PROVIDER_FIXED_SUFFIXES) {
        for (let length = Math.min(4, token.length - suffix.length); length >= 2; length -= 1) {
            const candidate = token.slice(0, length);
            if (!/^[가-힣]+$/.test(candidate)) continue;

            const remainder = afterLabel.slice(length);
            if (consumeProviderSuffix(remainder, suffix) !== undefined) {
                return { hasLabel: true, name: candidate };
            }
        }
    }

    // Evaluate longer name candidates first. A particle is removed only when
    // its complete chain is followed by grammatical context or an explicit
    // boundary. The short-name phonology check below prevents a real name such
    // as "김가은" from being shortened to "김가" merely because 은 is also a
    // topic particle.
    const particleMatches: Array<{ name: string; consumedLength: number }> = [];
    for (let length = Math.min(4, token.length - 1); length >= 2; length -= 1) {
        const candidate = token.slice(0, length);
        if (!/^[가-힣]+$/.test(candidate)) continue;

        const remainder = afterLabel.slice(length);
        for (const suffix of PROVIDER_PARTICLE_SUFFIXES) {
            const tail = consumeProviderSuffix(remainder, suffix);
            if (
                tail !== undefined
                && isParticlePhonologicallyCompatible(candidate, suffix)
                && (
                    token.length > 4
                    || hasProviderFollowingContext(tail)
                    || (candidate.length >= 3 && isProviderNameBoundary(tail))
                )
            ) {
                particleMatches.push({
                    name: candidate,
                    consumedLength: remainder.length - tail.length,
                });
            }
        }
    }

    // A consecutive particle chain (e.g. 이+는 in "김영희이는") is stronger
    // evidence than a one-syllable particle attached to a longer candidate.
    // Otherwise retain the longest candidate to avoid shortening names such
    // as 김가은 or 김나이.
    const selectedParticleMatch = particleMatches
        .sort((left, right) => right.consumedLength - left.consumedLength || right.name.length - left.name.length)[0];
    if (selectedParticleMatch) return { hasLabel: true, name: selectedParticleMatch.name };

    const bareName = afterLabel.match(/^([가-힣]{2,4})(?=$|[\s,.;:!?])/);
    return { hasLabel: true, name: bareName?.[1] };
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
    const employee = extractEmployeeName(message);

    const phoneMatch = message.match(PHONE_PATTERN);
    if (phoneMatch?.[0]) draft.phone = normalizePhone(phoneMatch[0]);

    const dueDate = extractDueDate(message);
    if (declined && !draft.dueDate) {
        draft.skippedFields = ["dueDate"];
    } else if (dueDate) {
        draft.dueDate = dueDate;
        delete draft.skippedFields;
    }

    const birthday = extractBirthday(message);
    if (birthday) draft.birthday = birthday;

    const nameMatch = message.match(/(?:이름은|이름:|성함은|성함)\s*([가-힣]{2,3})(?:이야|입니다|님)?/);
    const bareName = message
        .replace(PHONE_PATTERN, "")
        .replace(REGISTRATION_COMMANDS, "")
        .split(/[.,]/)[0]?.trim() ?? "";
    const inferredName = bareName.match(/^([가-힣]{2,4})(?:님)?/);
    const startsWithProviderLabel = hasProviderLabel(bareName);
    const name = nameMatch?.[1] ?? (!startsWithProviderLabel ? inferredName?.[1] : undefined);
    if (name) draft.name = name;

    const addressMatch = message.match(/(?:주소는|주소:|사는 곳은|거주지는)\s*([^,.]+)/);
    if (addressMatch?.[1]) {
        draft.address = addressMatch[1].trim();
    } else {
        const sentence = message.split(/[.,]/).find((part) =>
            part.includes("주소") || /^(?:사는 곳|거주지)/.test(part.trim())
        );
        if (sentence) draft.address = sentence.trim();
    }

    if (employee.name) draft.employeeName = employee.name;

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
