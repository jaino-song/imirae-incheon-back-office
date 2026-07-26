"use client";

import { memo } from "react";
import { Calendar, CircleCheck, FileSignature } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { AnimatedSlotListItemContent, StatusBadge, type StatusType } from "@/components/app/v3";
import { cn } from "@/lib/utils";
import { getStatusCategory, mapDocStatusLabel } from "@/lib/eformsign/status-codes";
import type { EformsignDocument } from "@/lib/eformsign/types";
import { formatDateForDisplay } from "@/lib/date/format-date-for-display";

interface ContractsListItemProps {
  "data-component": string;
  document: EformsignDocument | null;
  customerName: string | null;
  subtitle?: string;
  isLoading: boolean;
}

function mapCategoryToStatusType(
  category: "completed" | "expired" | "in-progress"
): StatusType {
  switch (category) {
    case "completed":
      return "signed";
    case "expired":
      return "expired";
    default:
      return "pending";
  }
}

function formatDate(timestamp: number): string {
  return formatDateForDisplay(timestamp);
}

function ContractsListItemComponent({
  "data-component": dataComponent,
  document,
  customerName,
  subtitle,
  isLoading,
}: ContractsListItemProps) {
  if (isLoading || !document) {
    return (
      <>
        <div
          data-component={`${dataComponent}_skeleton-icon`}
          className="flex h-[calc(44px*var(--glint-ui-scale,1))] w-[calc(44px*var(--glint-ui-scale,1))] shrink-0 items-center justify-center rounded-[14px] bg-v3-dim-white shadow-md"
        >
          <Skeleton className="h-[calc(20px*var(--glint-ui-scale,1))] w-[calc(20px*var(--glint-ui-scale,1))] rounded-md bg-white/70" />
        </div>
        <div
          data-component={`${dataComponent}_skeleton-content`}
          className="flex-1 min-w-0"
        >
          <Skeleton className="mb-[calc(6px*var(--glint-ui-scale,1))] h-[calc(16px*var(--glint-ui-scale,1))] w-[calc(96px*var(--glint-ui-scale,1))] bg-v3-dim-white" />
          <Skeleton className="mb-[calc(8px*var(--glint-ui-scale,1))] h-[calc(12px*var(--glint-ui-scale,1))] w-[calc(160px*var(--glint-ui-scale,1))] bg-v3-dim-white" />
          <Skeleton className="h-[calc(12px*var(--glint-ui-scale,1))] w-[calc(208px*var(--glint-ui-scale,1))] bg-v3-dim-white" />
        </div>
        <Skeleton className="h-[calc(24px*var(--glint-ui-scale,1))] w-[calc(56px*var(--glint-ui-scale,1))] shrink-0 rounded-full bg-v3-dim-white" />
      </>
    );
  }

  const category = getStatusCategory(document.current_status?.status_type);
  const statusLabel = mapDocStatusLabel(document.current_status);
  const isReviewNeeded = statusLabel === "검토 필요";
  const statusType: StatusType = isReviewNeeded ? "review" : mapCategoryToStatusType(category);
  const sentDate = formatDate(document.created_date);
  const signedDate =
    category === "completed" ? formatDate(document.updated_date) : null;
  const normalizedCustomerName = customerName?.trim();
  const recipientName =
    normalizedCustomerName && normalizedCustomerName !== "-"
      ? normalizedCustomerName
      : "이름 없음";

  return (
    <AnimatedSlotListItemContent
      data-component={dataComponent}
      icon={FileSignature}
      iconContainerClassName={cn(
        category === "completed"
          ? "bg-v3-green-light"
          : category === "expired"
            ? "bg-v3-burgundy-light"
            : isReviewNeeded
              ? "bg-v3-primary-light"
              : "bg-v3-orange-light"
      )}
      iconClassName={cn(
        category === "completed"
          ? "text-v3-green"
          : category === "expired"
            ? "text-v3-burgundy"
            : isReviewNeeded
              ? "text-v3-primary"
              : "text-v3-orange"
      )}
      title={recipientName}
      subtitle={subtitle ?? document.document_name}
      meta={
        <>
          <span className="flex min-w-0 shrink-0 items-center gap-[calc(4px*var(--glint-ui-scale,1))]">
            <Calendar className="h-[calc(12px*var(--glint-ui-scale,1))] w-[calc(12px*var(--glint-ui-scale,1))] shrink-0" />
            발송 {sentDate}
          </span>
          {signedDate && (
            <span className="flex min-w-0 shrink-0 items-center gap-[calc(4px*var(--glint-ui-scale,1))]">
              <CircleCheck className="h-[calc(12px*var(--glint-ui-scale,1))] w-[calc(12px*var(--glint-ui-scale,1))] shrink-0" />
              완료 {signedDate}
            </span>
          )}
        </>
      }
      status={<StatusBadge status={statusType} label={statusLabel} />}
    />
  );
}

export const ContractsListItem = memo(
  ContractsListItemComponent,
  (previousProps, nextProps) =>
    previousProps["data-component"] === nextProps["data-component"] &&
    previousProps.document === nextProps.document &&
    previousProps.customerName === nextProps.customerName &&
    previousProps.subtitle === nextProps.subtitle &&
    previousProps.isLoading === nextProps.isLoading
);
