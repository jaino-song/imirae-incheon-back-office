/**
 * eformsign field IDs for the 제공기록지 template ("서비스 제공기록지 단면", id f091d768…).
 *
 * The template is a fixed 5-session grid: header fields (no suffix) + per-session fields
 * suffixed " 1".." 5". `service_record` / `service_record_day` rows are mapped onto these ids
 * by `service-record-field-mapper.ts`. When a service has more than 5 sessions the finalize
 * usecase chunks them into ceil(N/5) documents, so a "slot" here is a 1..5 position WITHIN a
 * document, never the global sessionIndex.
 *
 * Field names, types, and step accessibility were captured live from
 * `GET /api/forms/{id}?is_include_config=true` (template version 4). Verified by a create+read
 * probe (Spike B): text and date fields prefill at creation regardless of step accessibility.
 */

/** Fixed number of session columns in the template; drives chunking. */
export const SERVICE_RECORD_TEMPLATE_SESSIONS_PER_DOCUMENT = 5;

/**
 * Multi-tier 제공기록지 templates (BJJ-multi-tier): each tier is a fixed N-session grid sharing
 * the same header + `serviceRecordDayFieldIds(n)` field-naming scheme, just with more slots. Only
 * tiers whose env var is actually set are usable — an unset env key means that tier's template
 * has not been deployed to this environment, so chunking must fall back to the tiers that are.
 * The 5-session tier is the base tier and its env key must stay backward-compatible.
 */
export const SERVICE_RECORD_TEMPLATE_TIER_ENV_KEYS: ReadonlyArray<{ tier: number; envKey: string }> = [
    { tier: 5, envKey: "EFORMSIGN_SERVICE_RECORD_TEMPLATE_ID" },
    { tier: 10, envKey: "EFORMSIGN_SERVICE_RECORD_TEMPLATE_ID_10" },
    { tier: 15, envKey: "EFORMSIGN_SERVICE_RECORD_TEMPLATE_ID_15" },
    { tier: 20, envKey: "EFORMSIGN_SERVICE_RECORD_TEMPLATE_ID_20" },
];

/**
 * Value that marks a selection field (결제 확인, and the ①–⑪ selection marks) as "selected".
 * 산모확인서명 N is NOT a checkbox mark — it is a binary(서명) field filled with a raw
 * `data:image/png;base64,...` dataURI by the mapper (see `serviceRecordDayFieldIds` below); this
 * constant does not apply to it.
 *
 * Per the eformsign API spec, 체크/라디오/콤보/토글 fields are filled by sending the ITEM's
 * configured '값' from the webform designer's 아이템 리스트 — not "true". Every mark item in
 * this template has its 값 set to "체크1" (verified live: sending "체크1" stores and renders the
 * mark; any other string is silently dropped). If the template's item values ever change in the
 * designer, this constant is the only place to update.
 */
export const CHECKBOX_CHECKED_VALUE = "체크1";
/**
 * Value for an explicitly-unchecked mark. Any string that matches NO item 값 leaves the mark
 * unselected while still satisfying the creation-step "required" presence check (verified live).
 */
export const CHECKBOX_UNCHECKED_VALUE = "false";

/**
 * Field bases that are REQUIRED at the creation step (제공업체) and therefore must be present in
 * every document's field list for all 5 slots — even slots with no session — or creation 400s
 * with "Required input value not found". Verified in Spike B. 결제 확인 is a checkbox mark
 * (see CHECKBOX_*_VALUE); 산모확인서명 is a binary(서명) field — an empty string "" satisfies the
 * required check while leaving the signature blank (verified live 2026-07-15).
 */
export const SERVICE_RECORD_REQUIRED_SLOT_FIELD_BASES = ["결제 확인", "산모확인서명"] as const;

/** Header fields (filled once per document, no slot suffix). */
export const SERVICE_RECORD_HEADER_FIELD_IDS = {
    providerName: "제공기관 이름",
    momName: "산모 이름",
    momBirth: "산모 생년월일", // date_yyyy-MM-dd
    deliveryNatural: "자연분만", // checkbox mark
    deliveryCSection: "제왕절개", // checkbox mark
    babyName: "신생아 이름",
    babyBirth: "신생아 출생일자", // date_yyyy-MM-dd
    babyWeight: "신생아 몸무게",
    employeeName: "제공인력 이름",
} as const;

/**
 * Per-slot field ids. `n` is the 1-based column position within a single document (1..5),
 * NOT the global session index. Selection groups are keyed by the form-layout option strings
 * (e.g. "잘 잠" with a space) so the mapper can look them up directly from `answers`.
 */
export function serviceRecordDayFieldIds(n: number) {
    return {
        month: `월 ${n}`, // date_MM  → "07"
        day: `일 ${n}`, // date_DD → "09"
        perineum: {
            열상: `회음절개부위 열상 ${n}`,
            혈종: `회음절개부위 혈종 ${n}`,
            불편감: `회음절개부위 불편감 ${n}`,
            이상없음: `회음절개부위 이상없음 ${n}`,
        } as Record<string, string>,
        breast: {
            울혈: `유방상태 울혈 ${n}`,
            통증: `유방상태 통증 ${n}`,
            이상없음: `유방상태 이상없음 ${n}`,
        } as Record<string, string>,
        excretion: {
            불편감: `배뇨배변 불편감 ${n}`,
            이상없음: `배뇨배변 이상없음 ${n}`,
        } as Record<string, string>,
        sitzBath: {
            실시: `좌욕 실시 ${n}`,
            미실시: `좌욕 미실시 ${n}`,
        } as Record<string, string>,
        meals: `식사 ${n}`,
        snack: `간식 ${n}`,
        temperature: `체온 ${n}`,
        sleep: {
            "잘 잠": `잘잠 ${n}`,
            "잘 못 잠": `잘못잠 ${n}`,
        } as Record<string, string>,
        breastFeedingCount: `모유수유횟수 ${n}`,
        formulaFeedingCount: `분유수유횟수 ${n}`,
        formulaFeedingMl: `분유수유ml ${n}`,
        stool: {
            정상변: `정상변 ${n}`,
            이상변: `이상변 ${n}`,
        } as Record<string, string>,
        stoolColor: `색깔 ${n}`,
        bath: {
            실시: `목욕제대관리 실시 ${n}`,
            미실시: `목욕제대관리 미실시 ${n}`,
        } as Record<string, string>,
        etcService: `기타서비스 ${n}`,
        notes: `특이사항 ${n}`,
        paymentConfirmed: `결제 확인 ${n}`, // required checkbox mark
        momApproval: `산모확인서명 ${n}`, // required binary(서명) field — dataURI value renders in the PDF; "" satisfies the required check
    };
}
