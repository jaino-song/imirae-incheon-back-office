import { getClientBadgeStatusToken } from "@babyjamjam/shared/tokens/status-badge";
import { legacyClientBadges } from "@babyjamjam/shared/client/badges";

import { STATUS_SURFACE } from "@/components/app/ui/status-surface";
import type { Client, ClientBadge, ClientBadgeTone } from "@/lib/client/types";

const SCHEDULE_CHANGE_BADGE_LABEL = "일정 변경";
const PRIMARY_CLIENT_BADGE_KEYS = ["contract_required", "service_status"] as const satisfies readonly ClientBadge["key"][];

const isScheduleChangeBadge = (badge: ClientBadge): boolean => (
    badge.key === "service_status" && badge.status === "scheduleChange"
);

const CLIENT_BADGE_AVATAR_CLASS_BY_TONE: Record<ClientBadgeTone, string> = {
    danger: `border ${STATUS_SURFACE.danger}`,
    success: `border ${STATUS_SURFACE.success}`,
    primary: `border ${STATUS_SURFACE.primary}`,
    warning: `border ${STATUS_SURFACE.warning}`,
    neutral: `border ${STATUS_SURFACE.neutral}`,
};

export const applyScheduleChangeBadge = (
    client: Pick<Client, "pendingScheduleChange"> | null | undefined,
    badges: ClientBadge[],
): ClientBadge[] => {
    if (!client?.pendingScheduleChange) {
        return badges;
    }

    const scheduleChangeBadge = (serviceStatusBadge?: ClientBadge): ClientBadge => ({
        key: "service_status",
        status: "scheduleChange",
        label: SCHEDULE_CHANGE_BADGE_LABEL,
        tone: "danger",
        priority: serviceStatusBadge?.priority ?? 0,
    });

    let didReplaceServiceStatus = false;
    const updatedBadges = badges.map((badge) => {
        if (badge.key !== "service_status") {
            return badge;
        }

        didReplaceServiceStatus = true;
        return scheduleChangeBadge(badge);
    });

    return didReplaceServiceStatus ? updatedBadges : [scheduleChangeBadge(), ...badges];
};

export const prioritizeClientBadges = (badges: ClientBadge[]): ClientBadge[] => {
    const scheduleChangeBadge = badges.find(isScheduleChangeBadge);
    const prioritizedBadges = [
        scheduleChangeBadge,
        ...PRIMARY_CLIENT_BADGE_KEYS.map((key) => badges.find((badge) => (
            badge.key === key && badge !== scheduleChangeBadge
        ))),
    ]
        .filter((badge): badge is ClientBadge => Boolean(badge));
    const prioritizedBadgeSet = new Set(prioritizedBadges);

    return [
        ...prioritizedBadges,
        ...badges.filter((badge) => !prioritizedBadgeSet.has(badge)),
    ];
};

export const getClientBadges = (
    client:
        | (Pick<Client, "badges" | "pendingScheduleChange">
            & Partial<Pick<Client, "serviceStatus" | "documentStatus" | "breastPump" | "careCenter">>)
        | null
        | undefined,
): ClientBadge[] => {
    // The backend's badges array is the authority; the shared legacy builder only
    // backstops payloads without it, identically to mobile.
    const badges = client?.badges?.length ? client.badges : client ? legacyClientBadges(client) : [];
    return prioritizeClientBadges(applyScheduleChangeBadge(client, badges));
};

export const getPrimaryClientBadge = (badges: ClientBadge[]): ClientBadge | null => {
    return prioritizeClientBadges(badges)[0] ?? null;
};

export const getClientBadgeAvatarClassName = (badge: Pick<ClientBadge, "key" | "status" | "tone"> | null | undefined): string => {
    const tokenVariant = badge ? getClientBadgeStatusToken(badge.key, badge.status)?.variant : null;
    const tone = tokenVariant === "info" ? "primary" : tokenVariant ?? badge?.tone ?? "warning";
    return CLIENT_BADGE_AVATAR_CLASS_BY_TONE[tone];
};
