/**
 * Eformsign Document Status Codes
 * 
 * Based on: https://eformsignkr.github.io/developers/help/eformsign_api.html#current-status-status-type
 * 
 * These are 3-digit action codes from current_status.status_type
 */

export {
  COMPLETED_STATUS_CODES as COMPLETED_CODES,
  EXPIRED_STATUS_CODES as EXPIRED_CODES,
  isProviderReviewWorkflowStep,
} from "@babyjamjam/shared/constants/eformsign-status-codes";

import {
  COMPLETED_STATUS_CODES as COMPLETED_CODES,
  EXPIRED_STATUS_CODES as EXPIRED_CODES,
  isProviderReviewWorkflowStep,
} from "@babyjamjam/shared/constants/eformsign-status-codes";
import {
  CONTRACT_DOC_DISPLAY_STATUS_LABELS,
  isContractDocDisplayStatus,
  isContractReviewWindowOpen,
  resolveContractDocStatusLabel,
  type ContractDocStatusLabel,
} from "@babyjamjam/shared/constants/eformsign-doc-status";

// 대기/진행 중 (In-progress) codes - for reference
export const IN_PROGRESS_CODES = [
  "001", // doc_tempsave: 초안
  "002", // doc_create: 문서 작성
  "010", // doc_request_approval: 문서 결재 요청
  "020", // doc_request_reception: 문서 내부자 요청
  "030", // doc_request_outsider: 문서 외부자 요청
  "043", // doc_update: 문서 수정
  "060", // doc_request_participant: 참여자 요청
  "063", // doc_rerequest_participant: 참여자 재요청(외부 수신자)
  "064", // doc_open_participant: 참여자 문서 열람(외부 수신자)
  "070", // doc_request_reviewer: 검토자 요청
] as const;

// Korean status labels
export type DocumentStatusLabel = ContractDocStatusLabel;

type EformsignWorkflowStatus = {
  status_type?: string | null;
  step_type?: string | null;
  step_name?: string | null;
  step_recipients?: Array<{ recipient_type?: string | null }>;
};

/**
 * Step-aware variant: when a doc is in-progress AND the current workflow step
 * is explicitly the provider review/confirmation step, the customer has signed.
 * That state reads 서명 완료 until the contract end date is within 1 business
 * day, when it flips to 검토 필요 (shared rule — see eformsign-doc-status).
 * Callers that cannot supply an end date get 검토 필요, the pre-date-rule
 * behavior.
 */
export function mapDocStatusLabel(
  currentStatus: EformsignWorkflowStatus | null | undefined,
  contractEndDate?: string | null,
  displayStatus?: string | null,
): DocumentStatusLabel {
  // The backend's serve-time display_status is authoritative when present.
  if (isContractDocDisplayStatus(displayStatus) && displayStatus !== "unknown") {
    return CONTRACT_DOC_DISPLAY_STATUS_LABELS[displayStatus];
  }
  return resolveContractDocStatusLabel({
    category: getStatusCategory(currentStatus?.status_type),
    currentStatus,
    contractEndDate: contractEndDate ?? null,
  });
}

/** Badge status token key for a contract document's display label. */
export function contractStatusBadgeType(
  label: DocumentStatusLabel,
): "pending" | "signed" | "review" | "completed" | "expired" {
  switch (label) {
    case "계약 완료":
      return "completed";
    case "기간 만료":
      return "expired";
    case "검토 필요":
      return "review";
    case "서명 완료":
      return "signed";
    default:
      return "pending";
  }
}

// Filter types for API calls
export type DocumentFilterType = "in-progress" | "completed" | "expired" | null;

const STATUS_NAME_TO_CODE: Record<string, string> = {
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

/**
 * Normalize status code to 3-digit format
 */
export function normalizeStatusCode(code: string | undefined | null): string {
  const normalized = code?.trim().toLowerCase();

  if (!normalized) {
    return "000";
  }

  return STATUS_NAME_TO_CODE[normalized] ?? normalized.padStart(3, "0");
}

/**
 * Get document status category from status code
 */
export function getStatusCategory(statusCode: string | undefined | null): "completed" | "expired" | "in-progress" {
  const normalized = normalizeStatusCode(statusCode);
  
  if (COMPLETED_CODES.includes(normalized as typeof COMPLETED_CODES[number])) {
    return "completed";
  }
  if (EXPIRED_CODES.includes(normalized as typeof EXPIRED_CODES[number])) {
    return "expired";
  }
  return "in-progress";
}

/**
 * Map status code to Korean label
 */
export function mapStatusToLabel(statusCode: string | undefined | null): DocumentStatusLabel {
  const category = getStatusCategory(statusCode);
  
  switch (category) {
    case "completed":
      return "계약 완료";
    case "expired":
      return "기간 만료";
    default:
      return "대기";
  }
}

/**
 * Badge variant type for shadcn Badge component
 */
export type BadgeVariant = "success" | "warning" | "destructive" | "info" | "secondary" | "default";

/**
 * Get Badge variant for status (shadcn Badge compatible)
 */
export function getStatusColor(status: string): BadgeVariant {
  const lowerStatus = status.toLowerCase();

  if (lowerStatus.includes("서명 완료")) {
    return "info";
  }
  if (lowerStatus.includes("완료") || lowerStatus.includes("complete") || lowerStatus.includes("signed")) {
    return "success";
  }
  if (lowerStatus.includes("대기") || lowerStatus.includes("pending") || lowerStatus.includes("진행")) {
    return "warning";
  }
  if (lowerStatus.includes("기간 만료") || lowerStatus.includes("거부") || lowerStatus.includes("reject") || lowerStatus.includes("expired")) {
    return "destructive";
  }
  if (lowerStatus.includes("전체") || lowerStatus.includes("all")) {
    return "secondary";
  }
  return "info";
}

/** The StatsBar counters on the contracts page. */
export interface ContractStatsBuckets {
  reviewNeeded: number;
  signed: number;
  sendRequired: number;
  drafting: number;
  expired: number;
}

/**
 * Fold the raw status signals from `GET /api/documents/status-counts` into the
 * four StatsBar buckets. This is the single source of truth for that mapping —
 * it mirrors the per-doc rule that used to live in contracts/page.tsx:
 *   - completed (003 등)           → counted nowhere
 *   - expired category, only 080   → expired (반려/취소 등은 제외)
 *   - draft (001)                  → drafting
 *   - 그 외 in-progress            → 현재 단계가 제공기관 검토/확인이면
 *                                     검토 창(종료일 영업일 1일 전~) 열림 여부에 따라
 *                                     reviewNeeded 또는 signed, 아니면 sendRequired
 * The reviewNeeded/signed test mirrors `mapDocStatusLabel` using the current
 * workflow step fields and contract end date returned by the status-counts
 * endpoint.
 */
export function foldContractStats(
  docs: ReadonlyArray<{
    status_type?: string | null;
    step_type?: string | null;
    step_name?: string | null;
    step_recipient_types?: ReadonlyArray<string | null>;
    contract_end_date?: string | null;
    display_status?: string | null;
  }>,
): ContractStatsBuckets {
  const buckets: ContractStatsBuckets = { reviewNeeded: 0, signed: 0, sendRequired: 0, drafting: 0, expired: 0 };
  for (const doc of docs) {
    const normalized = normalizeStatusCode(doc.status_type);
    const category = getStatusCategory(doc.status_type);

    if (category === "completed") continue;
    if (category === "expired") {
      if (normalized === "080") buckets.expired++;
      continue;
    }
    if (normalized === "001") {
      buckets.drafting++;
      continue;
    }

    if (!isProviderReviewWorkflowStep(doc)) {
      buckets.sendRequired++;
      continue;
    }
    // The backend's serve-time display_status decides the split when present.
    const isReviewDue = isContractDocDisplayStatus(doc.display_status)
      ? doc.display_status === "review"
      : isContractReviewWindowOpen(doc.contract_end_date);
    if (isReviewDue) buckets.reviewNeeded++;
    else buckets.signed++;
  }
  return buckets;
}
