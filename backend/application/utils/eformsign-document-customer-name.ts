export type UnknownRecord = Record<string, unknown>;

const CUSTOMER_NAME_FIELD_IDS = [
    "이용자 성명",
    "이용자성명",
    "고객 성명",
    "고객성명",
    "고객명",
    "산모 성명",
    "산모성명",
    "산모명",
    "성명",
    "customerName",
    "clientName",
    "userName",
] as const;

const FIELD_VALUE_KEYS = [
    "value",
    "field_value",
    "fieldValue",
    "input_value",
    "inputValue",
    "data",
    "text",
] as const;

interface EformsignCustomerNameSource {
    fields?: unknown;
    detail_template_info?: unknown;
}

export function isRecord(value: unknown): value is UnknownRecord {
    return typeof value === "object" && value !== null;
}

export function stringFromUnknown(value: unknown): string | null {
    if (typeof value === "string") {
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : null;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
        return String(value);
    }
    return null;
}

function collectRecords(value: unknown, depth = 0): UnknownRecord[] {
    if (depth > 6 || value == null) return [];
    if (Array.isArray(value)) return value.flatMap((item) => collectRecords(item, depth + 1));
    if (!isRecord(value)) return [];
    return [value, ...Object.values(value).flatMap((item) => collectRecords(item, depth + 1))];
}

function normalizeFieldId(value: string): string {
    return value.replace(/[\s_\-:/.()[\]{}]+/g, "").toLowerCase();
}

function canUseReverseContains(value: string): boolean {
    return /^[a-z0-9]+$/.test(value) && value.length >= 5;
}

function isCustomerNameKey(key: string): boolean {
    const normalizedKey = normalizeFieldId(key);
    return CUSTOMER_NAME_FIELD_IDS.map(normalizeFieldId).some(
        (id) =>
            normalizedKey === id ||
            normalizedKey.includes(id) ||
            (canUseReverseContains(normalizedKey) && id.includes(normalizedKey)),
    );
}

function valueFromFieldRecord(record: UnknownRecord): string | null {
    for (const key of FIELD_VALUE_KEYS) {
        const value = stringFromUnknown(record[key]);
        if (value) return value;
    }
    for (const nested of collectRecords(record).slice(1)) {
        for (const key of FIELD_VALUE_KEYS) {
            const value = stringFromUnknown(nested[key]);
            if (value) return value;
        }
    }
    return null;
}

export function documentCustomerNameValue(
    doc: EformsignCustomerNameSource,
): string | null {
    for (const source of [doc.fields, doc.detail_template_info]) {
        for (const record of collectRecords(source)) {
            for (const [key, rawValue] of Object.entries(record)) {
                if (!isCustomerNameKey(key)) continue;
                const value = stringFromUnknown(rawValue) ?? valueFromFieldRecord({ value: rawValue });
                if (value) {
                    return value;
                }
            }
        }
    }

    for (const record of collectRecords(doc.fields)) {
        const idTokens = [
            stringFromUnknown(record["id"]),
            stringFromUnknown(record["field_id"]),
            stringFromUnknown(record["fieldId"]),
            stringFromUnknown(record["name"]),
            stringFromUnknown(record["label"]),
            stringFromUnknown(record["field_name"]),
            stringFromUnknown(record["fieldName"]),
            stringFromUnknown(record["display_name"]),
            stringFromUnknown(record["displayName"]),
            stringFromUnknown(record["input_id"]),
            stringFromUnknown(record["inputId"]),
        ].filter((value): value is string => Boolean(value));

        if (idTokens.some(isCustomerNameKey)) {
            const value = valueFromFieldRecord(record);
            if (value) {
                return value;
            }
        }
    }

    return null;
}
