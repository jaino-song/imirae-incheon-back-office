/**
 * Pure mapper: `service_record` header + `service_record_day` rows → eformsign prefill fields
 * for the 제공기록지 template. No NestJS/Prisma imports so it is trivially unit-testable.
 *
 * Field ids and value encodings come from `service-record-field-ids.ts` (captured live in Spike B).
 * `serviceDate` is a Prisma `@db.Date` (UTC-midnight) — read it with UTC accessors, never local ones.
 */
import {
    CHECKBOX_CHECKED_VALUE,
    CHECKBOX_UNCHECKED_VALUE,
    SERVICE_RECORD_HEADER_FIELD_IDS,
    SERVICE_RECORD_TEMPLATE_SESSIONS_PER_DOCUMENT,
    serviceRecordDayFieldIds,
} from "./service-record-field-ids";

export interface ServiceRecordHeaderInput {
    momName: string | null;
    momBirth: string | null; // YYMMDD
    babyName: string | null;
    babyBirth: string | null; // YYMMDD
    deliveryType: string | null; // "자연분만" | "제왕절개"
    babyWeight: string | null;
}

export interface ServiceRecordDayInput {
    sessionIndex: number;
    serviceDate: Date;
    answers: Record<string, unknown>;
    etcService: string | null;
    notes: string | null;
    paymentConfirmed: boolean;
    momApproval: string | null; // non-null => approved
    clientSignature: string | null; // dataURI "data:image/png;base64,<b64>" or null/"" — sent as-is to the binary(서명) field
}

export interface EformsignField {
    id: string;
    value: string;
}

/**
 * 2-digit-year → ISO date. Pivot at 30: 00–29 → 2000–2029, 30–99 → 1930–1999. Covers every
 * mother's birth year and every newborn's birth year for this app's era; revisit before 2030.
 * Returns null for anything that is not 6 digits forming a plausible date.
 */
export function yymmddToIso(yymmdd: string | null | undefined): string | null {
    if (!yymmdd || !/^\d{6}$/.test(yymmdd)) return null;
    const yy = Number(yymmdd.slice(0, 2));
    const mm = Number(yymmdd.slice(2, 4));
    const dd = Number(yymmdd.slice(4, 6));
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
    const century = yy < 30 ? "20" : "19";
    return `${century}${yymmdd.slice(0, 2)}-${yymmdd.slice(2, 4)}-${yymmdd.slice(4, 6)}`;
}

/** UTC month as 2-digit "MM" (template field type date_MM). */
function utcMonth(date: Date): string {
    return String(date.getUTCMonth() + 1).padStart(2, "0");
}

/** UTC day as 2-digit "DD" (template field type date_DD). */
function utcDay(date: Date): string {
    return String(date.getUTCDate()).padStart(2, "0");
}

/** Split sessions into fixed-size chunks (one eformsign document per chunk). */
export function chunkSessions<T>(days: T[], size: number = SERVICE_RECORD_TEMPLATE_SESSIONS_PER_DOCUMENT): T[][] {
    if (size < 1) throw new Error("chunk size must be >= 1");
    const chunks: T[][] = [];
    for (let i = 0; i < days.length; i += size) {
        chunks.push(days.slice(i, i + size));
    }
    return chunks;
}

/**
 * Smallest configured template tier that can hold `dayCount` sessions in one document;
 * falls back to the largest configured tier when `dayCount` exceeds every tier (the caller
 * must then split the remainder into further chunks — see `chunkSessionsByTier`).
 */
export function selectTemplateTier(dayCount: number, tiers: number[]): number {
    if (tiers.length === 0) throw new Error("selectTemplateTier requires at least one tier");
    const sorted = [...tiers].sort((a, b) => a - b);
    return sorted.find((tier) => tier >= dayCount) ?? sorted[sorted.length - 1]!;
}

/**
 * Split a segment's sessions into per-document chunks sized to the configured template tiers:
 * greedily fill the largest tier while more than a tier's worth of sessions remain, then size
 * the final (possibly partial) chunk to the smallest tier that fits it. With a single configured
 * tier this reproduces `chunkSessions(days, tier)` exactly (the pre-multi-tier behavior).
 */
export function chunkSessionsByTier<T>(days: T[], tiers: number[]): Array<{ days: T[]; tier: number }> {
    if (days.length === 0) return [];
    if (tiers.length === 0) throw new Error("chunkSessionsByTier requires at least one tier");
    const maxTier = Math.max(...tiers);

    const chunks: Array<{ days: T[]; tier: number }> = [];
    let remaining = days;
    while (remaining.length > maxTier) {
        chunks.push({ days: remaining.slice(0, maxTier), tier: maxTier });
        remaining = remaining.slice(maxTier);
    }
    if (remaining.length > 0) {
        chunks.push({ days: remaining, tier: selectTemplateTier(remaining.length, tiers) });
    }
    return chunks;
}

function asText(value: unknown): string {
    if (value == null) return "";
    return String(value).trim();
}

/**
 * Build the eformsign prefill field list for ONE document covering up to `slotCount`
 * sessions (`days` is a single chunk; `slotCount` defaults to the base 5-session tier).
 *
 * Empty text/date values are omitted. The required creation-step marks (결제 확인 N / 산모확인서명 N)
 * are emitted for ALL `slotCount` slots — including unused ones (as unchecked) — or eformsign
 * rejects creation with "Required input value not found".
 */
export function buildServiceRecordDocumentFields(input: {
    header: ServiceRecordHeaderInput | null;
    providerName?: string | null;
    employeeName: string;
    days: ServiceRecordDayInput[];
    slotCount?: number;
}): EformsignField[] {
    const {
        header,
        providerName,
        employeeName,
        days,
        slotCount = SERVICE_RECORD_TEMPLATE_SESSIONS_PER_DOCUMENT,
    } = input;
    if (days.length > slotCount) {
        throw new Error(`buildServiceRecordDocumentFields: ${days.length} days exceed slotCount ${slotCount}`);
    }
    const fields: EformsignField[] = [];

    const pushText = (id: string, raw: unknown) => {
        const value = asText(raw);
        if (value !== "") fields.push({ id, value });
    };
    // Required-at-creation fields must be PRESENT in every request (creation 400s otherwise);
    // an empty value passes the required check and renders blank — verified live.
    const pushRequired = (id: string, raw: unknown) => {
        fields.push({ id, value: asText(raw) });
    };
    const pushCheck = (id: string, checked: boolean) => {
        fields.push({ id, value: checked ? CHECKBOX_CHECKED_VALUE : CHECKBOX_UNCHECKED_VALUE });
    };

    // ── Header (once per document) — every header field is required at creation ──
    pushRequired(SERVICE_RECORD_HEADER_FIELD_IDS.providerName, providerName);
    pushRequired(SERVICE_RECORD_HEADER_FIELD_IDS.employeeName, employeeName);
    pushRequired(SERVICE_RECORD_HEADER_FIELD_IDS.momName, header?.momName);
    pushRequired(SERVICE_RECORD_HEADER_FIELD_IDS.momBirth, yymmddToIso(header?.momBirth));
    pushRequired(SERVICE_RECORD_HEADER_FIELD_IDS.babyName, header?.babyName);
    pushRequired(SERVICE_RECORD_HEADER_FIELD_IDS.babyBirth, yymmddToIso(header?.babyBirth));
    pushRequired(SERVICE_RECORD_HEADER_FIELD_IDS.babyWeight, header?.babyWeight);
    // Both delivery-type marks are required — send the pair, checked per deliveryType.
    pushCheck(SERVICE_RECORD_HEADER_FIELD_IDS.deliveryNatural, header?.deliveryType === "자연분만");
    pushCheck(SERVICE_RECORD_HEADER_FIELD_IDS.deliveryCSection, header?.deliveryType === "제왕절개");

    // ── Session slots 1..slotCount ──
    for (let slot = 1; slot <= slotCount; slot++) {
        const ids = serviceRecordDayFieldIds(slot);
        const day = days[slot - 1];

        if (!day) {
            // Unused slot: required creation fields only — dates blank, marks unchecked.
            pushRequired(ids.month, "");
            pushRequired(ids.day, "");
            pushCheck(ids.paymentConfirmed, false);
            pushRequired(ids.momApproval, "");
            continue;
        }

        const answers = day.answers ?? {};
        const selectOne = (group: Record<string, string>, value: unknown) => {
            const key = asText(value);
            const id = key ? group[key] : undefined;
            if (id) pushCheck(id, true);
        };
        const selectMany = (group: Record<string, string>, value: unknown) => {
            if (!Array.isArray(value)) return;
            for (const option of value) {
                const id = group[asText(option)];
                if (id) pushCheck(id, true);
            }
        };

        // Date
        fields.push({ id: ids.month, value: utcMonth(day.serviceDate) });
        fields.push({ id: ids.day, value: utcDay(day.serviceDate) });

        // 산모 ①–⑤
        selectMany(ids.perineum, answers["perineum"]);
        selectMany(ids.breast, answers["breast"]);
        selectMany(ids.excretion, answers["excretion"]);
        selectOne(ids.sitzBath, answers["sitzBath"]);
        pushText(ids.meals, answers["meals_meal"]);
        pushText(ids.snack, answers["meals_snack"]);

        // 신생아 ⑥–⑪
        pushText(ids.temperature, answers["temperature_temp"]);
        selectOne(ids.sleep, answers["sleep"]);
        pushText(ids.breastFeedingCount, answers["breastFeeding_count"]);
        pushText(ids.formulaFeedingCount, answers["formulaFeeding_count"]);
        pushText(ids.formulaFeedingMl, answers["formulaFeeding_ml"]);
        selectOne(ids.stool, answers["stool"]);
        pushText(ids.stoolColor, answers["stool_color"]);
        selectOne(ids.bath, answers["bath"]);

        // 마무리
        pushText(ids.etcService, day.etcService);
        pushText(ids.notes, day.notes);
        pushCheck(ids.paymentConfirmed, day.paymentConfirmed === true);
        // 산모확인서명 N is a binary(서명) field, not a checkbox mark — the raw dataURI renders in the
        // PDF; "" satisfies the creation-step required check while leaving the mark blank.
        pushRequired(ids.momApproval, day.clientSignature ?? "");
    }

    return fields;
}
