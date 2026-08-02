import Link from "next/link";
import type { ReactNode } from "react";
import { Plus } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";

const SOURCE_COMPONENT = "ListCardHeader";
export interface ListCardHeaderProps {
  "data-component": string;
  title: string;
  count?: ReactNode;
  actionLabel?: string;
  actionHref?: string;
  actionIcon?: ReactNode;
  actionLoading?: boolean;
  actionType?: "button" | "submit";
  actionDisabled?: boolean;
  onActionClick?: () => void;
}

export function ListCardHeader({
  "data-component": dataComponent,
  title,
  count,
  actionLabel,
  actionHref,
  actionIcon,
  actionLoading = false,
  actionType = "button",
  actionDisabled = false,
  onActionClick,
}: ListCardHeaderProps) {
  const resolvedActionIcon = actionIcon !== undefined
    ? actionIcon
    : actionLabel?.startsWith("+")
      ? null
      : <Plus size={12} strokeWidth={3} />;
  const action = actionLoading ? (
    <Skeleton
      role="status"
      aria-label="권한 확인 중"
      className="h-7 w-20 rounded-full"
      data-component={`${dataComponent}_action-skeleton`}
    />
  ) : actionLabel ? (
    actionHref ? (
      <Link
        href={actionHref}
        className="list-action"
        data-component={`${dataComponent}_action`}
      >
        {resolvedActionIcon}
        {actionLabel}
      </Link>
    ) : (
      <button
        type={actionType}
        disabled={actionDisabled}
        className="list-action"
        data-component={`${dataComponent}_action`}
        onClick={onActionClick}
      >
        {resolvedActionIcon}
        {actionLabel}
      </button>
    )
  ) : null;

  return (
    <div
      className="list-title"
      data-component={dataComponent}
      data-source-component={SOURCE_COMPONENT}
    >
      <span className="list-title-text">
        {title}
        {count && <span className="list-count">{count}</span>}
      </span>
      {action}
    </div>
  );
}
