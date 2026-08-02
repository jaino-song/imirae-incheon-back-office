import type { StatusBadgeVariant } from "../tokens/status-badge";

/**
 * 제공기록지 상태/서명 문서 상태의 표시 규칙 — frontend/mobile이 각자 들고 있던
 * switch 사본(ClientServiceRecordsTab / client-service-records)을 단일화한 것.
 * 두 앱은 여기서 label(+variant)만 읽어 표시한다.
 */
export interface ServiceRecordStatusMeta {
    label: string;
    variant: StatusBadgeVariant;
}

export const SERVICE_RECORD_STATUS_META: Record<string, ServiceRecordStatusMeta> = {
    WAITING_FOR_DETAILS: { label: "정보 대기", variant: "neutral" },
    WAITING_FOR_ASSIGNMENT: { label: "배정 대기", variant: "warning" },
    SCHEDULED: { label: "시작 전", variant: "primary" },
    IN_PROGRESS: { label: "작성 중", variant: "primary" },
    WAITING_FOR_END: { label: "종료 대기", variant: "success" },
    AWAITING_COMPLETION: { label: "기록 미완료", variant: "warning" },
    READY_TO_FINALIZE: { label: "문서 생성 대기", variant: "primary" },
    FINALIZING: { label: "문서 생성 중", variant: "primary" },
    DOCUMENTS_CREATED: { label: "기관 검토 중", variant: "success" },
    COMPLETED: { label: "완료", variant: "success" },
    FINALIZATION_FAILED: { label: "문서 생성 실패", variant: "danger" },
    TERMINATED_REVIEW_REQUIRED: { label: "중단 확인 필요", variant: "warning" },
    MIGRATION_REVIEW_REQUIRED: { label: "데이터 확인 필요", variant: "warning" },
};

export const SERVICE_RECORD_STATUS_FALLBACK_META: ServiceRecordStatusMeta = {
    label: "상태 확인",
    variant: "neutral",
};

export function getServiceRecordStatusMeta(status: string | null | undefined): ServiceRecordStatusMeta {
    return (status && SERVICE_RECORD_STATUS_META[status]) || SERVICE_RECORD_STATUS_FALLBACK_META;
}

/** 제공기록지 서명 문서(statusDetail 원문)의 표시 라벨. */
export function formatSignatureStatus(statusDetail: string): string {
    const normalized = statusDetail.trim().toLowerCase();
    if (!normalized) return "상태 확인";
    if (normalized.includes("complete")) return "서명 완료";
    if (normalized.includes("created")) return "발송됨";
    return statusDetail.trim();
}

export function getSignatureStatusVariant(
    statusDetail: string,
): "neutral" | "primary" | "success" | "warning" | "danger" {
    const normalized = statusDetail.trim().toLowerCase();
    if (normalized.includes("complete")) return "success";
    if (normalized.includes("reject") || normalized.includes("fail")) return "danger";
    if (normalized.includes("created")) return "primary";
    return "neutral";
}
