/**
 * eformsign 문서 표시명 추출 — frontend/mobile에 바이트 단위로 중복돼 있던
 * lib/eformsign/display-name.ts를 단일화한 것. 두 앱은 이 모듈을 re-export만 한다.
 */
export interface EformsignDisplayNameSource {
    document_name?: string | null;
    fields?: unknown;
    detail_template_info?: unknown;
    recipients?: unknown;
    histories?: unknown;
    previous_status?: unknown;
    next_status?: unknown;
}

type UnknownRecord = Record<string, unknown>;

export const UNKNOWN_CUSTOMER_NAME = "고객 미지정";

const GENERIC_CONTRACT_DOCUMENT_NAMES = new Set(["산모신생아건강관리서비스 계약서"]);

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

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function stringFromUnknown(value: unknown): string | null {
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

function valueFromFieldRecord(record: UnknownRecord): string | null {
  const valueKeys = ["value", "field_value", "fieldValue", "input_value", "inputValue", "data", "text"] as const;

  for (const key of valueKeys) {
    const value = stringFromUnknown(record[key]);
    if (value) return value;
  }

  for (const nested of collectRecords(record).slice(1)) {
    for (const key of valueKeys) {
      const value = stringFromUnknown(nested[key]);
      if (value) return value;
    }
  }

  return null;
}

function keyedFieldValue(source: unknown, normalizedIds: readonly string[]): string | null {
  for (const record of collectRecords(source)) {
    for (const [key, rawValue] of Object.entries(record)) {
      const normalizedKey = normalizeFieldId(key);
      const isNameKey = normalizedIds.some(
        (id) =>
          normalizedKey === id ||
          normalizedKey.includes(id) ||
          (canUseReverseContains(normalizedKey) && id.includes(normalizedKey)),
      );
      if (!isNameKey) continue;

      const directValue = stringFromUnknown(rawValue);
      if (directValue) return directValue;

      const nestedValue = valueFromFieldRecord({ value: rawValue });
      if (nestedValue) return nestedValue;
    }
  }

  return null;
}

function documentFieldValue(doc: EformsignDisplayNameSource, fieldIds: readonly string[]): string | null {
  const normalizedIds = fieldIds.map(normalizeFieldId);

  for (const source of [doc.fields, doc.detail_template_info]) {
    const keyedValue = keyedFieldValue(source, normalizedIds);
    if (keyedValue) return keyedValue;
  }

  for (const record of collectRecords(doc.fields)) {
    const idTokens = [
      stringFromUnknown(record.id),
      stringFromUnknown(record.field_id),
      stringFromUnknown(record.fieldId),
      stringFromUnknown(record.name),
      stringFromUnknown(record.label),
      stringFromUnknown(record.field_name),
      stringFromUnknown(record.fieldName),
      stringFromUnknown(record.display_name),
      stringFromUnknown(record.displayName),
      stringFromUnknown(record.input_id),
      stringFromUnknown(record.inputId),
    ].filter((value): value is string => Boolean(value));

    if (
      idTokens.some((token) => {
        const normalizedToken = normalizeFieldId(token);
        return normalizedIds.some(
          (id) =>
            normalizedToken === id ||
            normalizedToken.includes(id) ||
            (canUseReverseContains(normalizedToken) && id.includes(normalizedToken)),
        );
      })
    ) {
      const value = valueFromFieldRecord(record);
      if (value) return value;
    }
  }

  return null;
}

function isGenericContractDocumentName(value: string | undefined | null): boolean {
  const normalized = value?.replace(/\s+/g, " ").trim();
  return !normalized || GENERIC_CONTRACT_DOCUMENT_NAMES.has(normalized);
}

function hasCollectionValues(value: unknown): boolean {
  return Array.isArray(value) ? value.length > 0 : value != null;
}

export function mergeDocumentForDisplayData<T extends EformsignDisplayNameSource>(
  doc: T,
  detail?: T | null,
): T {
  if (!detail) return doc;

  return {
    ...doc,
    document_name: isGenericContractDocumentName(doc.document_name)
      ? detail.document_name || doc.document_name
      : doc.document_name,
    fields: hasCollectionValues(doc.fields) ? doc.fields : detail.fields,
    recipients: hasCollectionValues(doc.recipients) ? doc.recipients : detail.recipients,
    histories: hasCollectionValues(doc.histories) ? doc.histories : detail.histories,
    previous_status: hasCollectionValues(doc.previous_status) ? doc.previous_status : detail.previous_status,
    next_status: hasCollectionValues(doc.next_status) ? doc.next_status : detail.next_status,
    detail_template_info: hasCollectionValues(doc.detail_template_info)
      ? doc.detail_template_info
      : detail.detail_template_info,
  };
}

export function customerName(doc: EformsignDisplayNameSource): string {
  const fieldName = documentFieldValue(doc, CUSTOMER_NAME_FIELD_IDS);
  if (fieldName) return fieldName;

  return UNKNOWN_CUSTOMER_NAME;
}

export function contractDisplayName(
  doc: EformsignDisplayNameSource,
  includeSuffixOrMetadata?: unknown,
  maybeIncludeSuffix = false,
): string {
  const includeSuffix =
    typeof includeSuffixOrMetadata === "boolean" ? includeSuffixOrMetadata : maybeIncludeSuffix;
  const customer = customerName(doc);
  const base =
    customer !== UNKNOWN_CUSTOMER_NAME || isGenericContractDocumentName(doc.document_name)
      ? customer
      : doc.document_name || customer;
  if (!includeSuffix || base.endsWith("계약서")) return base;
  return `${base} 계약서`;
}
