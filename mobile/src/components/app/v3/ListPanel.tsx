"use client";

import React, { useState, useEffect, useRef } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { ExpandableSearch } from "./ExpandableSearch";
import { PanelTitleGroup } from "./PanelTitleGroup";

interface TabItem {
  label: string;
  value: string;
}

interface ListPanelProps {
  /** Caller-context canonical base, e.g. `mobile_admin_feedback_split-layout_list-panel`. */
  "data-component": string;
  title: string;
  subtitle?: string;
  tabs?: TabItem[];
  activeTab?: string;
  onTabChange?: (value: string) => void;
  tabsVariant?: "inline" | "dropdown";
  headerPadding?: "auto" | "compact" | "default";
  children: React.ReactNode;
  headerActions?: React.ReactNode;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  isLoading?: boolean;
  isContentLoading?: boolean;
  contentSkeleton?: React.ReactNode;
}

export function ListPanel({
  "data-component": dataComponent,
  title,
  subtitle,
  tabs,
  activeTab,
  onTabChange,
  tabsVariant = "inline",
  headerPadding = "auto",
  children,
  headerActions,
  searchValue,
  onSearchChange,
  searchPlaceholder = "검색...",
  isLoading = false,
  isContentLoading = false,
  contentSkeleton,
}: ListPanelProps) {
  const sub = (suffix: string) => `${dataComponent}_${suffix}`;
  const showTabs = tabs && tabs.length > 0;
  const showContentSkeleton = (isLoading || isContentLoading) && contentSkeleton;
  const hasSearch = searchValue !== undefined && !!onSearchChange;
  const headerAlignmentClass = subtitle ? "items-start" : "items-center";
  const headerClassName =
    headerPadding === "default"
      ? `flex ${headerAlignmentClass} justify-between p-6 shrink-0`
      : headerPadding === "compact"
        ? `flex ${headerAlignmentClass} justify-between p-6 pb-0 shrink-0`
        : showTabs
          ? `flex ${headerAlignmentClass} justify-between p-6 pb-0 shrink-0`
          : `flex ${headerAlignmentClass} justify-between p-6 shrink-0`;
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

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

  const activeTabLabel = tabs?.find(t => t.value === activeTab)?.label ?? tabs?.[0]?.label ?? "";

  return (
    <div data-component={dataComponent} className="bg-white rounded-2xl shadow-v3 flex flex-col overflow-hidden h-full min-h-0">
      <div data-component={sub("header")} className={headerClassName}>
        <PanelTitleGroup
          component="list-panel"
          title={title}
          subtitle={subtitle}
          titleClassName="text-lg"
        />
        {headerActions && <div data-component={sub("header_actions")}>{headerActions}</div>}
      </div>

      {showTabs && (
        <div data-component={sub("tabs")} className="flex items-center justify-between px-6 pt-4 shrink-0">
          {tabsVariant === "dropdown" ? (
            <div ref={dropdownRef} className="relative">
              <button
                onClick={() => setDropdownOpen(prev => !prev)}
                className="flex items-center gap-1.5 text-[0.8rem] font-semibold text-v3-dark px-3 py-1.5 rounded-2xl border border-v3-border hover:bg-v3-dim-white transition-colors"
              >
                {activeTabLabel}
                <ChevronDown className={cn("w-3.5 h-3.5 text-v3-text-muted transition-transform", dropdownOpen && "rotate-180")} />
              </button>
              {dropdownOpen && (
                <div className="absolute top-full left-0 z-50 mt-1 min-w-[140px] max-h-[240px] overflow-y-auto rounded-2xl border border-v3-border bg-white shadow-v3 py-1 animate-in fade-in-0 zoom-in-95">
                  {(tabs ?? []).map((tab) => (
                    <button
                      key={tab.value}
                      onClick={() => { onTabChange?.(tab.value); setDropdownOpen(false); }}
                      className={cn(
                        "w-full text-left text-[0.8rem] px-4 py-2 transition-colors",
                        activeTab === tab.value
                          ? "text-v3-primary font-semibold bg-v3-primary-light"
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
            <div className="flex gap-1">
              {(tabs ?? []).map((tab) => (
                <button
                  data-component={sub("tabs_tab-button")}
                  type="button"
                  key={tab.value}
                  onClick={() => onTabChange?.(tab.value)}
                  className={cn(
                    "relative inline-flex min-h-[44px] items-center px-3 text-[0.8rem] transition-colors",
                    activeTab === tab.value
                      ? "text-primary font-semibold"
                      : "text-v3-text-muted hover:text-v3-text"
                  )}
                >
                  {tab.label}
                  {activeTab === tab.value ? (
                    <span
                      data-component={sub("tabs_tab-button_indicator")}
                      className="absolute bottom-0 left-0 h-0.5 w-full bg-primary"
                    />
                  ) : null}
                </button>
              ))}
            </div>
          )}
          {hasSearch && (
            <ExpandableSearch
              data-component={sub("tabs_search")}
              value={searchValue!}
              onChange={onSearchChange!}
              placeholder={searchPlaceholder}
              className={tabsVariant === "inline" ? "pb-2" : undefined}
            />
          )}
        </div>
      )}

      <div data-component={sub("content")} data-slot="list-panel-content" className="relative overflow-y-auto scrollbar-hide min-h-0 flex-1 p-6">
        <div
          key={showContentSkeleton ? "skeleton" : "content"}
          style={{ transition: "opacity var(--duration-feedback) var(--ease-standard)" }}
        >
          {showContentSkeleton ? contentSkeleton : children}
        </div>
        {/* <div className="sticky bottom-0 h-6 bg-white shrink-0" /> */}
      </div>
    </div>
  );
}
