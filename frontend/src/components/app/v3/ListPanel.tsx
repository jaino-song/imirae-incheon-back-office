"use client";

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { ExpandableSearch } from "./ExpandableSearch";
import { PanelTitleGroup } from "./PanelTitleGroup";
import { useScrollActivity } from "./useScrollActivity";

interface TabItem {
  label: string;
  value: string;
  activeClassName?: string;
  indicatorClassName?: string;
}

interface ListPanelProps {
  "data-component": string;
  title: string;
  subtitle?: string;
  /** Optional avatar element rendered to the left of the title group */
  avatar?: React.ReactNode;
  tabs?: TabItem[];
  activeTab?: string;
  onTabChange?: (value: string) => void;
  tabsAriaLabel?: string;
  tabsVariant?: "inline" | "dropdown";
  headerPadding?: "auto" | "compact" | "default";
  overlay?: React.ReactNode;
  /** Empty state rendered as overlay (centered in full panel height) */
  emptyState?: React.ReactNode;
  children: React.ReactNode;
  headerActions?: React.ReactNode;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  searchAriaLabel?: string;
  isLoading?: boolean;
  isContentLoading?: boolean;
  contentSkeleton?: React.ReactNode;
  subHeader?: React.ReactNode;
  disabled?: boolean;
  disabledOverlay?: React.ReactNode;
  className?: string;
}

export function ListPanel({
  "data-component": dataComponent,
  title,
  subtitle,
  avatar,
  tabs,
  activeTab,
  onTabChange,
  tabsAriaLabel,
  tabsVariant = "inline",
  headerPadding = "auto",
  overlay,
  emptyState,
  children,
  headerActions,
  searchValue,
  onSearchChange,
  searchPlaceholder = "검색…",
  searchAriaLabel,
  isLoading = false,
  isContentLoading = false,
  contentSkeleton,
  subHeader,
  disabled = false,
  disabledOverlay,
  className,
}: ListPanelProps) {
  const inlineTabsRef = useRef<HTMLDivElement>(null);
  const tabButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const showTabs = tabs && tabs.length > 0;
  const hasSearch = searchValue !== undefined && !!onSearchChange;
  const showControls = showTabs || hasSearch;
  const showContentSkeleton = (isLoading || isContentLoading) && contentSkeleton;
  const resolvedOverlay = overlay ?? (isLoading || isContentLoading ? undefined : emptyState);
  const headerAlignmentClass = subtitle ? "items-start" : "items-center";
  const headerClassName =
    headerPadding === "default"
      ? `flex ${headerAlignmentClass} justify-between p-[calc(24px*var(--glint-ui-scale,1))] shrink-0`
      : headerPadding === "compact"
        ? `flex ${headerAlignmentClass} justify-between p-[calc(24px*var(--glint-ui-scale,1))] pb-0 shrink-0`
        : showControls
          ? `flex ${headerAlignmentClass} justify-between p-[calc(24px*var(--glint-ui-scale,1))] pb-0 shrink-0`
          : `flex ${headerAlignmentClass} justify-between p-[calc(24px*var(--glint-ui-scale,1))] shrink-0`;
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [tabIndicatorMetrics, setTabIndicatorMetrics] = useState({
    left: 0,
    width: 0,
    isReady: false,
  });
  const [isTabIndicatorTransitionEnabled, setIsTabIndicatorTransitionEnabled] = useState(false);
  const { isScrollActive, handleScroll } = useScrollActivity();

  const measureTabIndicator = useCallback(() => {
    const root = inlineTabsRef.current;
    const activeButton = activeTab ? tabButtonRefs.current[activeTab] : null;

    if (!root || !activeButton) {
      setTabIndicatorMetrics((currentMetrics) =>
        currentMetrics.isReady ? { ...currentMetrics, isReady: false } : currentMetrics
      );
      return;
    }

    const rootRect = root.getBoundingClientRect();
    const buttonRect = activeButton.getBoundingClientRect();
    const nextMetrics = {
      left: buttonRect.left - rootRect.left,
      width: buttonRect.width,
      isReady: true,
    };

    setTabIndicatorMetrics((currentMetrics) =>
      currentMetrics.left === nextMetrics.left &&
      currentMetrics.width === nextMetrics.width &&
      currentMetrics.isReady === nextMetrics.isReady
        ? currentMetrics
        : nextMetrics
    );
  }, [activeTab]);

  useEffect(() => {
    if (!dropdownOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [dropdownOpen]);

  useLayoutEffect(() => {
    const animationFrameId = requestAnimationFrame(measureTabIndicator);

    const root = inlineTabsRef.current;
    if (!root) {
      return () => cancelAnimationFrame(animationFrameId);
    }

    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(measureTabIndicator);

    resizeObserver?.observe(root);
    tabs?.forEach((tab) => {
      const button = tabButtonRefs.current[tab.value];
      if (button) resizeObserver?.observe(button);
    });

    window.addEventListener("resize", measureTabIndicator);

    return () => {
      cancelAnimationFrame(animationFrameId);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", measureTabIndicator);
    };
  }, [measureTabIndicator, tabs]);

  useEffect(() => {
    if (!tabIndicatorMetrics.isReady) return;

    const animationFrameId = requestAnimationFrame(() => {
      setIsTabIndicatorTransitionEnabled(true);
    });

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [tabIndicatorMetrics.isReady]);

  const activeTabLabel = tabs?.find(t => t.value === activeTab)?.label ?? tabs?.[0]?.label ?? "";
  const activeTabIndicatorClassName =
    tabs?.find((tab) => tab.value === activeTab)?.indicatorClassName ?? "bg-primary";

  return (
    <div
      data-component={dataComponent}
      data-source-component="ListPanel"
      data-slot="list-panel"
      className={cn(
        "relative flex h-full min-h-0 flex-1 self-stretch flex-col overflow-hidden rounded-[28px] bg-white shadow-v3",
        className,
      )}
    >
      <div data-component={`${dataComponent}_top-area`} data-slot="list-panel-top-area" className="relative z-20 shrink-0">
        <div data-component={`${dataComponent}_top-area_header`} data-slot="list-panel-header" className={headerClassName}>
          <div className="flex min-w-0 items-center gap-[calc(16px*var(--glint-ui-scale,1))]">
            {avatar}
            <PanelTitleGroup
              data-component={`${dataComponent}_top-area_header_title-group`}
              title={title}
              subtitle={subtitle}
              titleClassName="text-[calc(18px*var(--glint-ui-scale,1))]"
            />
          </div>
          {headerActions && (
            <div
              data-component={`${dataComponent}_top-area_header_actions`}
              className={cn(disabled && "pointer-events-none opacity-40")}
            >
              {headerActions}
            </div>
          )}
        </div>

        {subHeader && <div data-component={`${dataComponent}_top-area_sub-header`} className="shrink-0 px-[calc(24px*var(--glint-ui-scale,1))] pt-[calc(12px*var(--glint-ui-scale,1))]">{subHeader}</div>}

        {showControls && (
          <div
            data-component={`${dataComponent}_top-area_controls`}
            data-slot="list-panel-controls"
            className={cn(
              "relative flex min-h-[calc(52px*var(--glint-ui-scale,1))] shrink-0 items-center gap-[calc(12px*var(--glint-ui-scale,1))] overflow-visible px-[calc(24px*var(--glint-ui-scale,1))] pt-[calc(16px*var(--glint-ui-scale,1))] [container-type:inline-size]",
              showTabs ? "justify-between" : "justify-end",
            )}
          >
            {showTabs ? (
              tabsVariant === "dropdown" ? (
                <div ref={dropdownRef} className="relative">
                  <button
                    type="button"
                    onClick={() => {
                      if (!disabled) {
                        setDropdownOpen(prev => !prev);
                      }
                    }}
                    disabled={disabled}
                    className={cn(
                      "flex items-center gap-[calc(6px*var(--glint-ui-scale,1))] rounded-[10px] border border-v3-border px-[calc(12px*var(--glint-ui-scale,1))] py-[calc(6px*var(--glint-ui-scale,1))] text-[calc(12px*var(--glint-ui-scale,1))] font-semibold text-v3-dark transition-colors hover:bg-v3-dim-white",
                      disabled && "cursor-not-allowed opacity-60 hover:bg-white",
                    )}
                  >
                    {activeTabLabel}
                    <ChevronDown className={cn("h-[calc(14px*var(--glint-ui-scale,1))] w-[calc(14px*var(--glint-ui-scale,1))] text-v3-text-muted transition-transform", dropdownOpen && "rotate-180")} />
                  </button>
                  {dropdownOpen && !disabled && (
                    <div className="animate-in fade-in-0 zoom-in-95 absolute left-0 top-full z-50 mt-[calc(4px*var(--glint-ui-scale,1))] max-h-[calc(240px*var(--glint-ui-scale,1))] min-w-[calc(140px*var(--glint-ui-scale,1))] overflow-y-auto rounded-[14px] border border-v3-border bg-white py-[calc(4px*var(--glint-ui-scale,1))] shadow-v3">
                      {(tabs ?? []).map((tab) => (
                        <button
                          type="button"
                          key={tab.value}
                          onClick={() => { onTabChange?.(tab.value); setDropdownOpen(false); }}
                          className={cn(
                            "w-full px-[calc(16px*var(--glint-ui-scale,1))] py-[calc(8px*var(--glint-ui-scale,1))] text-left text-[calc(12px*var(--glint-ui-scale,1))] transition-colors",
                            activeTab === tab.value
                              ? cn("font-semibold bg-v3-primary-light", tab.activeClassName ?? "text-v3-primary")
                              : "text-v3-text-muted hover:bg-v3-dim-white hover:text-v3-text"
                          )}
                        >
                          {tab.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div
                  data-component={`${dataComponent}_top-area_controls_tab-scroll`}
                  data-slot="list-panel-tab-scroll"
                  className="min-w-0 flex-1 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
                >
                  <div
                    ref={inlineTabsRef}
                    data-component={`${dataComponent}_top-area_controls_tab-scroll_list`}
                    data-slot="list-panel-tab-list"
                    role={tabsAriaLabel ? "group" : undefined}
                    aria-label={tabsAriaLabel}
                    className="relative flex w-max gap-[calc(4px*var(--glint-ui-scale,1))]"
                  >
                    {(tabs ?? []).map((tab) => (
                      <button
                        data-component={`${dataComponent}_top-area_controls_tab-scroll_list_button`}
                        data-slot="list-panel-tab-button"
                        type="button"
                        key={tab.value}
                        ref={(node) => {
                          tabButtonRefs.current[tab.value] = node;
                        }}
                        disabled={disabled}
                        onClick={() => onTabChange?.(tab.value)}
                        aria-pressed={tabsAriaLabel ? activeTab === tab.value : undefined}
                        className={cn(
                          "relative shrink-0 px-[calc(12px*var(--glint-ui-scale,1))] pb-[calc(8px*var(--glint-ui-scale,1))] text-[calc(12px*var(--glint-ui-scale,1))] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-v3-primary",
                          activeTab === tab.value
                            ? cn("font-semibold", tab.activeClassName ?? "text-primary")
                            : "text-v3-text-muted hover:text-v3-text",
                          disabled && "cursor-not-allowed text-v3-text-muted/60 hover:text-v3-text-muted/60"
                        )}
                      >
                        {tab.label}
                      </button>
                    ))}
                    <span
                      data-component={`${dataComponent}_top-area_controls_tab-scroll_list_indicator`}
                      data-slot="list-panel-tab-indicator"
                      className={cn(
                        "pointer-events-none absolute bottom-0 left-0 h-0.5 will-change-[transform,width]",
                        activeTabIndicatorClassName,
                        isTabIndicatorTransitionEnabled &&
                          "transition-[transform,width,opacity,background-color] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
                        tabIndicatorMetrics.isReady ? "opacity-100" : "opacity-0",
                      )}
                      style={{
                        transform: `translateX(${tabIndicatorMetrics.left}px)`,
                        width: `${tabIndicatorMetrics.width}px`,
                      }}
                    />
                  </div>
                </div>
              )
            ) : null}
            {hasSearch && (
              <ExpandableSearch
                value={searchValue!}
                onChange={onSearchChange!}
                placeholder={searchPlaceholder}
                inputLabel={searchAriaLabel}
                className={tabsVariant === "inline" ? "pb-[calc(8px*var(--glint-ui-scale,1))]" : undefined}
                disabled={disabled}
                overlay={tabsVariant === "inline"}
              />
            )}
          </div>
        )}
      </div>
      {resolvedOverlay ? (
        <div
          data-component={`${dataComponent}_overlay`}
          data-slot="list-panel-overlay"
          className={cn(
            "pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-[calc(24px*var(--glint-ui-scale,1))]",
            overlay ? "-translate-y-[calc(12px*var(--glint-ui-scale,1))]" : undefined,
          )}
        >
          {resolvedOverlay}
        </div>
      ) : null}

      <div
        data-component={`${dataComponent}_content`}
        data-slot="list-panel-content"
        className="scrollbar-on-scroll relative flex min-h-0 flex-1 flex-col overflow-y-auto px-[calc(24px*var(--glint-ui-scale,1))] pt-[calc(12px*var(--glint-ui-scale,1))]"
        data-scroll-active={isScrollActive ? "true" : "false"}
        onScroll={handleScroll}
      >
        {showContentSkeleton ? contentSkeleton : children}
        <div className="sticky bottom-0 h-[calc(24px*var(--glint-ui-scale,1))] shrink-0 bg-white" />
      </div>
      {disabled ? (
        <div
          data-component={`${dataComponent}_disabled-overlay`}
          data-slot="list-panel-disabled-overlay"
          aria-hidden="true"
          className="absolute inset-0 z-20 bg-slate-200/70 backdrop-blur-[1.5px]"
        >
          {disabledOverlay ? (
            <div className="flex h-full items-center justify-center p-[calc(24px*var(--glint-ui-scale,1))]">{disabledOverlay}</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
