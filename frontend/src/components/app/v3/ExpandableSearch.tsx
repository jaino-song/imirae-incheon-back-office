"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface ExpandableSearchProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  expandedWidth?: string;
  className?: string;
  disabled?: boolean;
  overlay?: boolean;
  openLabel?: string;
  closeLabel?: string;
  inputLabel?: string;
}

export function ExpandableSearch({
  value,
  onChange,
  placeholder = "검색…",
  expandedWidth = "w-20",
  className,
  disabled = false,
  overlay = false,
  openLabel = "검색 열기",
  closeLabel = "검색 닫기",
  inputLabel = "검색어",
}: ExpandableSearchProps) {
  const [expanded, setExpanded] = useState(false);
  const [overlayExpandedWidth, setOverlayExpandedWidth] = useState("12rem");
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const resolveOverlayExpandedWidth = useCallback(() => {
    const container = rootRef.current?.closest<HTMLElement>('[data-slot="list-panel-controls"]');
    const containerWidth = container?.getBoundingClientRect().width ?? 0;

    if (!containerWidth) return "12rem";

    const rootFontSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const collapsedWidth = 2 * rootFontSize;
    const minimumWidth = 12 * rootFontSize;
    const preferredWidth = containerWidth * 0.55;
    const maximumWidth = Math.max(collapsedWidth, containerWidth - 1.5 * rootFontSize);
    const effectiveMinimumWidth = Math.min(minimumWidth, maximumWidth);
    const resolvedWidth = Math.min(Math.max(preferredWidth, effectiveMinimumWidth), maximumWidth);

    return `${resolvedWidth}px`;
  }, []);

  useEffect(() => {
    if (!overlay || !expanded) return;

    const container = rootRef.current?.closest<HTMLElement>('[data-slot="list-panel-controls"]');

    if (!container || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => {
      setOverlayExpandedWidth(resolveOverlayExpandedWidth());
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [expanded, overlay, resolveOverlayExpandedWidth]);

  const handleToggle = () => {
    if (disabled) return;

    if (!expanded) {
      if (overlay) {
        setOverlayExpandedWidth(resolveOverlayExpandedWidth());
      }
      setExpanded(true);
      setTimeout(() => inputRef.current?.focus(), 50);
      return;
    }

    onChange("");
    setExpanded(false);
  };

  const handleBlur = () => {
    if (!value) setExpanded(false);
  };

  if (overlay) {
    return (
      <div
        ref={rootRef}
        data-component="desktop_v3_expandable-search"
        className={cn("relative z-20 flex h-[calc(40px*var(--glint-ui-scale,1))] w-[calc(32px*var(--glint-ui-scale,1))] shrink-0 items-start justify-end overflow-visible", className)}
      >
        <div
          data-component="desktop_v3_expandable-search_overlay"
          data-expanded={expanded ? "true" : "false"}
          style={{
            width: expanded
              ? overlayExpandedWidth
              : "calc(32px * var(--glint-ui-scale, 1))",
          }}
          className={cn(
            "expandable-search-overlay-surface absolute right-0 top-0 flex h-[calc(40px*var(--glint-ui-scale,1))] items-start justify-start overflow-hidden rounded-[12px]",
            expanded
              ? "bg-white shadow-sm"
              : "w-[calc(32px*var(--glint-ui-scale,1))] bg-transparent"
          )}
        >
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={handleToggle}
            onMouseDown={(event) => event.preventDefault()}
            disabled={disabled}
            aria-label={expanded ? closeLabel : openLabel}
            className={cn(
              "h-[calc(32px*var(--glint-ui-scale,1))] w-[calc(32px*var(--glint-ui-scale,1))] shrink-0 rounded-[10px] border-0 bg-transparent p-0 shadow-none transition-transform duration-200 hover:bg-v3-dim-white hover:text-v3-text-muted",
              disabled && "cursor-not-allowed opacity-50 hover:bg-transparent",
            )}
          >
            <Search className="h-[calc(18px*var(--glint-ui-scale,1))] w-[calc(18px*var(--glint-ui-scale,1))] text-v3-text-muted" />
          </Button>
          <Input
            ref={inputRef}
            data-slot="input"
            variant="v3"
            type="text"
            aria-label={inputLabel}
            autoComplete="off"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onBlur={handleBlur}
            disabled={disabled}
            placeholder={expanded ? placeholder : undefined}
            style={{
              opacity: expanded ? 1 : 0,
              paddingInline: expanded ? "calc(8px * var(--glint-ui-scale, 1))" : 0,
              pointerEvents: expanded ? "auto" : "none",
            }}
            className={cn(
              "expandable-search-overlay-input h-[calc(32px*var(--glint-ui-scale,1))] min-h-0 min-w-0 w-auto flex-1 truncate rounded-none border-0 bg-transparent px-0 py-0 text-[calc(12.8px*var(--glint-ui-scale,1))] text-v3-dark shadow-none outline-none caret-v3-primary placeholder:text-v3-text-muted/70 focus-visible:border-0 focus-visible:ring-0 focus-visible:shadow-none",
              disabled && "cursor-not-allowed text-v3-text-muted",
            )}
          />
        </div>
      </div>
    );
  }

  return (
    <div data-component="desktop_v3_expandable-search" className={cn("flex items-center gap-[calc(6px*var(--glint-ui-scale,1))]", className)}>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={handleToggle}
        onMouseDown={(event) => event.preventDefault()}
        disabled={disabled}
        aria-label={expanded ? closeLabel : openLabel}
        className={cn(
          "h-[calc(32px*var(--glint-ui-scale,1))] w-[calc(32px*var(--glint-ui-scale,1))] shrink-0 rounded-[10px] border-0 bg-transparent p-0 shadow-none transition-transform duration-200 hover:bg-v3-dim-white hover:text-v3-text-muted",
          disabled && "cursor-not-allowed opacity-50 hover:bg-transparent",
        )}
      >
        <Search className="h-[calc(18px*var(--glint-ui-scale,1))] w-[calc(18px*var(--glint-ui-scale,1))] text-v3-text-muted" />
      </Button>
      <Input
        ref={inputRef}
        data-slot="input"
        variant="v3"
        type="text"
        aria-label={inputLabel}
        autoComplete="off"
        placeholder={expanded ? placeholder : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={handleBlur}
        disabled={disabled}
        style={{
          opacity: expanded ? 1 : 0,
          paddingInline: expanded ? "calc(8px * var(--glint-ui-scale, 1))" : 0,
          pointerEvents: expanded ? "auto" : "none",
        }}
        className={cn(
          "h-[calc(32px*var(--glint-ui-scale,1))] min-h-0 min-w-0 truncate rounded-[10px] bg-white py-0 text-[calc(12.8px*var(--glint-ui-scale,1))] text-v3-dark caret-v3-primary placeholder:text-v3-text-muted/70 transition-[width,opacity,padding-inline] duration-[260ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
          expanded ? expandedWidth : "w-0",
          disabled && "cursor-not-allowed text-v3-text-muted",
        )}
      />
    </div>
  );
}
