export const EFORMSIGN_COMPLETED_STATUS_CODES: ReadonlySet<string> = new Set([
    "003",
    "012",
    "022",
    "032",
    "050",
    "062",
    "072",
    "092",
]);

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
    ...EFORMSIGN_COMPLETED_STATUS_CODES,
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

/**
 * What may follow a review-stage code: a real terminal, the review request, or the other
 * review-stage code. The review stage is a cycle — a reviewer can reject (071) what a
 * participant accepted (062), and a corrected document can be accepted again after a
 * rejection — and the intermediate 070 is exactly the webhook a backfill exists to
 * reconcile. Only the earlier in-progress codes are genuinely backward from here.
 */
export const UNASSIGNED_FORWARD_STATUS_CODES_AFTER_REVIEW_STAGE = new Set<string>([
    ...UNASSIGNED_TERMINAL_STATUS_CODES,
    ...UNASSIGNED_REVIEW_STAGE_STATUS_CODES,
    "070",
]);

/** The one code that means the document passed its expiry date. */
export const EFORMSIGN_EXPIRED_STATUS_CODE = "080";

/**
 * What an ended document's status detail should read when the vendor did not supply one.
 * List responses carry no `status_doc_detail`, and the detail a document held while it
 * was open — "서명 요청됨" — is plainly wrong once it has finished; the UI renders this
 * string directly. Wording matches the webhook's own mapping so a row reads the same
 * however it was reconciled. Codes whose meaning is not unambiguous from the code alone
 * are deliberately absent: for those, keeping the stored detail beats inventing one.
 */
export const EFORMSIGN_TERMINAL_STATUS_DETAILS: Readonly<Record<string, string>> = {
    "003": "완료",
    "050": "완료",
    "061": "거부",
    "071": "검토 반려",
    "072": "검토 완료",
    "080": "만료",
    "090": "철회",
    "099": "삭제됨",
};
