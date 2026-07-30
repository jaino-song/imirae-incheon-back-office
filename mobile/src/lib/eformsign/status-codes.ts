/**
 * Eformsign Document Status Codes
 * 
 * Based on: https://eformsignkr.github.io/developers/help/eformsign_api.html#current-status-status-type
 * 
 * These are 3-digit action codes from current_status.status_type
 */
import {
  COMPLETED_STATUS_CODES,
  EXPIRED_STATUS_CODES,
  isProviderReviewWorkflowStep,
} from "@babyjamjam/shared/constants/eformsign-status-codes";

export {
  COMPLETED_STATUS_CODES,
  EXPIRED_STATUS_CODES,
  isProviderReviewWorkflowStep,
} from "@babyjamjam/shared/constants/eformsign-status-codes";

// 완료 (Completed) codes
export const COMPLETED_CODES = COMPLETED_STATUS_CODES;

// 삭제됨 (Deleted) codes. Mobile keeps these hidden from the contracts UI.
export const DELETED_CODES = [
  "047", // doc_request_delete: 문서 삭제 요청
  "049", // doc_delete: 문서 삭제
  "099", // legacy backend webhook tombstone
] as const;

// 기간 만료/반려/취소 bucket codes
export const EXPIRED_CODES = EXPIRED_STATUS_CODES;

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
export type DocumentStatusLabel = "대기" | "검토 필요" | "완료" | "기간 만료" | "알 수 없음";
export type DocumentStatusCategory = "completed" | "expired" | "in-progress" | "unknown";

type EformsignWorkflowStatus = {
  status_type?: string | null;
  step_type?: string | null;
  step_name?: string | null;
  step_recipients?: Array<{ recipient_type?: string | null }>;
};

/**
 * Step-aware variant: when a doc is in-progress AND the current workflow step
 * is explicitly the provider review/confirmation step, it has progressed past
 * the customer's signature and is surfaced as "검토 필요" instead of "대기".
 */
export function mapDocStatusLabel(currentStatus: EformsignWorkflowStatus | null | undefined): DocumentStatusLabel {
  const base = mapStatusToLabel(currentStatus?.status_type);
  if (base !== "대기") return base;
  return isProviderReviewWorkflowStep(currentStatus) ? "검토 필요" : "대기";
}

// Filter types for API calls
export type DocumentFilterType = "in-progress" | "completed" | "expired" | "rejected" | null;

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
  if (!normalized) return "000";
  return STATUS_NAME_TO_CODE[normalized] ?? normalized.padStart(3, "0");
}

export function isDeletedStatusCode(statusCode: string | undefined | null): boolean {
  const normalized = normalizeStatusCode(statusCode);
  return DELETED_CODES.includes(normalized as typeof DELETED_CODES[number]);
}

/**
 * Get document status category from status code
 */
export function getStatusCategory(statusCode: string | undefined | null): DocumentStatusCategory {
  const normalized = normalizeStatusCode(statusCode);

  if (isDeletedStatusCode(normalized)) {
    return "unknown";
  }
  
  if (COMPLETED_CODES.includes(normalized as typeof COMPLETED_CODES[number])) {
    return "completed";
  }
  if (EXPIRED_CODES.includes(normalized as typeof EXPIRED_CODES[number])) {
    return "expired";
  }
  if (IN_PROGRESS_CODES.includes(normalized as typeof IN_PROGRESS_CODES[number])) {
    return "in-progress";
  }
  return "unknown";
}

/**
 * Map status code to Korean label
 */
export function mapStatusToLabel(statusCode: string | undefined | null): DocumentStatusLabel {
  const category = getStatusCategory(statusCode);
  
  switch (category) {
    case "completed":
      return "완료";
    case "expired":
      return "기간 만료";
    case "in-progress":
      return "대기";
    default:
      return "알 수 없음";
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

  if (lowerStatus.includes("완료") || lowerStatus.includes("complete") || lowerStatus.includes("signed")) {
    return "success";
  }
  if (lowerStatus.includes("대기") || lowerStatus.includes("pending") || lowerStatus.includes("진행")) {
    return "warning";
  }
  if (lowerStatus.includes("기간 만료") || lowerStatus.includes("만료") || lowerStatus.includes("expired") || lowerStatus.includes("reject")) {
    return "destructive";
  }
  if (lowerStatus.includes("전체") || lowerStatus.includes("all")) {
    return "secondary";
  }
  return "info";
}
