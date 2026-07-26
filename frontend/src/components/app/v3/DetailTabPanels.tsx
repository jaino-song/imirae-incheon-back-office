"use client";

import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

const DETAIL_TAB_PANEL_SLIDE_DURATION_MS = 300;

export interface DetailTabPanelItem {
  key: string;
  children: ReactNode;
  className?: string;
}

export interface DetailTabPanelsProps {
  panels: readonly DetailTabPanelItem[];
  activeTab: string;
  className?: string;
  trackClassName?: string;
  panelClassName?: string;
  "data-component"?: string;
  "data-panel-component"?: string;
  dataComponent?: string;
  panelDataComponent?: string;
  durationMs?: number;
  idPrefix?: string;
}

export function DetailTabPanels({
  panels,
  activeTab,
  className,
  trackClassName,
  panelClassName,
  "data-component": canonicalDataComponent,
  "data-panel-component": canonicalPanelDataComponent,
  dataComponent: legacyDataComponent,
  panelDataComponent: legacyPanelDataComponent,
  durationMs = DETAIL_TAB_PANEL_SLIDE_DURATION_MS,
  idPrefix,
}: DetailTabPanelsProps) {
  // TODO(data-component): Remove legacy fallbacks after all callers migrate.
  const dataComponent =
    canonicalDataComponent ?? legacyDataComponent ?? "desktop_v3_detail-tab-panels";
  const panelDataComponent =
    canonicalPanelDataComponent ?? legacyPanelDataComponent ?? "desktop_v3_detail-tab-panels_panel";
  const trackDataComponent = canonicalDataComponent
    ? `${dataComponent}_track`
    : `${dataComponent}-track`;
  const previousActiveTabRef = useRef(activeTab);
  const transitionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [visiblePanelKeys, setVisiblePanelKeys] = useState<string[]>(() => [activeTab]);

  const activeTabIndex = Math.max(
    0,
    panels.findIndex((panel) => panel.key === activeTab)
  );
  const panelKeys = useMemo(() => panels.map((panel) => panel.key).join("|"), [panels]);

  useLayoutEffect(() => {
    const previousActiveTab = previousActiveTabRef.current;
    previousActiveTabRef.current = activeTab;

    if (transitionTimeoutRef.current) {
      clearTimeout(transitionTimeoutRef.current);
      transitionTimeoutRef.current = null;
    }

    setVisiblePanelKeys(Array.from(new Set([previousActiveTab, activeTab])));
    transitionTimeoutRef.current = setTimeout(() => {
      setVisiblePanelKeys([activeTab]);
      transitionTimeoutRef.current = null;
    }, durationMs);

    return () => {
      if (transitionTimeoutRef.current) {
        clearTimeout(transitionTimeoutRef.current);
        transitionTimeoutRef.current = null;
      }
    };
  }, [activeTab, durationMs, panelKeys]);

  return (
    <div
      data-component={dataComponent}
      data-active-tab={activeTab}
      className={cn("overflow-hidden", className)}
    >
      <div
        data-component={trackDataComponent}
        className={cn(
          "flex transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform motion-reduce:transition-none",
          trackClassName
        )}
        style={{ transform: `translateX(-${activeTabIndex * 100}%)` }}
      >
        {panels.map((panel) => {
          const isActive = activeTab === panel.key;
          const isVisible = visiblePanelKeys.includes(panel.key);

          return (
            <section
              key={panel.key}
              data-component={panelDataComponent}
              data-panel={panel.key}
              id={idPrefix ? `${idPrefix}-panel-${panel.key}` : undefined}
              role={idPrefix ? "tabpanel" : undefined}
              aria-labelledby={idPrefix ? `${idPrefix}-tab-${panel.key}` : undefined}
              aria-hidden={!isActive}
              inert={isActive ? undefined : true}
              className={cn(
                "w-full min-w-0 shrink-0",
                !isActive && "pointer-events-none",
                !isVisible && "max-h-0 overflow-hidden",
                panelClassName,
                panel.className
              )}
            >
              {panel.children}
            </section>
          );
        })}
      </div>
    </div>
  );
}
