"use client";

import React, { useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";
import { TeaserOverlay } from "./TeaserOverlay";

type SlotClassNameArgs<T> = { index: number; item: T | null; isLoading: boolean };

export interface AnimatedSlotListProps<T> {
  /** Caller-context canonical base for the list root. */
  "data-component"?: string;
  /** Number of slots to render. If not provided, shows all items (unlimited). */
  count?: number;
  items?: readonly T[] | null;
  isLoading: boolean;
  /** Number of skeleton slots to show while loading (only used when count is not provided). Default: 4 */
  loadingCount?: number;
  className?: string;
  itemDataComponent?: string;
  /** Delay step in seconds (e.g. 0.04) */
  delayStepSeconds?: number;
  hideEmptySlots?: boolean;
  slotClassName?: string | ((args: SlotClassNameArgs<T>) => string);
  onSlotClick?: (item: T, index: number) => void;
  render: (args: { index: number; item: T | null; isLoading: boolean }) => React.ReactNode;

  // Load more functionality
  /** Whether there are more items to load */
  hasMore?: boolean;
  /** Called when user taps to load more */
  onLoadMore?: () => void;
  /** True when fetching more items */
  isFetchingMore?: boolean;
  /** True when showing initial teaser view (enables gradient overlay) */
  isInitialLoad?: boolean;
  /** Controls pop intro animation for slots. */
  animate?: boolean;
}

export function AnimatedSlotList<T>({
  "data-component": dataComponent,
  count,
  items,
  isLoading,
  loadingCount = 4,
  className,
  itemDataComponent,
  delayStepSeconds = 0.04,
  hideEmptySlots = true,
  slotClassName,
  onSlotClick,
  render,
  // Load more props
  hasMore = false,
  onLoadMore,
  isFetchingMore = false,
  isInitialLoad = false,
  animate = true,
}: AnimatedSlotListProps<T>) {
  const resolvedItemDataComponent =
    itemDataComponent ?? (dataComponent ? `${dataComponent}_item` : undefined);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadMoreTriggeredRef = useRef(false);
  const onLoadMoreRef = useRef<(() => void) | undefined>(onLoadMore);
  const isFetchingMoreRef = useRef(isFetchingMore);

  // If count is provided, use it. Otherwise, show all items (or loadingCount while loading)
  const itemsLength = items?.length ?? 0;
  const slotCount: number = count !== undefined ? count : (isLoading ? loadingCount : itemsLength);

  useEffect(() => {
    onLoadMoreRef.current = onLoadMore;
  }, [onLoadMore]);

  useEffect(() => {
    isFetchingMoreRef.current = isFetchingMore;
  }, [isFetchingMore]);

  useEffect(() => {
    if (isInitialLoad || !hasMore) {
      loadMoreTriggeredRef.current = false;
    }
  }, [isInitialLoad, hasMore]);

  // Calculate opacity for fade effect on teaser items (only last 2 items fade)
  const getItemOpacity = (index: number): number => {
    if (!isInitialLoad || !hasMore) return 1;
    // Items 1-4 fully visible, items 5-6 fade
    if (index < 4) return 1;
    // Item 5 (index 4) -> 0.5, Item 6 (index 5) -> 0.2
    const opacityValues = [0.5, 0.2];
    return opacityValues[index - 4] ?? 0.1;
  };

  // Intersection Observer for infinite scroll (after initial tap)
  useEffect(() => {
    // Only enable after initial teaser is dismissed
    if (isInitialLoad || !hasMore || !onLoadMoreRef.current) return;

    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const panelContent = sentinel.closest('[data-slot="list-panel-content"]');
    const panelRoot = panelContent instanceof HTMLElement ? panelContent : null;
    const hasScrollablePanel =
      panelRoot instanceof HTMLElement && panelRoot.scrollHeight > panelRoot.clientHeight + 1;
    const root = hasScrollablePanel ? panelRoot : null;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;

        if (!entry.isIntersecting) {
          loadMoreTriggeredRef.current = false;
          return;
        }

        if (loadMoreTriggeredRef.current || isFetchingMoreRef.current) return;

        loadMoreTriggeredRef.current = true;
        onLoadMoreRef.current?.();
      },
      {
        root,
        // Trigger near the bottom to avoid eager preloading all pages
        rootMargin: "0px 0px 120px 0px",
        threshold: 0,
      }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [isInitialLoad, hasMore]);

  // Show teaser overlay when in initial load state with more items
  const showTeaserOverlay =
    isInitialLoad &&
    hasMore &&
    itemsLength > 5 &&
    !isFetchingMore &&
    !isLoading;

  return (
    <div data-component={dataComponent} data-slot="animated-slot-list" className={cn("-mx-2 px-2", className)}>
      {Array.from({ length: slotCount }, (_, index) => {
        const item = !isLoading ? (items?.[index] ?? null) : null;

        const computedSlotClassName =
          typeof slotClassName === "function"
            ? slotClassName({ index, item, isLoading })
            : slotClassName ?? "";

        const shouldHide = hideEmptySlots && !isLoading && !item;
        const itemOpacity = getItemOpacity(index);

        return (
          <div
            key={`slot-${index}`}
            data-component={resolvedItemDataComponent}
            className={cn(
              animate && "animate-v3-pop-up",
              computedSlotClassName,
              shouldHide && "hidden"
            )}
            style={{
              animationDelay: animate ? `${Math.min(index, 4) * delayStepSeconds}s` : undefined,
              opacity: isLoading ? 1 : itemOpacity,
            }}
            onClick={
              !isLoading && item && onSlotClick ? () => onSlotClick(item, index) : undefined
            }
          >
            {render({ index, item, isLoading })}
          </div>
        );
      })}

      {/* Teaser overlay - entire area is clickable to load more */}
      {showTeaserOverlay && onLoadMore && (
        <TeaserOverlay
          data-component={dataComponent ? `${dataComponent}_teaser-overlay` : undefined}
          onClick={onLoadMore}
        />
      )}

      {/* Loading spinner when fetching more */}
      {isFetchingMore && (
        <div className="flex justify-center py-4">
          <Loader2 className="w-5 h-5 animate-spin text-v3-primary" />
        </div>
      )}

      {/* Sentinel for infinite scroll detection (invisible, at bottom of list) */}
      {!isInitialLoad && hasMore && !isFetchingMore && (
        <div ref={sentinelRef} className="h-1" aria-hidden="true" />
      )}
    </div>
  );
}
