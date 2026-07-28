const COMPLETED_STATUS_CODES = [
    "003",
    "012",
    "022",
    "032",
    "050",
    "062",
    "072",
    "092",
] as const;

const REJECTED_STATUS_CODES = [
    "011",
    "021",
    "031",
    "040",
    "042",
    "045",
    "047",
    "049",
    "061",
    "071",
    "080",
] as const;

// "090"(철회)·"099"(삭제됨)은 웹훅 상태 매핑이 합성해 영속화하는 종료 코드다.
export const TERMINAL_STATUS_CODES = new Set<string>([
    ...COMPLETED_STATUS_CODES,
    ...REJECTED_STATUS_CODES,
    "090",
    "099",
]);

// 미배정 문서는 이용자 서명 완료(062) 뒤 제공기관 검토(070)로 진행할 수 있다.
/**
 * Codes that end the reviewer stage but not the document: 062 is participant acceptance
 * and 071 is a reviewer rejection, and a review request or re-request legitimately
 * follows either. Treating them as terminal freezes a mirrored row forever — nothing
 * re-mirrors a document that already has a local row.
 */
export const UNASSIGNED_REVIEW_STAGE_STATUS_CODES = new Set<string>(["062", "071"]);

export const UNASSIGNED_TERMINAL_STATUS_CODES = new Set<string>(
    [...TERMINAL_STATUS_CODES].filter(
        (statusCode) => !UNASSIGNED_REVIEW_STAGE_STATUS_CODES.has(statusCode),
    ),
);

/** What may follow a review-stage code: the real terminals, or the review request. */
export const UNASSIGNED_FORWARD_STATUS_CODES_AFTER_REVIEW_STAGE = new Set<string>([
    ...UNASSIGNED_TERMINAL_STATUS_CODES,
    "070",
]);
