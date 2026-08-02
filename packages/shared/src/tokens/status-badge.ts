export type ClientBadgeKey = "contract_required" | "breast_pump" | "service_status" | "care_center";

export type ClientBadgeStatus =
    | "active"
    | "preBooking"
    | "pending"
    | "review"
    | "scheduleChange"
    | "terminated"
    | "expired"
    | "completed"
    | "signed"
    | "breastPump"
    | "careCenter";

export type StatusBadgeVariant = "neutral" | "primary" | "info" | "success" | "warning" | "danger";

export interface ClientBadgeStatusToken {
    variant: StatusBadgeVariant;
    defaultLabel: string;
}

export const CLIENT_BADGE_STATUS_TOKENS = {
    service_status: {
        active: { variant: "primary", defaultLabel: "진행중" },
        preBooking: { variant: "neutral", defaultLabel: "예약 전" },
        // Contract progression reads neutral → primary → warning → success:
        // 대기 → 서명 완료 → 검토 필요 (action due) → 계약 완료.
        signed: { variant: "primary", defaultLabel: "서명 완료" },
        pending: { variant: "neutral", defaultLabel: "대기" },
        review: { variant: "warning", defaultLabel: "검토 필요" },
        scheduleChange: { variant: "danger", defaultLabel: "일정 변경" },
        terminated: { variant: "danger", defaultLabel: "중단" },
        expired: { variant: "danger", defaultLabel: "만료" },
        completed: { variant: "success", defaultLabel: "완료" },
    },
    breast_pump: {
        breastPump: { variant: "primary", defaultLabel: "유축기 대여" },
    },
    care_center: {
        careCenter: { variant: "primary", defaultLabel: "조리원 이용" },
    },
    contract_required: {
        terminated: { variant: "danger", defaultLabel: "계약서 필요" },
    },
} as const satisfies Record<ClientBadgeKey, Partial<Record<ClientBadgeStatus, ClientBadgeStatusToken>>>;

const DEFAULT_CLIENT_BADGE_KEY_BY_STATUS = {
    active: "service_status",
    preBooking: "service_status",
    signed: "service_status",
    pending: "service_status",
    review: "service_status",
    scheduleChange: "service_status",
    terminated: "service_status",
    expired: "service_status",
    completed: "service_status",
    breastPump: "breast_pump",
    careCenter: "care_center",
} as const satisfies Record<ClientBadgeStatus, ClientBadgeKey>;

export function getClientBadgeStatusToken(
    key: ClientBadgeKey,
    status: ClientBadgeStatus,
): ClientBadgeStatusToken | null {
    const tokens = CLIENT_BADGE_STATUS_TOKENS[key] as Partial<Record<ClientBadgeStatus, ClientBadgeStatusToken>>;
    return tokens[status] ?? null;
}

export function getDefaultClientBadgeStatusToken(status: ClientBadgeStatus): ClientBadgeStatusToken {
    return getClientBadgeStatusToken(DEFAULT_CLIENT_BADGE_KEY_BY_STATUS[status], status) ?? {
        variant: "warning",
        defaultLabel: "-",
    };
}
