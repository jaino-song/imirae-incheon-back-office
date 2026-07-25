"use client";

import { getDefaultClientBadgeStatusToken, type ClientBadgeStatus } from "@babyjamjam/shared/tokens/status-badge";

import { StatusPill } from "@/components/app/ui/status-badge";

export type StatusType = ClientBadgeStatus;

interface StatusBadgeProps {
  status: StatusType;
  label?: string;
}

/** @deprecated @/components/app/ui/status-badge의 StatusBadge(variants+StatusPill)를 사용할 것 — 중복 구현 (BJJ-254) */
export function StatusBadge({ status, label }: StatusBadgeProps) {
  const config = getDefaultClientBadgeStatusToken(status);
  return (
    <StatusPill data-component="status-badge" variant={config.variant} size="sm">
      {label || config.defaultLabel}
    </StatusPill>
  );
}
