"use client";

import Link from "next/link";
import { FilePen, ChevronRight } from "lucide-react";
import { StatusPill } from "@/components/app/ui/status-badge";
import type { ReviewNeededContract } from "@babyjamjam/shared/types/eformsign";

const MAX_VISIBLE_CONTRACTS = 5;
const AUTO_FINALIZE_MAX_ATTEMPTS = 3;

function autoFinalizeBadge(contract: ReviewNeededContract): {
  variant: "info" | "warning" | "danger";
  label: string;
} {
  if (contract.autoFinalizeAttempts >= AUTO_FINALIZE_MAX_ATTEMPTS) {
    return { variant: "danger", label: "자동 완료 실패 · 수동 확인" };
  }
  if (contract.autoFinalizeAttempts > 0) {
    return {
      variant: "warning",
      label: `재시도 예정 ${contract.autoFinalizeAttempts}/${AUTO_FINALIZE_MAX_ATTEMPTS}`,
    };
  }
  return { variant: "info", label: "자동 완료 대기" };
}

export interface ReviewNeededContractsCardProps {
  contracts: ReviewNeededContract[];
}

/**
 * Dashboard card listing provider-review-stage (070) contracts with their
 * nightly auto-finalize status. Renders nothing when the list is empty — the
 * card exists to surface pending/failed reviews, not to occupy space.
 */
export function ReviewNeededContractsCard({ contracts }: ReviewNeededContractsCardProps) {
  if (contracts.length === 0) return null;

  const visible = contracts.slice(0, MAX_VISIBLE_CONTRACTS);
  const hiddenCount = contracts.length - visible.length;

  return (
    <div
      data-component="desktop_dashboard_review-needed-contracts"
      className="rounded-[28px] bg-white p-[calc(16px*var(--glint-ui-scale,1))] shadow-v3"
    >
      <div
        data-component="desktop_dashboard_review-needed-contracts_header"
        className="mb-[calc(10px*var(--glint-ui-scale,1))] flex items-center justify-between gap-2"
      >
        <h2 className="flex items-center gap-[calc(8px*var(--glint-ui-scale,1))] text-[calc(13.6px*var(--glint-ui-scale,1))] font-bold text-v3-dark">
          <FilePen className="h-[calc(16px*var(--glint-ui-scale,1))] w-[calc(16px*var(--glint-ui-scale,1))] text-v3-orange" aria-hidden="true" />
          검토 필요 계약서
          <span className="text-v3-text-muted font-semibold">{contracts.length}건</span>
        </h2>
        <Link
          href="/contracts"
          className="flex items-center gap-1 text-[calc(11.2px*var(--glint-ui-scale,1))] font-semibold text-v3-text-muted transition-colors hover:text-v3-primary"
        >
          전체 보기
          <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </div>

      <ul
        data-component="desktop_dashboard_review-needed-contracts_list"
        className="flex flex-col"
      >
        {visible.map((contract) => {
          const badge = autoFinalizeBadge(contract);
          return (
            <li key={contract.documentId}>
              <Link
                href={`/contracts?documentId=${encodeURIComponent(contract.documentId)}`}
                data-component="desktop_dashboard_review-needed-contracts_list_item"
                className="flex items-center justify-between gap-3 rounded-[14px] px-[calc(10px*var(--glint-ui-scale,1))] py-[calc(8px*var(--glint-ui-scale,1))] transition-colors hover:bg-v3-dim-white"
              >
                <span className="min-w-0 flex items-baseline gap-[calc(8px*var(--glint-ui-scale,1))]">
                  <span className="truncate text-[calc(12.8px*var(--glint-ui-scale,1))] font-bold text-v3-dark">
                    {contract.customerName ?? "고객 미확인"}
                  </span>
                  <span className="shrink-0 text-[calc(11.2px*var(--glint-ui-scale,1))] text-v3-text-muted">
                    {contract.contractEndDate
                      ? `종료 ${contract.contractEndDate.replaceAll("-", ".")}`
                      : "종료일 미확인"}
                  </span>
                </span>
                <StatusPill variant={badge.variant} size="sm">
                  {badge.label}
                </StatusPill>
              </Link>
            </li>
          );
        })}
      </ul>
      {hiddenCount > 0 && (
        <p className="mt-[calc(6px*var(--glint-ui-scale,1))] px-[calc(10px*var(--glint-ui-scale,1))] text-[calc(11.2px*var(--glint-ui-scale,1))] text-v3-text-muted">
          외 {hiddenCount}건 — 전체 보기에서 확인하세요
        </p>
      )}
    </div>
  );
}
