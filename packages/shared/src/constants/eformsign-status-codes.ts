/**
 * Canonical eformsign document status-code buckets (M1: status-code drift).
 *
 * Investigated three existing copies before canonicalizing:
 *
 * 1. Backend — backend/application/services/eformsign-webhook.service.ts:90-91
 *    (duplicated verbatim in backend/application/services/eformsign-doc.service.ts:26-27):
 *      COMPLETED_STATUS_CODES = 003,012,022,032,050,062,072,092
 *      REJECTED_STATUS_CODES  = 011,021,031,040,042,045,047,049,061,071,080
 *    Backend additionally treats "090" ("철회"/withdrawn) as a same-bucket
 *    terminal-negative status: eformsign-webhook.service.ts:614 synthesizes
 *    `{ statusType: "090", statusDetail: "철회" }`, and
 *    backend/application/services/client.service.ts:26 groups it with the
 *    other revoke-family codes: `REVOKED_DOCUMENT_STATUS_TYPES = new Set(["040", "042", "045", "090"])`.
 *    "090" is not part of eformsign's own API status-code table — it is a
 *    backend-synthesized status — which is why neither frontend nor mobile
 *    (whose code sets are transcribed from the eformsign API docs) had it.
 *
 * 2. Frontend — frontend/src/lib/eformsign/status-codes.ts:10-34:
 *      COMPLETED_CODES = (same 8 as backend)
 *      EXPIRED_CODES   = 011,021,031,040,042,045,047,049,061,071,080
 *    Matches backend's REJECTED_STATUS_CODES exactly (including 047/049),
 *    but is missing "090".
 *
 * 3. Mobile — mobile/src/lib/eformsign/status-codes.ts:10-38:
 *      COMPLETED_CODES = (same 8 as backend)
 *      DELETED_CODES   = 047,049 (carved out into its own bucket —
 *        "Mobile keeps these hidden from the contracts UI", a UI-hiding
 *        concern specific to mobile's contracts list, not a semantic
 *        difference in what these codes mean)
 *      EXPIRED_CODES   = 011,021,031,040,042,045,061,071,080
 *    Missing 047/049 (moved to DELETED_CODES) and missing "090".
 *
 * Canonicalization decision:
 *   - COMPLETED_STATUS_CODES: no drift across all three sources — used as-is.
 *   - EXPIRED_STATUS_CODES: canonicalized to backend's semantics (backend is
 *     the source of truth for what "terminal/negative" means, since it also
 *     owns webhook ingestion) plus "090", per this task's explicit
 *     instruction ("정본 = backend 의미론 기준 + 090 포함").
 *   - 047/049 (doc_request_delete / doc_delete): kept IN the canonical
 *     EXPIRED_STATUS_CODES bucket. Backend and frontend agree on this (2 of
 *     3 sources); only mobile splits them out, and that split is a mobile
 *     UI-visibility concern (hiding fully-deleted docs from a list), not a
 *     disagreement about the underlying status semantics. Porting mobile's
 *     UI-hiding behavior is out of scope for this task (status-code SET
 *     canonicalization only) — a follow-up integration task can layer a
 *     mobile-specific "is this deleted" filter on top of this shared set
 *     without changing what "expired" means.
 */

export const COMPLETED_STATUS_CODES = [
    "003", // doc_complete: 문서 완료
    "012", // doc_accept_approval: 문서 결재 승인
    "022", // doc_accept_reception: 문서 내부자 승인
    "032", // doc_accept_outsider: 문서 외부자 승인
    "050", // PDF 전송
    "062", // doc_accept_participant: 참여자 승인
    "072", // doc_accept_reviewer: 검토자 승인
    "092", // 대면서명 완료
] as const;

export const EXPIRED_STATUS_CODES = [
    "011", // doc_reject_approval: 문서 결재 반려
    "021", // doc_reject_reception: 문서 내부자 반려
    "031", // doc_reject_outsider: 문서 외부자 반려
    "040", // doc_request_revoke: 문서 취소 요청
    "042", // doc_revoke: 문서 취소
    "045", // doc_request_reject: 문서 반려 요청
    "047", // doc_request_delete: 문서 삭제 요청
    "049", // doc_delete: 문서 삭제
    "061", // doc_reject_participant: 참여자 반려
    "071", // doc_reject_reviewer: 검토자 반려
    "080", // doc_expired: 문서 만료
    "090", // 철회 (backend-synthesized withdrawal status; see eformsign-webhook.service.ts:614)
] as const;

/**
 * Alias matching backend's naming (`REJECTED_STATUS_CODES`) for the same
 * set. Backend and frontend/mobile name this bucket differently
 * ("rejected" vs. "expired") for what is the same semantic bucket; both
 * names are exported so a follow-up integration task can import whichever
 * matches the call site it is replacing.
 */
export const REJECTED_STATUS_CODES = EXPIRED_STATUS_CODES;

export type CompletedStatusCode = (typeof COMPLETED_STATUS_CODES)[number];
export type ExpiredStatusCode = (typeof EXPIRED_STATUS_CODES)[number];

const PROVIDER_REVIEW_STEP_TYPES = new Set(["06"]);
const PROVIDER_REVIEW_OWNER_KEYWORDS = ["제공기관", "관리자", "담당자"];
const PROVIDER_REVIEW_ACTION_KEYWORDS = ["확인", "검토"];
const CUSTOMER_STEP_KEYWORDS = ["이용자", "고객", "산모"];

/**
 * True when the document's current workflow step is the provider's
 * review/confirmation step. Because that step only becomes current after the
 * customer has signed, this doubles as the "customer already signed" test for
 * in-progress documents — callers must first exclude completed/expired
 * documents, whose current step is no longer meaningful.
 *
 * Canonicalized from the byte-identical copies that lived in
 * frontend/src/lib/eformsign/status-codes.ts and
 * mobile/src/lib/eformsign/status-codes.ts; both now re-export this.
 */
export function isProviderReviewWorkflowStep(
    currentStatus: { step_type?: string | null; step_name?: string | null } | null | undefined,
): boolean {
    const stepType = currentStatus?.step_type?.trim() ?? "";
    const stepName = currentStatus?.step_name?.trim() ?? "";

    if (PROVIDER_REVIEW_STEP_TYPES.has(stepType)) return true;
    if (!stepName) return false;
    if (CUSTOMER_STEP_KEYWORDS.some((keyword) => stepName.includes(keyword))) return false;

    const hasProviderOwner = PROVIDER_REVIEW_OWNER_KEYWORDS.some((keyword) => stepName.includes(keyword));
    const hasReviewAction = PROVIDER_REVIEW_ACTION_KEYWORDS.some((keyword) => stepName.includes(keyword));
    return hasProviderOwner && hasReviewAction;
}
