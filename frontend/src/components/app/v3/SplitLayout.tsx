"use client";

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useIsMobile } from "@/hooks/useIsMobile";
import { cn } from "@/lib/utils";
import { SplitLayoutContext } from "./SplitLayoutContext";

// Re-export the hook for external use
export { useSplitLayoutNav } from "./SplitLayoutContext";

interface SplitLayoutProps {
  "data-component": string;
  children: React.ReactNode;
  hasSelection?: boolean;
  onBack?: () => void;
  onModeChange?: (mode: SplitLayoutMode) => void;
  columns?: 2 | 3;
  activePanel?: number;
}

export type SplitLayoutMode = "desktop" | "compact";
const COMPACT_BREAKPOINT = 1280;
const COMPACT_PANEL_GAP = 16;
type SplitLayoutSelectionId = string | number;

interface CompactMetrics {
  listWidth: number;
  detailWidth: number;
  listOffset: number;
  viewportWidth: number;
}

interface SplitLayoutSelectionOptions {
  autoSelectFirstOnDesktop?: boolean;
  clearAutoSelectionOnCompact?: boolean;
}

function getDesktopGridClass(columns: 2 | 3): string {
  if (columns === 3) return "grid-cols-1 lg:grid-cols-3";
  return "grid-cols-[400px_minmax(0,1fr)]";
}

export function useSplitLayoutSelection<TId extends SplitLayoutSelectionId>(
  itemIds: readonly TId[],
  {
    autoSelectFirstOnDesktop = true,
    clearAutoSelectionOnCompact = true,
  }: SplitLayoutSelectionOptions = {}
) {
  const [selectedId, setSelectedIdState] = useState<TId | null>(null);
  const [splitLayoutMode, setSplitLayoutMode] = useState<SplitLayoutMode | null>(null);
  const autoSelectedIdRef = useRef<TId | null>(null);
  const isCompactSplitLayout = splitLayoutMode === "compact";

  const setSelectedId = useCallback((nextSelectedId: React.SetStateAction<TId | null>) => {
    autoSelectedIdRef.current = null;
    setSelectedIdState(nextSelectedId);
  }, []);

  useEffect(() => {
    if (itemIds.length === 0) {
      if (selectedId !== null) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setSelectedIdState(null);
        autoSelectedIdRef.current = null;
      }
      return;
    }

    const selectedExists = selectedId !== null && itemIds.includes(selectedId);

    if (selectedId !== null && !selectedExists) {
      setSelectedIdState(null);
      autoSelectedIdRef.current = null;
      return;
    }

    if (splitLayoutMode === null) return;

    if (isCompactSplitLayout) {
      if (
        clearAutoSelectionOnCompact &&
        selectedId !== null &&
        autoSelectedIdRef.current === selectedId
      ) {
        setSelectedIdState(null);
        autoSelectedIdRef.current = null;
      }
      return;
    }

    if (autoSelectFirstOnDesktop && selectedId === null) {
      const firstId = itemIds[0] ?? null;
      autoSelectedIdRef.current = firstId;
      setSelectedIdState(firstId);
    }
  }, [
    autoSelectFirstOnDesktop,
    clearAutoSelectionOnCompact,
    isCompactSplitLayout,
    itemIds,
    selectedId,
    splitLayoutMode,
  ]);

  return {
    selectedId,
    setSelectedId,
    splitLayoutMode,
    setSplitLayoutMode,
    isCompactSplitLayout,
  };
}

export function SplitLayout({
  "data-component": dataComponent,
  children,
  hasSelection = false,
  onBack,
  onModeChange,
  columns = 2,
  activePanel = 0,
}: SplitLayoutProps) {
  const isMobileViewport = useIsMobile();
  const splitLayoutRef = useRef<HTMLDivElement>(null);
  const compactSlideFrameRef = useRef<number | null>(null);
  const [mode, setMode] = useState<SplitLayoutMode>("desktop");
  const [isCompactSlideEnabled, setIsCompactSlideEnabled] = useState(false);
  const [compactMetrics, setCompactMetrics] = useState<CompactMetrics>({
    listWidth: 0,
    detailWidth: 0,
    listOffset: 0,
    viewportWidth: 0,
  });

  const rawChildArray = React.Children.toArray(children);
  const childArray = columns === 2 && rawChildArray.length > 2
    ? [
        rawChildArray[0],
        <React.Fragment key="split-layout-detail-group">
          {rawChildArray.slice(1)}
        </React.Fragment>,
      ]
    : rawChildArray;
  const isDynamicSplit = columns === 2 && childArray.length >= 2;
  const isCompact = mode === "compact";

  const goToList = useCallback(() => {
    onBack?.();
  }, [onBack]);

  const contextValue = useMemo(
    () => ({ goToList, isMobile: isCompact }),
    [goToList, isCompact]
  );

  const cancelCompactSlideFrame = useCallback(() => {
    if (compactSlideFrameRef.current === null) return;

    window.cancelAnimationFrame(compactSlideFrameRef.current);
    compactSlideFrameRef.current = null;
  }, []);

  const scheduleCompactSlideEnable = useCallback((nextMode: SplitLayoutMode) => {
    cancelCompactSlideFrame();
    setIsCompactSlideEnabled(false);

    if (nextMode !== "compact") return;

    compactSlideFrameRef.current = window.requestAnimationFrame(() => {
      compactSlideFrameRef.current = window.requestAnimationFrame(() => {
        compactSlideFrameRef.current = null;
        setIsCompactSlideEnabled(true);
      });
    });
  }, [cancelCompactSlideFrame]);

  const setRelatedMode = useCallback((nextMode: SplitLayoutMode) => {
    const root = splitLayoutRef.current;
    const mainContent = root?.closest<HTMLElement>('[data-component="main-content"]');

    root?.setAttribute("data-mode", nextMode);
    root
      ?.querySelector<HTMLElement>('[data-slot="split-layout-track"]')
      ?.setAttribute("data-mode", nextMode);
    root
      ?.querySelectorAll<HTMLElement>('[data-slot="split-layout-panel"]')
      .forEach((element) => element.setAttribute("data-mode", nextMode));
    mainContent?.setAttribute("data-mode", nextMode);
    mainContent
      ?.querySelector<HTMLElement>('[data-component="section-nav"]')
      ?.setAttribute("data-mode", nextMode);
    mainContent
      ?.querySelector<HTMLElement>('[data-component="section-nav-desktop"]')
      ?.setAttribute("data-mode", nextMode);
    mainContent
      ?.querySelector<HTMLElement>('[data-component="section-nav-mobile"]')
      ?.setAttribute("data-mode", nextMode);
    mainContent
      ?.querySelector<HTMLElement>('[data-component="floating-quick-actions"]')
      ?.setAttribute("data-mode", nextMode);
  }, []);

  const measureAndApplyMode = useCallback(() => {
    const root = splitLayoutRef.current;

    if (!root) return;

    if (!isDynamicSplit) {
      const nextMode = isMobileViewport ? "compact" : "desktop";
      setMode(nextMode);
      setRelatedMode(nextMode);
      scheduleCompactSlideEnable(nextMode);
      onModeChange?.(nextMode);
      return;
    }

    const track = root.querySelector<HTMLElement>('[data-slot="split-layout-track"]');
    const listPanel = root.querySelector<HTMLElement>('[data-slot="split-layout-panel"][data-panel="list"]');
    const detailPanel = root.querySelector<HTMLElement>('[data-slot="split-layout-panel"][data-panel="detail"]');
    const mainContent = root.closest<HTMLElement>('[data-component="main-content"]');
    const floatingActions = mainContent?.querySelector<HTMLElement>('[data-component="floating-quick-actions"]');

    if (!track || !listPanel || !detailPanel || !mainContent) return;

    const relatedElements = [
      root,
      track,
      listPanel,
      detailPanel,
      mainContent,
      mainContent.querySelector<HTMLElement>('[data-component="section-nav"]'),
      mainContent.querySelector<HTMLElement>('[data-component="section-nav-desktop"]'),
      mainContent.querySelector<HTMLElement>('[data-component="section-nav-mobile"]'),
      floatingActions,
    ].filter((element): element is HTMLElement => element !== null);

    const previousModes = relatedElements.map((element) => [
      element,
      element.getAttribute("data-mode"),
    ] as const);
    const previousRootVars = {
      listWidth: root.style.getPropertyValue("--compact-list-width"),
      detailWidth: root.style.getPropertyValue("--compact-detail-width"),
      listOffset: root.style.getPropertyValue("--compact-list-offset"),
      viewportWidth: root.style.getPropertyValue("--compact-viewport-width"),
      panelGap: root.style.getPropertyValue("--compact-panel-gap"),
    };
    const previousInlineStyles = {
      trackTransform: track.style.transform,
      listWidth: listPanel.style.width,
      detailWidth: detailPanel.style.width,
    };

    const restoreCustomProperty = (property: string, value: string) => {
      if (value) {
        root.style.setProperty(property, value);
        return;
      }

      root.style.removeProperty(property);
    };

    const restoreMeasurementStyles = () => {
      restoreCustomProperty("--compact-list-width", previousRootVars.listWidth);
      restoreCustomProperty("--compact-detail-width", previousRootVars.detailWidth);
      restoreCustomProperty("--compact-list-offset", previousRootVars.listOffset);
      restoreCustomProperty("--compact-viewport-width", previousRootVars.viewportWidth);
      restoreCustomProperty("--compact-panel-gap", previousRootVars.panelGap);
      track.style.transform = previousInlineStyles.trackTransform;
      listPanel.style.width = previousInlineStyles.listWidth;
      detailPanel.style.width = previousInlineStyles.detailWidth;
    };

    let measuredCompactPanelWidth = 0;

    try {
      track.style.transform = "none";
      listPanel.style.width = "";
      detailPanel.style.width = "";

      relatedElements.forEach((element) => element.setAttribute("data-mode", "compact"));
      const compactWidth = root.parentElement?.getBoundingClientRect().width
        ?? root.getBoundingClientRect().width;
      const compactPanelWidth = Math.max(0, compactWidth);

      root.style.setProperty("--compact-list-width", `${compactPanelWidth}px`);
      root.style.setProperty("--compact-detail-width", `${compactPanelWidth}px`);
      root.style.setProperty("--compact-list-offset", `${compactPanelWidth}px`);
      root.style.setProperty("--compact-viewport-width", `${compactPanelWidth}px`);
      root.style.setProperty("--compact-panel-gap", `${COMPACT_PANEL_GAP}px`);
      listPanel.style.width = "var(--compact-list-width, 100%)";
      detailPanel.style.width = "var(--compact-detail-width, 100%)";
      measuredCompactPanelWidth = detailPanel.getBoundingClientRect().width;
    } finally {
      restoreMeasurementStyles();
      previousModes.forEach(([element, previousMode]) => {
        if (previousMode === null) {
          element.removeAttribute("data-mode");
          return;
        }

        element.setAttribute("data-mode", previousMode);
      });
    }

    const nextMode = window.innerWidth < COMPACT_BREAKPOINT
      ? "compact"
      : "desktop";

    setCompactMetrics({
      listWidth: measuredCompactPanelWidth,
      detailWidth: measuredCompactPanelWidth,
      listOffset: measuredCompactPanelWidth + COMPACT_PANEL_GAP,
      viewportWidth: measuredCompactPanelWidth,
    });
    setMode(nextMode);
    setRelatedMode(nextMode);
    scheduleCompactSlideEnable(nextMode);
    onModeChange?.(nextMode);
  }, [isDynamicSplit, isMobileViewport, onModeChange, scheduleCompactSlideEnable, setRelatedMode]);

  useLayoutEffect(() => {
    return () => cancelCompactSlideFrame();
  }, [cancelCompactSlideFrame]);

  useLayoutEffect(() => {
    measureAndApplyMode();

    window.addEventListener("resize", measureAndApplyMode);
    return () => window.removeEventListener("resize", measureAndApplyMode);
  }, [measureAndApplyMode, childArray.length]);

  const mobileOffset = columns === 3
    ? activePanel
    : hasSelection ? 1 : 0;
  const compactTransform = columns === 3
    ? `translateX(-${mobileOffset * 100}%)`
    : hasSelection
      ? "translateX(calc(-1 * var(--compact-list-offset, 100%)))"
      : "translateX(0)";
  const compactViewportWidth = columns === 2 && isCompact
    ? hasSelection
      ? compactMetrics.detailWidth
      : compactMetrics.listWidth
    : compactMetrics.viewportWidth;
  const compactStyle = {
    "--compact-list-width": `${compactMetrics.listWidth}px`,
    "--compact-detail-width": `${compactMetrics.detailWidth}px`,
    "--compact-list-offset": `${compactMetrics.listOffset}px`,
    "--compact-viewport-width": `${compactViewportWidth}px`,
    "--compact-panel-gap": `${columns === 2 ? COMPACT_PANEL_GAP : 0}px`,
  } as React.CSSProperties;

  return (
    <SplitLayoutContext.Provider value={contextValue}>
      <div
        ref={splitLayoutRef}
        data-component={dataComponent}
        data-source-component="SplitLayout"
        data-slot="split-layout"
        data-columns={columns}
        data-has-selection={hasSelection ? "true" : "false"}
        data-mode={mode}
        className={cn(
          "flex-1 h-full min-w-0 min-h-0",
          "grid gap-[calc(16px*var(--glint-ui-scale,1))]",
          getDesktopGridClass(columns),
          "data-[mode=compact]:block data-[mode=compact]:relative data-[mode=compact]:w-full data-[mode=compact]:overflow-hidden data-[mode=compact]:rounded-[28px]",
        )}
        style={compactStyle}
      >
        <div
          data-component={`${dataComponent}_track`}
          data-slot="split-layout-track"
          data-mode={mode}
          className={cn(
            "contents",
            "data-[mode=compact]:flex data-[mode=compact]:h-full data-[mode=compact]:gap-[var(--compact-panel-gap)]",
            isCompactSlideEnabled && [
              "data-[mode=compact]:transition-transform",
              "data-[mode=compact]:duration-300",
              "data-[mode=compact]:ease-[cubic-bezier(0.22,1,0.36,1)]",
              "data-[mode=compact]:will-change-transform",
              "motion-reduce:transition-none",
            ],
          )}
          style={isCompact ? { transform: compactTransform } : undefined}
        >
          {childArray.map((child, index) => {
            const key = (child as React.ReactElement).key ?? `split-panel-${index}`;
            const panelName = index === 0 ? "list" : "detail";
            const isInactiveCompactPanel = isCompact && index !== mobileOffset;
            const panelStyle = isCompact && columns === 2
              ? {
                  width: index === 0
                    ? "var(--compact-list-width, 100%)"
                    : "var(--compact-detail-width, 100%)",
                }
              : undefined;

            return (
              <div
                key={key}
                data-component={`${dataComponent}_track_panel`}
                data-slot="split-layout-panel"
                data-panel={panelName}
                aria-hidden={isInactiveCompactPanel || undefined}
                inert={isInactiveCompactPanel || undefined}
                className={cn(
                  "min-w-0 min-h-0 flex flex-col",
                  "data-[mode=compact]:h-full data-[mode=compact]:shrink-0 data-[mode=compact]:overflow-y-auto",
                  columns === 3 && isCompact && "w-full flex-shrink-0",
                  "animate-v3-slide-up",
                )}
                data-mode={mode}
                style={panelStyle}
              >
                {child}
              </div>
            );
          })}
        </div>
      </div>
    </SplitLayoutContext.Provider>
  );
}
