"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";

export interface DetailTab {
  key: string;
  label: ReactNode;
}

export interface DetailTabsProps {
  tabs: DetailTab[];
  activeTab: string;
  onTabChange: (key: string) => void;
  isLoading?: boolean;
  ariaLabel?: string;
  idPrefix?: string;
}

export function DetailTabs({
  tabs,
  activeTab,
  onTabChange,
  isLoading = false,
  ariaLabel = "상세 정보",
  idPrefix,
}: DetailTabsProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [indicatorMetrics, setIndicatorMetrics] = useState({
    left: 0,
    width: 0,
    isReady: false,
  });
  const [isIndicatorTransitionEnabled, setIsIndicatorTransitionEnabled] = useState(false);

  const measureIndicator = useCallback(() => {
    const root = rootRef.current;
    const activeButton = buttonRefs.current[activeTab];

    if (!root || !activeButton) return;

    const rootRect = root.getBoundingClientRect();
    const buttonRect = activeButton.getBoundingClientRect();
    const nextMetrics = {
      left: buttonRect.left - rootRect.left,
      width: buttonRect.width,
      isReady: true,
    };

    setIndicatorMetrics((currentMetrics) =>
      currentMetrics.left === nextMetrics.left &&
      currentMetrics.width === nextMetrics.width &&
      currentMetrics.isReady === nextMetrics.isReady
        ? currentMetrics
        : nextMetrics
    );
  }, [activeTab]);

  useLayoutEffect(() => {
    const animationFrameId = requestAnimationFrame(measureIndicator);

    return () => cancelAnimationFrame(animationFrameId);
  }, [activeTab, measureIndicator]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(measureIndicator);
    resizeObserver?.observe(root);
    tabs.forEach((tab) => {
      const button = buttonRefs.current[tab.key];
      if (button) resizeObserver?.observe(button);
    });

    window.addEventListener("resize", measureIndicator);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", measureIndicator);
    };
  }, [activeTab, measureIndicator, tabs]);

  useEffect(() => {
    if (!indicatorMetrics.isReady) return;

    const animationFrameId = requestAnimationFrame(() => {
      setIsIndicatorTransitionEnabled(true);
    });

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [indicatorMetrics.isReady]);

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (isLoading) return;

    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
    if (event.key === "ArrowLeft") nextIndex = (index - 1 + tabs.length) % tabs.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = tabs.length - 1;
    if (nextIndex === null) return;

    event.preventDefault();
    const nextTab = tabs[nextIndex];
    if (!nextTab) return;

    onTabChange(nextTab.key);
    buttonRefs.current[nextTab.key]?.focus();
  };

  return (
    <div
      ref={rootRef}
      data-component="desktop_v3_detail-tabs"
      role="tablist"
      aria-label={ariaLabel}
      className="relative flex gap-[calc(4px*var(--glint-ui-scale,1))] border-b border-v3-border"
    >
      {tabs.map((tab, index) => (
        <button
          data-component="desktop_v3_detail-tabs_button"
          type="button"
          role="tab"
          key={tab.key}
          id={idPrefix ? `${idPrefix}-tab-${tab.key}` : undefined}
          aria-controls={idPrefix ? `${idPrefix}-panel-${tab.key}` : undefined}
          aria-selected={activeTab === tab.key}
          tabIndex={activeTab === tab.key ? 0 : -1}
          ref={(node) => {
            buttonRefs.current[tab.key] = node;
          }}
          onClick={() => {
            if (isLoading) return;
            onTabChange(tab.key);
          }}
          onKeyDown={(event) => handleKeyDown(event, index)}
          aria-disabled={isLoading ? "true" : undefined}
          className={cn(
            "relative px-[calc(12px*var(--glint-ui-scale,1))] pb-[calc(8px*var(--glint-ui-scale,1))] text-[calc(14px*var(--glint-ui-scale,1))] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-v3-primary",
            activeTab === tab.key
              ? "text-primary font-semibold"
              : "text-v3-text-muted hover:text-v3-text",
            isLoading && "cursor-default hover:text-inherit",
          )}
        >
          {isLoading ? (
            <span
              aria-hidden="true"
              data-slot="skeleton"
              data-component="desktop_v3_detail-tabs_button_text-skeleton"
              className={cn(
                "block h-[calc(16px*var(--glint-ui-scale,1))] animate-pulse rounded-md bg-v3-dim-white",
                index === 0 ? "w-16" : "w-14",
              )}
            />
          ) : tab.label}
        </button>
      ))}
      <div
        data-component="desktop_v3_detail-tabs_indicator"
        className={cn(
          "pointer-events-none absolute bottom-0 left-0 h-[calc(2px*var(--glint-ui-scale,1))] bg-primary",
          isIndicatorTransitionEnabled &&
            "transition-[transform,width,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
          indicatorMetrics.isReady ? "opacity-100" : "opacity-0"
        )}
        style={{
          transform: `translateX(${indicatorMetrics.left}px)`,
          width: `${indicatorMetrics.width}px`,
        }}
      />
    </div>
  );
}
