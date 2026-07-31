"use client";

import { type ReactNode } from "react";
import { type LucideIcon } from "lucide-react";
import {
  ListCard,
  ListRowsSkeleton,
  MobileSectionNav,
} from "@/components/app/mobile-redesign/primitives";
import { MobileDetailSheet } from "@/components/app/mobile-redesign/detail-sheet";
import "@/components/app/mobile-redesign/redesign.css";

type SectionNavItem = {
  id: string;
  label: string;
  icon: LucideIcon;
};

export type ShellListSkeletonProps = {
  /** Route name — used for MobileDetailSheet `name` and auto-generating data-component values */
  name: string;
  /** ListCard title */
  title: string;
  /** Filter pill labels for the skeleton. Omit or pass [] for no filters. */
  filterLabels?: string[];
  /** Section nav items (only for pages that use MobileSectionNav) */
  sectionNav?: SectionNavItem[];
  /** Default active section id (defaults to first item) */
  activeSectionId?: string;
  /** Action button in ListCard header */
  action?: { label: string; href: string };
  /** Number of skeleton rows (default: 6) */
  rowCount?: number;
  /** Wrap in MobileDetailSheet? (default: true) */
  useDetailSheet?: boolean;
  /** Extra outer wrapper props (e.g. prices page needs md:hidden + data-slot) */
  outerWrapper?: {
    className?: string;
    dataComponent?: string;
    dataSlot?: string;
  };
  /** data-slot for the list content div */
  listDataSlot?: string;
};

/** Skeleton count badge used across all loading skeletons */
function SkeletonCount({ name }: { name: string }) {
  return (
    <span
      className="inline-block h-4 w-8 rounded bg-v3-dim-white animate-pulse"
      data-component={`mobile_${name}_loading_count-skeleton`}
    />
  );
}

/**
 * Unified loading skeleton for shell list pages.
 *
 * Covers three structural patterns:
 * - **Pattern A**: MobileDetailSheet + MobileSectionNav + ListCard
 * - **Pattern B**: MobileDetailSheet + ListCard
 * - **Pattern C**: Plain ListCard (no detail sheet)
 */
export function ShellListSkeleton({
  name,
  title,
  filterLabels = [],
  sectionNav,
  activeSectionId,
  action,
  rowCount = 6,
  useDetailSheet = true,
  outerWrapper,
  listDataSlot,
}: ShellListSkeletonProps) {
  const prefix = `mobile_${name}_loading`;

  const filters = filterLabels.map((label) => ({
    label,
    count: "" as ReactNode,
    skeleton: true,
  }));

  const listContent = (
    <div
      className={
        sectionNav
          ? "shell-content flex-col gap-[calc(8px*var(--glint-ui-scale,1))]"
          : "shell-content"
      }
      data-component={`${prefix}_list-content`}
      data-slot={listDataSlot}
    >
      {sectionNav && (
        <MobileSectionNav
          data-component={`${prefix}_section-nav`}
          ariaLabel={`${title} 섹션`}
          items={sectionNav}
          activeId={activeSectionId ?? sectionNav[0]?.id ?? ""}
          onSelect={() => {}}
        />
      )}
      <ListCard
        data-component={`${prefix}_list-card`}
        title={title}
        count={<SkeletonCount name={name} />}
        filters={filters}
        activeFilter={filterLabels[0] ?? ""}
        actionLabel={action?.label}
        actionHref={action?.href}
      >
        <ListRowsSkeleton
          data-component={`${prefix}_skeleton-rows`}
          rowCount={rowCount}
        />
      </ListCard>
    </div>
  );

  const skeleton = useDetailSheet ? (
    <MobileDetailSheet
      data-component={`${prefix}_detail-sheet`}
      name={name}
      isOpen={false}
      onClose={() => {}}
      list={listContent}
      detail={<div className="detail-body" />}
    />
  ) : (
    <div
      data-component={`${prefix}_shell`}
      className="mobile-shell-content flex flex-col gap-4 p-4"
    >
      <ListCard
        data-component={`${prefix}_list-card`}
        title={title}
        count={<SkeletonCount name={name} />}
        filters={filters}
        activeFilter={filterLabels[0] ?? ""}
      >
        <ListRowsSkeleton
          data-component={`${prefix}_skeleton-rows`}
          rowCount={rowCount}
        />
      </ListCard>
    </div>
  );

  if (outerWrapper) {
    return (
      <div
        className={outerWrapper.className}
        data-component={outerWrapper.dataComponent}
        data-slot={outerWrapper.dataSlot}
      >
        {skeleton}
      </div>
    );
  }

  return skeleton;
}
