import {
    getClientBadgeStatusToken,
    getDefaultClientBadgeStatusToken,
    type ClientBadgeKey,
    type ClientBadgeStatus,
} from "../tokens/status-badge";

/**
 * Legacy client-badge derivation, shared verbatim by both apps.
 *
 * The backend's `client.badges` array is the authority; this builder exists
 * only for payloads that predate it (or omit it), so that BOTH apps degrade
 * identically instead of mobile recovering while desktop renders nothing —
 * the drift the 2026-08 state-derivation audit flagged.
 */
export type ClientBadgeTone = "danger" | "success" | "primary" | "warning" | "neutral";

export interface LegacyClientBadgeInput {
    serviceStatus?: string | null;
    documentStatus?: string | null;
    breastPump?: boolean | null;
    careCenter?: boolean | null;
}

export interface LegacyClientBadge {
    key: ClientBadgeKey;
    status: ClientBadgeStatus;
    label: string;
    tone: ClientBadgeTone;
    priority: number;
}

const LEGACY_CLIENT_BADGE_ORDER: Record<ClientBadgeKey, number> = {
    contract_required: 10,
    service_status: 20,
    breast_pump: 30,
    care_center: 40,
};

function badgeStatusForServiceStatus(serviceStatus: string | null | undefined): ClientBadgeStatus {
    switch (serviceStatus) {
        case "pre_booking":
            return "preBooking";
        case "active":
            return "active";
        case "replacement_requested":
        case "terminated":
            return "terminated";
        case "completed":
            return "completed";
        case "waiting":
        default:
            return "pending";
    }
}

function legacyBadge(
    key: ClientBadgeKey,
    status: ClientBadgeStatus,
    labelOverride?: string,
): LegacyClientBadge {
    const token = getClientBadgeStatusToken(key, status) ?? getDefaultClientBadgeStatusToken(status);
    return {
        key,
        status,
        label: labelOverride ?? token.defaultLabel,
        tone: token.variant === "info" ? "primary" : token.variant,
        priority: LEGACY_CLIENT_BADGE_ORDER[key],
    };
}

/** Derive the badge list the backend would have sent, from the raw client fields. */
export function legacyClientBadges(client: LegacyClientBadgeInput): LegacyClientBadge[] {
    const badges: LegacyClientBadge[] = [];

    if (client.serviceStatus === "active" && client.documentStatus !== "completed") {
        badges.push(legacyBadge("contract_required", "terminated"));
    }

    badges.push(legacyBadge(
        "service_status",
        badgeStatusForServiceStatus(client.serviceStatus),
        client.serviceStatus === "replacement_requested" ? "교체 요청" : undefined,
    ));

    if (client.breastPump) badges.push(legacyBadge("breast_pump", "breastPump"));
    if (client.careCenter) badges.push(legacyBadge("care_center", "careCenter"));

    return badges;
}
