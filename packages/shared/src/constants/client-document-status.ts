import type { StatusBadgeVariant } from "../tokens/status-badge";

/**
 * Coarse per-client contract-document status the backend stores on the client
 * record (Client.documentStatus). One canonical Korean label + badge variant
 * per status, shared by every surface that renders it — the desktop client
 * panel/dialogs and the mobile client detail previously each kept their own
 * (drifted) mappings.
 */
export type ClientDocumentStatus =
    | "created"
    | "opened"
    | "requested"
    | "completed"
    | "rejected"
    | "revoked"
    | "deleted";

export interface ClientDocumentStatusMeta {
    label: string;
    variant: StatusBadgeVariant;
}

export const CLIENT_DOCUMENT_STATUS_META = {
    created: { label: "발송 대기", variant: "info" },
    requested: { label: "서명 요청됨", variant: "warning" },
    opened: { label: "열람됨", variant: "warning" },
    completed: { label: "계약 완료", variant: "success" },
    rejected: { label: "거부됨", variant: "danger" },
    revoked: { label: "철회됨", variant: "danger" },
    deleted: { label: "삭제됨", variant: "danger" },
} as const satisfies Record<ClientDocumentStatus, ClientDocumentStatusMeta>;

/** Meta for a client that has no contract document at all. */
export const CLIENT_DOCUMENT_STATUS_NONE_META: ClientDocumentStatusMeta = {
    label: "미발급",
    variant: "neutral",
};

/** Resolve the display meta for any stored documentStatus value (null/unknown → 미발급). */
export function getClientDocumentStatusMeta(
    status: string | null | undefined,
): ClientDocumentStatusMeta {
    if (status && status in CLIENT_DOCUMENT_STATUS_META) {
        return CLIENT_DOCUMENT_STATUS_META[status as ClientDocumentStatus];
    }
    return CLIENT_DOCUMENT_STATUS_NONE_META;
}
