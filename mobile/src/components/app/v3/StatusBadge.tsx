"use client";

import { getDefaultClientBadgeStatusToken, type ClientBadgeStatus } from "@babyjamjam/shared/tokens/status-badge";

import { StatusPill } from "@/components/app/ui/status-badge";

export type StatusType = ClientBadgeStatus;

interface StatusBadgeProps {
  /** Caller-context canonical value for the badge. */
  "data-component"?: string;
  status: StatusType;
  label?: string;
}

/** @deprecated @/components/app/ui/status-badge의 StatusBadge(variants+StatusPill)를 사용할 것 — 중복 구현 (BJJ-254) */
export function StatusBadge({ "data-component": dataComponent, status, label }: StatusBadgeProps) {
  const config = getDefaultClientBadgeStatusToken(status);
  return (
    <StatusPill data-component={dataComponent} data-slot="status-badge" variant={config.variant} size="sm">
      {label || config.defaultLabel}
    </StatusPill>
  );
}
