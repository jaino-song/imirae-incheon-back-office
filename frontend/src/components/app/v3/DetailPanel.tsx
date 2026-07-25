"use client";

import React from "react";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { DetailTabs } from "./DetailTabs";
import { PanelTitleGroup } from "./PanelTitleGroup";
import { useSplitLayoutNavOptional } from "./SplitLayoutContext";
import { useScrollActivity } from "./useScrollActivity";

interface DetailPanelProps {
  "data-component": string;
  "data-source-component"?: string;
  /** Fully custom header (escape hatch for centered layouts etc.) */
  header?: React.ReactNode;
  /** Optional avatar element on the left */
  avatar?: React.ReactNode;
  /** Title text or node */
  title?: React.ReactNode;
  /** Subtitle below the title */
  subtitle?: React.ReactNode;
  /** Badges/chips rendered before the title (leftmost position) */
  badgesLeft?: React.ReactNode;
  /** Badges/chips inline after the title */
  badges?: React.ReactNode;
  /** Badges/chips pushed to the far right of the title row */
  badgesRight?: React.ReactNode;
  /** Trailing content on the right side of the header (e.g. Stepper) */
  trailing?: React.ReactNode;
  /** Optional stepper rendered on the right side of the structured header */
  stepper?: React.ReactNode;
  /** Optional action row rendered between header and tabs. */
  headerAction?: React.ReactNode;
  /** Optional back button rendered at the top of the header. Overrides SplitLayout compact back behavior. */
  backAction?: {
    label: React.ReactNode;
    onClick: () => void;
  };
  compactBackLabel?: React.ReactNode;
  tabs?: React.ReactNode;
  overlay?: React.ReactNode;
  emptyState?: React.ReactNode;
  footer?: React.ReactNode;
  footerClassName?: string;
  isLoading?: boolean;
  mainAnimationKey?: React.Key;
  children: React.ReactNode;
}

export const DETAIL_PANEL_FOOTER_CLASS_NAME =
  "shrink-0 border-t border-v3-border bg-white px-[calc(24px*var(--glint-ui-scale,1))] py-[calc(16px*var(--glint-ui-scale,1))] flex flex-wrap items-center justify-between gap-[calc(12px*var(--glint-ui-scale,1))]";
export const DETAIL_PANEL_FOOTER_PROGRESS_CLASS_NAME =
  "min-w-0 text-[calc(12px*var(--glint-ui-scale,1))] font-semibold text-v3-text-muted";
export const DETAIL_PANEL_FOOTER_ACTIONS_CLASS_NAME =
  "ml-auto flex shrink-0 flex-wrap justify-end gap-[calc(12px*var(--glint-ui-scale,1))]";

function DetailPanelTextSkeleton({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      data-slot="skeleton"
      data-component={name}
      className={cn("block animate-pulse rounded-md bg-v3-dim-white", className)}
    />
  );
}

export function DetailPanel({
  "data-component": dataComponent,
  "data-source-component": dataSourceComponent = "DetailPanel",
  header = null,
  avatar,
  title,
  subtitle,
  badgesLeft,
  badges,
  badgesRight,
  trailing,
  stepper,
  headerAction,
  backAction,
  compactBackLabel = "목록으로 돌아가기",
  tabs,
  overlay,
  emptyState,
  footer,
  footerClassName,
  isLoading = false,
  mainAnimationKey,
  children,
}: DetailPanelProps) {
  const splitLayoutNav = useSplitLayoutNavOptional();
  const { isScrollActive, handleScroll } = useScrollActivity();
  const resolvedOverlay = overlay ?? emptyState;
  const showCompactBackButton = splitLayoutNav?.isMobile ?? false;
  const shouldAnimateMain = mainAnimationKey !== undefined && !showCompactBackButton;
  const resolvedBackAction = backAction ?? (
    showCompactBackButton && splitLayoutNav
      ? { label: compactBackLabel, onClick: splitLayoutNav.goToList }
      : null
  );

  const resolvedTitle =
    isLoading && title ? (
      <DetailPanelTextSkeleton
        name={`${dataComponent}_header_title-group_title-row_title-skeleton`}
        className="h-[calc(18px*var(--glint-ui-scale,1))] w-36"
      />
    ) : title;
  const resolvedSubtitle =
    isLoading && subtitle ? (
      <DetailPanelTextSkeleton
        name={`${dataComponent}_header_title-group_subtitle-skeleton`}
        className="h-[calc(14px*var(--glint-ui-scale,1))] w-80 max-w-full"
      />
    ) : subtitle;
  const hasStructuredHeader = !!resolvedTitle;
  const hasHeaderTrailing = !!stepper || !!trailing;
  const renderedTabs =
    isLoading &&
    React.isValidElement<React.ComponentProps<typeof DetailTabs>>(tabs) &&
    tabs.type === DetailTabs
      ? React.cloneElement(tabs, { isLoading: true })
      : tabs;

  const renderedHeader = hasStructuredHeader ? (
    <div className="flex items-center justify-between gap-[calc(16px*var(--glint-ui-scale,1))]">
      <div className="flex min-w-0 items-center gap-[calc(12px*var(--glint-ui-scale,1))]">
        {avatar}
        <PanelTitleGroup
          data-component={`${dataComponent}_header_title-group`}
          title={resolvedTitle}
          subtitle={resolvedSubtitle}
          badgesLeft={badgesLeft}
          badges={badges}
          badgesRight={badgesRight}
          className="flex-1"
          subtitleClassName="min-w-0 max-w-full overflow-hidden text-[calc(14px*var(--glint-ui-scale,1))]"
          titleClassName="text-[calc(16px*var(--glint-ui-scale,1))]"
        />
      </div>
      {hasHeaderTrailing ? (
        <div className="flex shrink-0 items-center gap-[calc(8px*var(--glint-ui-scale,1))]">
          {stepper}
          {trailing}
        </div>
      ) : null}
    </div>
  ) : header;

  return (
    <div
      data-component={dataComponent}
      data-source-component={dataSourceComponent}
      data-slot="detail-panel"
      className="relative flex h-full min-h-0 flex-col overflow-hidden rounded-[28px] bg-white shadow-v3"
    >
      {(resolvedBackAction || renderedHeader) && (
        <header data-component={`${dataComponent}_header`} data-slot="detail-panel-header" className="px-[calc(24px*var(--glint-ui-scale,1))] py-[calc(20px*var(--glint-ui-scale,1))]">
          {resolvedBackAction && (
            <button
              data-component={`${dataComponent}_header_back`}
              type="button"
              className="mb-[calc(16px*var(--glint-ui-scale,1))] inline-flex items-center gap-[calc(6px*var(--glint-ui-scale,1))] self-start text-[calc(12px*var(--glint-ui-scale,1))] font-semibold text-v3-text-muted transition-colors hover:text-v3-primary md:mb-[calc(24px*var(--glint-ui-scale,1))] md:text-[calc(12.8px*var(--glint-ui-scale,1))]"
              onClick={resolvedBackAction.onClick}
            >
              <ChevronLeft className="h-[calc(18px*var(--glint-ui-scale,1))] w-[calc(18px*var(--glint-ui-scale,1))] md:h-[calc(20px*var(--glint-ui-scale,1))] md:w-[calc(20px*var(--glint-ui-scale,1))]" aria-hidden="true" />
              {resolvedBackAction.label}
            </button>
          )}
          {renderedHeader}
        </header>
      )}
      {headerAction && <div data-component={`${dataComponent}_header-action`} className="px-[calc(24px*var(--glint-ui-scale,1))] pb-[calc(24px*var(--glint-ui-scale,1))]">{headerAction}</div>}
      {renderedTabs && <div data-component={`${dataComponent}_tabs`} className="px-[calc(24px*var(--glint-ui-scale,1))]">{renderedTabs}</div>}
      {resolvedOverlay ? (
        <div
          data-component={`${dataComponent}_overlay`}
          data-slot="detail-panel-overlay"
          className={cn(
            "pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-[calc(24px*var(--glint-ui-scale,1))]",
            overlay ? "-translate-y-[calc(12px*var(--glint-ui-scale,1))]" : undefined,
          )}
        >
          {resolvedOverlay}
        </div>
      ) : null}
      <div
        key={shouldAnimateMain ? mainAnimationKey : undefined}
        data-component={`${dataComponent}_main`}
        data-slot="detail-panel-main"
        className={cn(
          "glint-ui-scale-scope relative flex min-h-0 flex-1 flex-col",
          shouldAnimateMain && "animate-v3-slide-up",
        )}
      >
        <div
          data-component={`${dataComponent}_main_scroll-content`}
          data-slot="detail-panel-scroll-content"
          className="scrollbar-on-scroll flex min-h-0 flex-1 flex-col overflow-y-auto p-[calc(24px*var(--glint-ui-scale,1))]"
          data-scroll-active={isScrollActive ? "true" : "false"}
          onScroll={handleScroll}
        >
          {isLoading ? null : children}
        </div>
        <div
          data-component={`${dataComponent}_main_bottom-spacer`}
          data-slot="detail-panel-bottom-spacer"
          className="h-[calc(24px*var(--glint-ui-scale,1))] shrink-0 bg-white"
        />
      </div>
      {footer ? (
        <footer
          data-component={`${dataComponent}_footer`}
          data-slot="detail-panel-footer"
          className={cn(DETAIL_PANEL_FOOTER_CLASS_NAME, footerClassName)}
        >
          {footer}
        </footer>
      ) : null}
    </div>
  );
}
