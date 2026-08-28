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
const DATE_TOKEN_PATTERN = /(?<!\d)(?:(?:19|20)\d{2}(?:(?:[-./]\s*\d{1,2}\s*[-./]\s*\d{1,2}일?)|(?:년\s*\d{1,2}월\s*\d{1,2}일?)|(?:\s+\d{1,2}\s+\d{1,2}일?)|\d{4})|\d{2}(?:(?:[-./]\s*\d{1,2}\s*[-./]\s*\d{1,2}일?)|(?:년\s*\d{1,2}월\s*\d{1,2}일?)|(?:\s+\d{1,2}\s+\d{1,2}일?))|\d{6}일?)(?![\dA-Za-z]|[-./](?=[\dA-Za-z가-힣]))/g;
const ISO_DATE_PARTS_PATTERN = /^((?:19|20)\d{2})[-./년\s]*(\d{1,2})[-./월\s]*(\d{1,2})(?:일)?$/;
const SHORT_DATE_PARTS_PATTERN = /^(\d{2})[-./년\s]*(\d{1,2})[-./월\s]*(\d{1,2})(?:일)?$/;
const DATE_KOREAN_ENDING_PATTERN = /^(?:이고요?|이며요?|이에요|예요|입니다|이야|야|인데요?|이구요?)(?=$|[\s,.;:!?])/;

const DUE_DATE_LABEL_PATTERN = /(?:출산\s*(?:예정\s*(?:일자?|날짜)|날짜|일자?)|분만\s*(?:예정\s*(?:일자?|날짜)|날짜|일자?))/;
const BIRTHDAY_LABEL_PATTERN = /(?:생년월일자?|생일|태어난\s*(?:날짜|날)?)/;
const DATE_FIELD_LABEL_PATTERN = new RegExp(
    `(?:${DUE_DATE_LABEL_PATTERN.source}|${BIRTHDAY_LABEL_PATTERN.source})`,
);
const LABEL_VALUE_PREFIX = /^\s*(?:(?:은|는|이|가|을|를)\s*)?[:：=]?\s*/;
const BIRTHDAY_CALENDAR_QUALIFIER_PREFIX = /^(?:[,，]\s*)?(양력|음력)(?:으로)?\s*(?:[:：=]\s*|[,，]\s*(?=\d)|(?=\d))/;

const PROVIDER_LABEL_PATTERN = /(?:제공인력|관리사님?|이모님)/;
const PROVIDER_LABEL_OCCURRENCE_PATTERN = /(?:제공인력|관리사님?|이모님)/g;
const PROVIDER_SUBJECT_PARTICLE_PATTERN = /^(?:은|는|이|가|을|를|으로|로)/;
const PROVIDER_NON_NAME_FIELDS = new Set([
    "연락처",
    "전화",
    "전화번호",
    "등급",
    "주소",
    "생년월일",
    "생일",
    "나이",
    "성별",
    "경력",
    "급여",
    "근무지",
    "소속",
    "이름",
    "성함",
    "보호자",
    "서비스",
    "기간",
    "시간",
    "지역",
    "센터",
    "기관",
    "병원",
    "계좌",
    "계좌번호",
    "은행",
    "메모",
    "비고",
]);
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
    "에게",
    "와",
    "과",
    "랑",
    "이랑",
    "한테",
    "께",
    "로부터",
    "으로부터",
    "을",
] as const;
const PROVIDER_PARTICLE_SUFFIXES = [
    "으로",
    "로",
    "가",
    "를",
    "은",
    "는",
    "이",
    "에게",
    "와",
    "과",
    "랑",
    "이랑",
    "한테",
    "께",
    "로부터",
    "으로부터",
    "을",
] as const;
const PROVIDER_AMBIGUOUS_PARTICLE_SUFFIXES = ["와", "과", "랑", "이랑"] as const;
const PROVIDER_STRONG_PARTICLE_SUFFIXES = ["에게", "이랑", "한테", "께", "로부터", "으로부터"] as const;
const PROVIDER_FIXED_SUFFIXES = PROVIDER_SUFFIXES.filter(
    (suffix) => !(PROVIDER_PARTICLE_SUFFIXES as readonly string[]).includes(suffix),
).sort((left, right) => right.length - left.length);
// Unlike multi-syllable copular endings ("이야", "이에요", etc.) and the
// honorific "님", a final "야" can be either a sentence ending or the last
// syllable of a perfectly valid Korean name (for example, 이서야). Treat a
// short token ending in 야 as ambiguous when only a punctuation boundary
// follows it; returning the complete token is safer than silently binding the
// shortened candidate to another provider.
const PROVIDER_AMBIGUOUS_FIXED_SUFFIXES = ["야"] as const;

const COMPACT_YEAR_MIN = 1970;
const COMPACT_YEAR_MAX = 2069;

type DateLabelPattern = RegExp;

interface DateToken {
    raw: string;
    index: number;
}

interface LabelOccurrence {
    index: number;
    length: number;
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

function isDateTokenBoundary(message: string, index: number, length: number): boolean {
    const remainder = message.slice(index + length);
    if (/^[\dA-Za-z]/.test(remainder)) return false;
    if (/^[-./](?=[\dA-Za-z가-힣])/.test(remainder)) return false;
    if (/^[가-힣]/.test(remainder)) return DATE_KOREAN_ENDING_PATTERN.test(remainder);

    return true;
}

function findDateToken(message: string): DateToken | undefined {
    for (const match of message.matchAll(DATE_TOKEN_PATTERN)) {
        const index = match.index ?? -1;
        if (index >= 0 && isDateTokenBoundary(message, index, match[0].length)) {
            return { raw: match[0], index };
        }
    }

    return undefined;
}

function collectLabelOccurrences(message: string, labelPattern: DateLabelPattern): LabelOccurrence[] {
    const globalPattern = new RegExp(
        labelPattern.source,
        labelPattern.flags.includes("g") ? labelPattern.flags : `${labelPattern.flags}g`,
    );

    return Array.from(message.matchAll(globalPattern), (match) => ({
        index: match.index ?? -1,
        length: match[0].length,
    })).filter(({ index }) => index >= 0);
}

function collectDateFieldLabelOccurrences(message: string): LabelOccurrence[] {
    return collectLabelOccurrences(message, DATE_FIELD_LABEL_PATTERN)
        .sort((left, right) => left.index - right.index);
}

function collectDateTokens(message: string): DateToken[] {
    return Array.from(message.matchAll(DATE_TOKEN_PATTERN), (match) => ({
        raw: match[0],
        index: match.index ?? -1,
    })).filter(({ index, raw }) => index >= 0 && isDateTokenBoundary(message, index, raw.length));
}

function extractLabeledDateValue(
    fieldText: string,
    options?: { allowBirthdayCalendarQualifier?: boolean },
): string | undefined {
    let afterLabel = fieldText.replace(LABEL_VALUE_PREFIX, "");

    if (options?.allowBirthdayCalendarQualifier) {
        const calendarQualifier = afterLabel.match(BIRTHDAY_CALENDAR_QUALIFIER_PREFIX);
        if (calendarQualifier?.[1] === "음력") {
            // The registration API stores Gregorian YYMMDD values and this
            // extractor has no lunar-calendar conversion. Refuse lunar input
            // rather than silently persisting the same digits as Gregorian.
            return undefined;
        }

        afterLabel = afterLabel.replace(BIRTHDAY_CALENDAR_QUALIFIER_PREFIX, "");
    }

    const candidate = findDateToken(afterLabel);

    // The value must begin immediately after the label (apart from the
    // allowed particle/separator prefix). A later unrelated date is never a
    // substitute for an absent or invalid labeled value.
    if (!candidate || !afterLabel.startsWith(candidate.raw)) return undefined;

    return normalizeDateCandidate(candidate.raw);
}

function extractLabeledDate(
    message: string,
    labelPattern: DateLabelPattern,
    options?: { allowBirthdayCalendarQualifier?: boolean },
): LabeledDate {
    const labelOccurrences = collectLabelOccurrences(message, labelPattern);
    if (labelOccurrences.length === 0) return { found: false };

    const dateFieldLabels = collectDateFieldLabelOccurrences(message);
    for (const occurrence of labelOccurrences) {
        const previousFieldLabel = [...dateFieldLabels]
            .reverse()
            .find(({ index }) => index < occurrence.index);
        const textSincePreviousLabel = previousFieldLabel
            ? message.slice(previousFieldLabel.index + previousFieldLabel.length, occurrence.index)
            : "";
        if (
            options?.allowBirthdayCalendarQualifier
            && previousFieldLabel
            && /(?:양력|음력)\s*$/.test(textSincePreviousLabel)
        ) {
            // A bare date label immediately after a calendar qualifier is
            // still part of the preceding malformed birthday value (for
            // example, "생년월일은 양력 생년월일 000101"). Do not reinterpret
            // that nested label as an independent repeated field.
            continue;
        }

        const nextFieldLabel = dateFieldLabels.find(({ index }) => index > occurrence.index);
        const fieldEnd = nextFieldLabel?.index ?? message.length;
        const fieldText = message.slice(occurrence.index + occurrence.length, fieldEnd);
        const value = extractLabeledDateValue(fieldText, options);
        if (value) return { found: true, value };
    }

    return { found: true };
}

function extractBirthday(message: string): string | undefined {
    const labeledDate = extractLabeledDate(message, BIRTHDAY_LABEL_PATTERN, {
        allowBirthdayCalendarQualifier: true,
    });
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

function consumeProviderParticleChain(remainder: string): string | undefined {
    let tail = remainder;
    while (true) {
        const particle = PROVIDER_PARTICLE_SUFFIXES.find((candidate) => tail.startsWith(candidate));
        if (!particle) break;

        tail = tail.slice(particle.length);
    }

    return isProviderNameBoundary(tail) ? tail : undefined;
}

function consumeProviderSuffix(remainder: string, suffix: string): string | undefined {
    if (!remainder.startsWith(suffix)) return undefined;

    return consumeProviderParticleChain(remainder.slice(suffix.length));
}

function hasProviderFollowingContext(tail: string): boolean {
    return /^\s*[가-힣]/.test(tail);
}

function hasProviderValueSeparator(value: string): boolean {
    return /^\s*[:：=]/.test(value);
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

function extractEmployeeNameFromProviderTail(afterLabel: string): string | undefined {
    const hasExplicitValueSeparator = hasProviderValueSeparator(afterLabel);
    afterLabel = afterLabel.replace(PROVIDER_SUBJECT_PARTICLE_PATTERN, "");
    afterLabel = afterLabel.replace(/^\s*[:：=]?\s*/, "");

    const tokenMatch = afterLabel.match(/^([가-힣]+)/);
    if (!tokenMatch) return undefined;

    const token = tokenMatch[1];

    // A two-syllable name followed by a single 야 is ambiguous at a sentence
    // boundary: 이서야 can be either the full provider name or 이서 + the
    // copular ending. An explicit field-value separator makes the complete
    // token the safer interpretation; without one, reject the candidate so
    // the wizard can require a deliberate provider choice instead of binding
    // the shortened name to an unrelated employee.
    const ambiguousShortCopularName = token.slice(0, 3);
    const ambiguousShortCopularTail = token.length >= 3
        && ambiguousShortCopularName.length === 3
        && (PROVIDER_AMBIGUOUS_FIXED_SUFFIXES as readonly string[]).some((suffix) => ambiguousShortCopularName.endsWith(suffix))
        ? consumeProviderParticleChain(afterLabel.slice(3))
        : undefined;
    if (ambiguousShortCopularTail !== undefined) {
        return hasExplicitValueSeparator ? ambiguousShortCopularName : undefined;
    }

    // Copular endings and honorifics are unambiguous even when they are
    // attached directly to the name (e.g. "김민이야" or "김민님,"). Prefer
    // the longest ending before considering a shorter one such as 야.
    for (const suffix of PROVIDER_FIXED_SUFFIXES) {
        for (let length = Math.min(4, token.length - suffix.length); length >= 2; length -= 1) {
            const candidate = token.slice(0, length);
            if (!/^[가-힣]+$/.test(candidate)) continue;

            const remainder = afterLabel.slice(length);
            const tail = consumeProviderSuffix(remainder, suffix);
            if (tail !== undefined) {
                return candidate;
            }
        }
    }

    // Evaluate longer name candidates first. A particle is removed only when
    // its complete chain is followed by grammatical context or an explicit
    // boundary. The short-name phonology check below prevents a real name such
    // as "김가은" from being shortened to "김가" merely because 은 is also a
    // topic particle.
    const particleMatches: Array<{ name: string; consumedLength: number; suffix: string }> = [];
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
                    || (
                        candidate.length >= 3
                        && isProviderNameBoundary(tail)
                        && !(
                            (PROVIDER_AMBIGUOUS_PARTICLE_SUFFIXES as readonly string[]).includes(suffix)
                            && token.length <= 4
                        )
                    )
                    || (
                        (PROVIDER_STRONG_PARTICLE_SUFFIXES as readonly string[]).includes(suffix)
                        && isProviderNameBoundary(tail)
                    )
                )
            ) {
                particleMatches.push({
                    name: candidate,
                    consumedLength: remainder.length - tail.length,
                    suffix,
                });
            }
        }
    }

    // A consecutive particle chain (e.g. 이+는 in "김영희이는") is stronger
    // evidence than a one-syllable particle attached to a longer candidate,
    // except when that first particle is an ambiguous comitative ending such
    // as 랑 in a legitimate name like 박이랑. Prefer the longest candidate
    // after applying that ambiguity penalty so names are not shortened.
    const selectedParticleMatch = particleMatches
        .sort((left, right) => {
            const leftAmbiguousPenalty = (PROVIDER_AMBIGUOUS_PARTICLE_SUFFIXES as readonly string[]).includes(left.suffix) ? 1 : 0;
            const rightAmbiguousPenalty = (PROVIDER_AMBIGUOUS_PARTICLE_SUFFIXES as readonly string[]).includes(right.suffix) ? 1 : 0;
            const leftEffectiveConsumption = left.consumedLength - leftAmbiguousPenalty;
            const rightEffectiveConsumption = right.consumedLength - rightAmbiguousPenalty;

            return rightEffectiveConsumption - leftEffectiveConsumption || right.name.length - left.name.length;
        })[0];
    if (selectedParticleMatch) return selectedParticleMatch.name;

    const hasAmbiguousBareName = (PROVIDER_AMBIGUOUS_PARTICLE_SUFFIXES as readonly string[]).some(
        (suffix) => token.endsWith(suffix),
    );
    if (
        hasAmbiguousBareName
        && token.length <= 4
        && isProviderNameBoundary(afterLabel.slice(token.length))
    ) {
        // A short token ending in 와/과/랑/이랑 is inherently ambiguous at a
        // punctuation boundary: it can be either a complete name or a name
        // followed by a comitative particle. Rejecting it is safer than
        // forwarding a bogus employee name and creating the wrong provider.
        return undefined;
    }

    const bareName = afterLabel.match(/^([가-힣]{2,4})(?=$|[\s,.;:!?])/);
    return bareName?.[1];
}

function isProviderNonNameField(value: string): boolean {
    const withoutParticle = value.replace(/(?:은|는|이|가|을|를)$/, "");
    return PROVIDER_NON_NAME_FIELDS.has(value) || PROVIDER_NON_NAME_FIELDS.has(withoutParticle);
}

function extractEmployeeName(message: string): EmployeeExtraction {
    let hasLabel = false;

    for (const labelMatch of message.matchAll(PROVIDER_LABEL_OCCURRENCE_PATTERN)) {
        hasLabel = true;
        const labelIndex = labelMatch.index ?? -1;
        if (labelIndex < 0) continue;

        const candidate = extractEmployeeNameFromProviderTail(
            message.slice(labelIndex + labelMatch[0].length),
        );
        if (candidate && !isProviderNonNameField(candidate)) {
            return { hasLabel: true, name: candidate };
        }
    }

    return { hasLabel };
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
