import {
  getClientBadgeStatusToken,
  getDefaultClientBadgeStatusToken,
} from "@babyjamjam/shared/tokens/status-badge";
import { legacyClientBadges } from "@babyjamjam/shared/client/badges";

import type {
  Client,
  ClientBadge,
  ClientBadgeKey,
  ClientBadgeStatus,
  ClientBadgeTone,
} from "@/lib/client/types";

export type MobileClientBadgeTone = "burgundy" | "primary" | "muted" | "green" | "orange";

export interface MobileClientBadge {
  key: ClientBadgeKey;
  status: ClientBadgeStatus;
  label: string;
  tone: MobileClientBadgeTone;
  priority: number;
}

const PRIMARY_CLIENT_BADGE_KEYS = ["contract_required", "service_status"] as const satisfies readonly ClientBadgeKey[];
const SCHEDULE_CHANGE_BADGE_LABEL = "일정 변경";

const CLIENT_BADGE_ORDER: Record<ClientBadgeKey, number> = {
  contract_required: 10,
  service_status: 20,
  breast_pump: 30,
  care_center: 40,
};

const CLIENT_BADGE_TONE_BY_VARIANT = {
  danger: "burgundy",
  success: "green",
  primary: "primary",
  info: "primary",
  warning: "orange",
  neutral: "muted",
} as const satisfies Record<string, MobileClientBadgeTone>;

const CLIENT_BADGE_TONE_BY_TONE = {
  danger: "burgundy",
  success: "green",
  primary: "primary",
  warning: "orange",
  neutral: "muted",
} as const satisfies Record<ClientBadgeTone, MobileClientBadgeTone>;

function applyScheduleChangeBadge(client: Client, badges: ClientBadge[]): ClientBadge[] {
  if (!client.pendingScheduleChange) return badges;

  const serviceStatusBadge = badges.find((badge) => badge.key === "service_status");
  const scheduleChangeBadge: ClientBadge = {
    key: "service_status",
    status: "scheduleChange",
    label: SCHEDULE_CHANGE_BADGE_LABEL,
    tone: "danger",
    priority: serviceStatusBadge?.priority ?? CLIENT_BADGE_ORDER.service_status,
  };

  if (!serviceStatusBadge) return [scheduleChangeBadge, ...badges];
  return badges.map((badge) => badge === serviceStatusBadge ? scheduleChangeBadge : badge);
}

export function getClientBadges(client: Client | null | undefined): ClientBadge[] {
  if (!client) return [];
  const badges = client.badges?.length ? client.badges : legacyClientBadges(client);
  return applyScheduleChangeBadge(client, badges);
}

export function prioritizeClientBadges(badges: ClientBadge[]): ClientBadge[] {
  const prioritizedBadges = PRIMARY_CLIENT_BADGE_KEYS
    .map((key) => badges.find((badge) => badge.key === key))
    .filter((badge): badge is ClientBadge => Boolean(badge));
  const prioritizedKeys = new Set(prioritizedBadges.map((badge) => badge.key));

  return [
    ...prioritizedBadges,
    ...badges.filter((badge) => !prioritizedKeys.has(badge.key)),
  ];
}

export function getPrimaryClientBadge(badges: ClientBadge[]): ClientBadge | null {
  return prioritizeClientBadges(badges)[0] ?? null;
}

export function toMobileClientBadge(badge: ClientBadge, fallbackIndex = 0): MobileClientBadge {
  const token = getClientBadgeStatusToken(badge.key, badge.status) ?? getDefaultClientBadgeStatusToken(badge.status);
  const variantTone = CLIENT_BADGE_TONE_BY_VARIANT[token.variant];
  const tone = badge.tone ? CLIENT_BADGE_TONE_BY_TONE[badge.tone] : variantTone;

  return {
    key: badge.key,
    status: badge.status,
    label: badge.label ?? token.defaultLabel,
    tone,
    priority: CLIENT_BADGE_ORDER[badge.key] ?? 100 + fallbackIndex,
  };
}

export function getMobileClientBadges(client: Client | null | undefined): MobileClientBadge[] {
  return prioritizeClientBadges(getClientBadges(client)).map(toMobileClientBadge);
}
