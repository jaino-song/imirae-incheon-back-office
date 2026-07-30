const STATUS_NAME_TO_CODE: Readonly<Record<string, string>> = {
    doc_tempsave: "001",
    doc_create: "002",
    doc_complete: "003",
    doc_request_approval: "010",
    doc_reject_approval: "011",
    doc_accept_approval: "012",
    doc_request_reception: "020",
    doc_reject_reception: "021",
    doc_accept_reception: "022",
    doc_request_outsider: "030",
    doc_reject_outsider: "031",
    doc_accept_outsider: "032",
    doc_request_revoke: "040",
    doc_revoke: "042",
    doc_update: "043",
    doc_request_reject: "045",
    doc_request_delete: "047",
    doc_delete: "049",
    doc_request_participant: "060",
    doc_reject_participant: "061",
    doc_accept_participant: "062",
    doc_rerequest_participant: "063",
    doc_open_participant: "064",
    doc_request_reviewer: "070",
    doc_reject_reviewer: "071",
    doc_accept_reviewer: "072",
    doc_expired: "080",
    face_signature_complete: "092",
};

function normalizeEformsignCode(
    code: string | number | null | undefined,
    width: number,
): string {
    const normalized = String(code ?? "").trim().toLowerCase();
    return normalized ? normalized.padStart(width, "0") : "";
}

export function normalizeEformsignStatusCode(
    statusType: string | number | null | undefined,
): string {
    const normalized = normalizeEformsignCode(statusType, 3);
    if (!normalized) {
        return "000";
    }

    return STATUS_NAME_TO_CODE[normalized] ?? normalized;
}

export function normalizeEformsignStepType(
    stepType: string | number | null | undefined,
): string {
    return normalizeEformsignCode(stepType, 2);
}

const PROVIDER_REVIEW_STEP_TYPES = new Set(["06"]);
const PROVIDER_REVIEW_OWNER_KEYWORDS = ["제공기관", "관리자", "담당자"];
const PROVIDER_REVIEW_ACTION_KEYWORDS = ["확인", "검토"];
const CUSTOMER_STEP_KEYWORDS = ["이용자", "고객", "산모"];

/**
 * True when the document's current workflow step is the provider's
 * review/confirmation step. That step only becomes current after the customer
 * has signed, so it doubles as the "customer already signed" test for
 * in-progress documents — callers must first exclude completed/rejected/
 * revoked/deleted documents, whose current step is no longer meaningful.
 *
 * Mirrors `isProviderReviewWorkflowStep` in
 * packages/shared/src/constants/eformsign-status-codes.ts (the frontend/mobile
 * canonical copy), transposed to this package's camelCase field naming. The
 * backend keeps its own copy for the same reason it keeps its own status-code
 * table: it does not depend on @babyjamjam/shared.
 */
export function isProviderReviewWorkflowStep(
    step: { stepType?: string | null; stepName?: string | null } | null | undefined,
): boolean {
    const stepType = normalizeEformsignStepType(step?.stepType);
    const stepName = step?.stepName?.trim() ?? "";

    if (PROVIDER_REVIEW_STEP_TYPES.has(stepType)) return true;
    if (!stepName) return false;
    if (CUSTOMER_STEP_KEYWORDS.some((keyword) => stepName.includes(keyword))) return false;

    const hasProviderOwner = PROVIDER_REVIEW_OWNER_KEYWORDS.some((keyword) => stepName.includes(keyword));
    const hasReviewAction = PROVIDER_REVIEW_ACTION_KEYWORDS.some((keyword) => stepName.includes(keyword));
    return hasProviderOwner && hasReviewAction;
}
