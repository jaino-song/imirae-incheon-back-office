import { Prisma } from "@prisma/client";

import {
    documentCustomerNameValue,
    isRecord,
    stringFromUnknown,
    UnknownRecord,
} from "application/utils/eformsign-document-customer-name";
import { normalizePhone } from "application/utils/normalize-phone";
import { EformsignApiDocumentResponse } from "domain/repositories/eformsign.client.interface";

export interface EformsignContractClientCandidate {
    name: string;
    phone: string;
    address: string | null;
    birthday: string | null;
    dueDate: Date | null;
    startDate: Date | null;
    endDate: Date | null;
    type: string | null;
    duration: number | null;
    fullPrice: string | null;
    grant: string | null;
    actualPrice: string | null;
    careCenter: boolean | null;
    voucherClient: boolean;
    breastPump: boolean;
    primaryProviderName: string | null;
    primaryProviderPhone: string | null;
    secondaryProviderName: string | null;
    secondaryProviderPhone: string | null;
}

export interface EformsignContractClientPrefillCandidate
    extends Omit<EformsignContractClientCandidate, "phone"> {
    phone: string | null;
    primaryProviderName: string | null;
    primaryProviderPhone: string | null;
    secondaryProviderName: string | null;
    secondaryProviderPhone: string | null;
}

export function toEformsignDocumentDetail(
    value: Prisma.JsonValue | null,
): EformsignApiDocumentResponse | null {
    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? (value as unknown as EformsignApiDocumentResponse)
        : null;
}

const FIELD_ID_KEYS = [
    "id",
    "field_id",
    "fieldId",
    "name",
    "label",
    "field_name",
    "fieldName",
    "display_name",
    "displayName",
    "input_id",
    "inputId",
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

const RECIPIENT_NAME_KEYS = [
    "name",
    "recipient_name",
    "recipientName",
] as const;

const RECIPIENT_PHONE_KEYS = [
    "sms",
    "phone",
    "phone_number",
    "phoneNumber",
    "mobile",
    "mobile_number",
    "mobileNumber",
] as const;

const CUSTOMER_PHONE_FIELD_IDS = [
    "이용자 연락처",
    "이용자연락처",
    "고객 연락처",
    "고객연락처",
    "산모 연락처",
    "산모연락처",
    "customerContact",
    "customerPhone",
    "clientPhone",
    "userPhone",
] as const;

// Auto-registration must not trust the generic "성명" fallback used by list
// presentation. A contract can contain provider, manager, and staff names as
// well; only fields that explicitly identify the customer are safe here.
const CUSTOMER_QUALIFIED_NAME_FIELD_IDS = [
    "이용자 성명",
    "이용자성명",
    "고객 성명",
    "고객성명",
    "고객명",
    "산모 성명",
    "산모성명",
    "산모명",
    "customerName",
    "clientName",
    "userName",
] as const;

const NON_CUSTOMER_NAME_FIELD_MARKERS = [
    "제공",
    "기관",
    "직원",
    "관리사",
    "담당",
    "작성",
    "staff",
    "provider",
    "employee",
    "manager",
] as const;

function collectRecords(value: unknown, depth = 0): UnknownRecord[] {
    if (depth > 6 || value == null) return [];
    if (Array.isArray(value)) {
        return value.flatMap((item) => collectRecords(item, depth + 1));
    }
    if (!isRecord(value)) return [];
    return [
        value,
        ...Object.values(value).flatMap((item) => collectRecords(item, depth + 1)),
    ];
}

function normalizeFieldId(value: string): string {
    return value.replace(/[\s_\-:/.()[\]{}]+/g, "").toLowerCase();
}

function valueFromFieldRecord(record: UnknownRecord): string | null {
    for (const key of FIELD_VALUE_KEYS) {
        const value = stringFromUnknown(record[key]);
        if (value) return value;
    }
    return null;
}

function valueFromCustomerNameField(rawValue: unknown): string | null {
    const directValue = stringFromUnknown(rawValue);
    if (directValue) return directValue;

    for (const record of collectRecords(rawValue)) {
        const value = valueFromFieldRecord(record);
        if (value) return value;
    }
    return null;
}

function fieldIdMatches(token: string, aliases: readonly string[]): boolean {
    const normalizedToken = normalizeFieldId(token);
    return aliases.some((alias) => {
        const normalizedAlias = normalizeFieldId(alias);
        if (normalizedToken === normalizedAlias) return true;
        // Short labels such as "주소" or "연락처" must not match provider fields.
        if (normalizedAlias.length < 5) return false;
        return normalizedToken.includes(normalizedAlias)
            || normalizedAlias.includes(normalizedToken);
    });
}

function hasNonCustomerNameFieldMarker(token: string): boolean {
    const normalizedToken = normalizeFieldId(token);
    return NON_CUSTOMER_NAME_FIELD_MARKERS.some((marker) =>
        normalizedToken.includes(normalizeFieldId(marker)),
    );
}

function isCustomerQualifiedNameField(token: string): boolean {
    const normalizedToken = normalizeFieldId(token);
    if (hasNonCustomerNameFieldMarker(token)) return false;
    return CUSTOMER_QUALIFIED_NAME_FIELD_IDS.some((alias) => {
        const normalizedAlias = normalizeFieldId(alias);
        // Do not reverse-match a short generic token such as "성명" into a
        // qualified alias. Template suffixes remain supported by matching the
        // full customer alias within the field id.
        return normalizedToken === normalizedAlias
            || normalizedToken.includes(normalizedAlias);
    });
}

function contractCustomerNameValue(
    document: EformsignApiDocumentResponse,
): string | null {
    for (const source of [document.fields, document.detail_template_info]) {
        for (const record of collectRecords(source)) {
            for (const [key, rawValue] of Object.entries(record)) {
                if (!isCustomerQualifiedNameField(key)) continue;
                const value = valueFromCustomerNameField(rawValue);
                if (value) return value;
            }

            const tokens = FIELD_ID_KEYS
                .map((key) => stringFromUnknown(record[key]))
                .filter((value): value is string => Boolean(value));
            if (
                !tokens.some(hasNonCustomerNameFieldMarker)
                && tokens.some(isCustomerQualifiedNameField)
            ) {
                const value = valueFromFieldRecord(record);
                if (value) return value;
            }
        }
    }
    return null;
}

export function eformsignDocumentFieldValue(
    document: EformsignApiDocumentResponse,
    aliases: readonly string[],
): string | null {
    for (const source of [document.fields, document.detail_template_info]) {
        for (const record of collectRecords(source)) {
            const tokens = FIELD_ID_KEYS
                .map((key) => stringFromUnknown(record[key]))
                .filter((value): value is string => Boolean(value));
            if (tokens.some((token) => fieldIdMatches(token, aliases))) {
                const value = valueFromFieldRecord(record);
                if (value) return value;
            }
        }
    }
    return null;
}

function recipientPhoneCandidates(
    document: EformsignApiDocumentResponse,
    customerName: string,
): string[] {
    const exactNameMatches = new Set<string>();
    const participantMatches = new Set<string>();
    const sources: unknown[] = [
        document.recipients,
        document.current_status?.step_recipients,
        document.previous_status,
        document.histories,
        document.next_status,
    ];

    for (const record of sources.flatMap((source) => collectRecords(source))) {
        const recipientName = RECIPIENT_NAME_KEYS
            .map((key) => stringFromUnknown(record[key]))
            .find(Boolean);
        const recipientType = stringFromUnknown(record["recipient_type"])
            ?? stringFromUnknown(record["recipientType"])
            ?? stringFromUnknown(record["step_type"])
            ?? stringFromUnknown(record["stepType"]);
        const phones = RECIPIENT_PHONE_KEYS
            .map((key) => normalizePhone(stringFromUnknown(record[key])))
            .filter((phone): phone is string => Boolean(phone));

        if (recipientName?.trim() === customerName.trim()) {
            phones.forEach((phone) => exactNameMatches.add(phone));
        }
        if (recipientType === "02" || recipientType === "05") {
            phones.forEach((phone) => participantMatches.add(phone));
        }
    }

    if (exactNameMatches.size > 0) {
        return [...exactNameMatches];
    }
    return [...participantMatches];
}

export function eformsignCustomerPhone(
    document: EformsignApiDocumentResponse,
    customerName = documentCustomerNameValue(document),
): string | null {
    if (!customerName) return null;

    const recipientPhones = recipientPhoneCandidates(document, customerName);
    const fieldPhone = normalizePhone(
        eformsignDocumentFieldValue(document, CUSTOMER_PHONE_FIELD_IDS),
    );
    if (recipientPhones.length === 1) {
        return recipientPhones[0]!;
    }
    if (recipientPhones.length > 1) {
        return fieldPhone && recipientPhones.includes(fieldPhone)
            ? fieldPhone
            : null;
    }
    // The current contract template's "이용자 연락처" input is populated with
    // the issuing staff member's number. A field-only phone is therefore not a
    // safe identity key; require recipient history that identifies the customer.
    return null;
}

function digits(value: string | null): string | null {
    const normalized = value?.replace(/\D/g, "") ?? "";
    return normalized.length > 0 ? normalized : null;
}

function amount(value: string | null): string | null {
    return digits(value);
}

function positiveInteger(value: string | null): number | null {
    const normalized = digits(value);
    if (!normalized) return null;
    const parsed = Number(normalized);
    return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 366
        ? parsed
        : null;
}

function birthday(value: string | null): string | null {
    const normalized = digits(value);
    if (!normalized) return null;
    if (normalized.length === 6) return normalized;
    if (normalized.length >= 8) return normalized.slice(2, 8);
    return null;
}

function validUtcDate(year: number, month: number, day: number): Date | null {
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
        date.getUTCFullYear() !== year
        || date.getUTCMonth() !== month - 1
        || date.getUTCDate() !== day
    ) {
        return null;
    }
    return date;
}

function dateValue(value: string | null): Date | null {
    const normalized = digits(value);
    if (!normalized) return null;
    const yyyymmdd = normalized.length === 6
        ? `20${normalized}`
        : normalized.slice(0, 8);
    if (yyyymmdd.length !== 8) return null;
    return validUtcDate(
        Number(yyyymmdd.slice(0, 4)),
        Number(yyyymmdd.slice(4, 6)),
        Number(yyyymmdd.slice(6, 8)),
    );
}

function dateFromParts(
    document: EformsignApiDocumentResponse,
    aliases: {
        year: readonly string[];
        month: readonly string[];
        day: readonly string[];
    },
): Date | null {
    const yearDigits = digits(eformsignDocumentFieldValue(document, aliases.year));
    const monthDigits = digits(eformsignDocumentFieldValue(document, aliases.month));
    const dayDigits = digits(eformsignDocumentFieldValue(document, aliases.day));
    if (!yearDigits || !monthDigits || !dayDigits) return null;
    const year = yearDigits.length === 2 ? Number(`20${yearDigits}`) : Number(yearDigits);
    return validUtcDate(year, Number(monthDigits), Number(dayDigits));
}

/**
 * The contract end date carried in the document's own fields — explicit end-date
 * field, year/month/day parts, or the tail of a 계약 기간 range, in that order.
 * Shared by the client-candidate extractor and the document-list enrichment so
 * both read the same date from the same aliases.
 */
export function extractEformsignContractEndDate(
    document: EformsignApiDocumentResponse,
): Date | null {
    return dateValue(eformsignDocumentFieldValue(document, [
        "계약 종료일",
        "계약종료일",
        "서비스 종료일",
        "서비스종료일",
        "endDate",
        "contractEndDate",
    ])) ?? dateFromParts(document, {
        year: ["계약 종료 년도", "계약종료년도", "서비스 종료 년도", "endYear"],
        month: ["계약 종료 월", "계약종료월", "서비스 종료 월", "endMonth"],
        day: ["계약 종료 일", "계약종료일", "서비스 종료 일", "endDay"],
    }) ?? contractPeriodDates(document)[1];
}

function contractPeriodDates(
    document: EformsignApiDocumentResponse,
): [Date | null, Date | null] {
    const period = eformsignDocumentFieldValue(document, [
        "계약 기간",
        "계약기간",
        "서비스 기간",
        "서비스기간",
        "contractPeriod",
        "servicePeriod",
    ]);
    const matches = period?.match(/\d{2,4}\D*\d{1,2}\D*\d{1,2}/g) ?? [];
    return [dateValue(matches[0] ?? null), dateValue(matches[1] ?? null)];
}

function booleanValue(value: string | null): boolean | null {
    if (!value) return null;
    const normalized = value.trim().toLowerCase();
    if (["true", "yes", "y", "1", "예", "네", "사용", "이용", "체크", "✓", "v"].includes(normalized)) {
        return true;
    }
    if (["false", "no", "n", "0", "아니오", "아니요", "미사용", "미이용"].includes(normalized)) {
        return false;
    }
    return null;
}

export function extractEformsignContractClientPrefillCandidate(
    document: EformsignApiDocumentResponse,
): EformsignContractClientPrefillCandidate | null {
    const name = contractCustomerNameValue(document);
    if (!name || name === "고객 미지정" || name === "수신자") return null;
    const phone = eformsignCustomerPhone(document, name);

    const [periodStartDate] = contractPeriodDates(document);
    const startDate = dateValue(eformsignDocumentFieldValue(document, [
        "계약 시작일",
        "계약시작일",
        "서비스 시작일",
        "서비스시작일",
        "startDate",
        "contractStartDate",
    ])) ?? dateFromParts(document, {
        year: ["계약 시작 년도", "계약시작년도", "서비스 시작 년도", "startYear"],
        month: ["계약 시작 월", "계약시작월", "서비스 시작 월", "startMonth"],
        day: ["계약 시작 일", "계약시작일", "서비스 시작 일", "startDay"],
    }) ?? periodStartDate;
    const endDate = extractEformsignContractEndDate(document);
    const type = eformsignDocumentFieldValue(document, [
        "바우처 유형",
        "바우처유형",
        "서비스 유형",
        "서비스유형",
        "voucherType",
        "serviceType",
    ]);
    const grant = amount(eformsignDocumentFieldValue(document, [
        "정부지원금",
        "지원금",
        "grant",
    ]));
    const voucherFlag = booleanValue(eformsignDocumentFieldValue(document, [
        "바우처 여부",
        "바우처여부",
        "voucherClient",
    ]));

    return {
        name,
        phone,
        primaryProviderName: eformsignDocumentFieldValue(document, [
            "제공인력 1 성명",
            "제공인력1성명",
            "주 제공인력 성명",
            "주제공인력성명",
            "primaryProviderName",
        ]),
        primaryProviderPhone: normalizePhone(eformsignDocumentFieldValue(document, [
            "제공인력 1 연락처",
            "제공인력1연락처",
            "주 제공인력 연락처",
            "주제공인력연락처",
            "primaryProviderPhone",
        ])),
        secondaryProviderName: eformsignDocumentFieldValue(document, [
            "제공인력 2 성명",
            "제공인력2성명",
            "보조 제공인력 성명",
            "보조제공인력성명",
            "secondaryProviderName",
        ]),
        secondaryProviderPhone: normalizePhone(eformsignDocumentFieldValue(document, [
            "제공인력 2 연락처",
            "제공인력2연락처",
            "보조 제공인력 연락처",
            "보조제공인력연락처",
            "secondaryProviderPhone",
        ])),
        address: eformsignDocumentFieldValue(document, [
            "이용자 주소",
            "이용자주소",
            "고객 주소",
            "고객주소",
            "산모 주소",
            "산모주소",
            "customerAddress",
            "clientAddress",
        ]),
        birthday: birthday(eformsignDocumentFieldValue(document, [
            "이용자 생년월일",
            "이용자생년월일",
            "고객 생년월일",
            "고객생년월일",
            "산모 생년월일",
            "산모생년월일",
            "주민번호 앞자리",
            "customerDOB",
            "customerBirthDate",
            "birthday",
        ])),
        dueDate: dateValue(eformsignDocumentFieldValue(document, [
            "출산 예정일",
            "출산예정일",
            "dueDate",
            "expectedBirthDate",
        ])),
        startDate,
        endDate,
        type,
        duration: positiveInteger(eformsignDocumentFieldValue(document, [
            "바우처 기간",
            "바우처기간",
            "서비스 기간",
            "서비스기간",
            "서비스 일수",
            "서비스일수",
            "계약 일수",
            "계약일수",
            "days",
            "duration",
            "contractDuration",
        ])),
        fullPrice: amount(eformsignDocumentFieldValue(document, [
            "총 서비스 금액",
            "총서비스금액",
            "서비스 비용",
            "서비스비용",
            "서비스 가격",
            "서비스가격",
            "서비스 총액",
            "서비스총액",
            "fullPrice",
        ])),
        grant,
        actualPrice: amount(eformsignDocumentFieldValue(document, [
            "본인부담금",
            "실결제금액",
            "actualPrice",
        ])),
        careCenter: booleanValue(eformsignDocumentFieldValue(document, [
            "산후조리원 이용",
            "산후조리원이용",
            "조리원 이용",
            "조리원이용",
            "careCenter",
        ])),
        voucherClient: voucherFlag ?? Boolean(type || (grant && Number(grant) > 0)),
        breastPump: booleanValue(eformsignDocumentFieldValue(document, [
            "유축기",
            "유축기 대여",
            "유축기대여",
            "breastPump",
        ])) ?? false,
    };
}

/**
 * 자동 연결용 후보는 고객 수신자로 검증된 전화번호까지 있어야 한다.
 * 등록 폼 프리필은 전화번호가 없어도 다른 전자문서 필드를 보존한다.
 */
export function extractEformsignContractClientCandidate(
    document: EformsignApiDocumentResponse,
): EformsignContractClientCandidate | null {
    const candidate = extractEformsignContractClientPrefillCandidate(document);
    if (!candidate?.phone) return null;
    return {
        name: candidate.name,
        phone: candidate.phone,
        address: candidate.address,
        birthday: candidate.birthday,
        dueDate: candidate.dueDate,
        startDate: candidate.startDate,
        endDate: candidate.endDate,
        type: candidate.type,
        duration: candidate.duration,
        fullPrice: candidate.fullPrice,
        grant: candidate.grant,
        actualPrice: candidate.actualPrice,
        careCenter: candidate.careCenter,
        voucherClient: candidate.voucherClient,
        breastPump: candidate.breastPump,
        primaryProviderName: candidate.primaryProviderName,
        primaryProviderPhone: candidate.primaryProviderPhone,
        secondaryProviderName: candidate.secondaryProviderName,
        secondaryProviderPhone: candidate.secondaryProviderPhone,
    };
}

export function formatNormalizedKoreanPhone(phone: string): string {
    if (phone.length === 11) {
        return `${phone.slice(0, 3)}-${phone.slice(3, 7)}-${phone.slice(7)}`;
    }
    if (phone.startsWith("02") && phone.length === 10) {
        return `${phone.slice(0, 2)}-${phone.slice(2, 6)}-${phone.slice(6)}`;
    }
    if (phone.length === 10) {
        return `${phone.slice(0, 3)}-${phone.slice(3, 6)}-${phone.slice(6)}`;
    }
    return phone;
}
