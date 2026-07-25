"use client";

import React, { useRef, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type SlotClassNameArgs<T> = { index: number; item: T | null; isLoading: boolean };
type SlotVariant = "unstyled" | "card";
type SlotState = {
  isActive?: boolean;
  isInteractive?: boolean;
};

export interface AnimatedSlotListProps<T> {
  /** Number of slots to render. If not provided, shows all items (unlimited). */
  count?: number;
  items?: readonly T[] | null;
  isLoading: boolean;
  /** Number of skeleton slots to show while loading (only used when count is not provided). Default: 4 */
  loadingCount?: number;
  /** Number of skeleton slots to append while fetching more. Defaults to 0 to avoid reserving empty list space. */
  fetchingMoreCount?: number;
  className?: string;
  itemDataComponent?: string;
  itemVariant?: SlotVariant;
  /** Delay step in seconds (e.g. 0.04) */
  delayStepSeconds?: number;
  hideEmptySlots?: boolean;
  getSlotState?: (args: SlotClassNameArgs<T>) => SlotState;
  slotClassName?: string | ((args: SlotClassNameArgs<T>) => string);
  onSlotClick?: (item: T, index: number) => void;
  getItemKey?: (item: T, index: number) => string;
  render: (args: { index: number; item: T | null; isLoading: boolean }) => React.ReactNode;

  /** Whether there are more items to load */
  hasMore?: boolean;
  /** Called when sentinel becomes visible */
  onLoadMore?: () => void;
  /** True when fetching more items */
  isFetchingMore?: boolean;
}

export function AnimatedSlotList<T>({
  count,
  items,
  isLoading,
  loadingCount = 4,
  fetchingMoreCount,
  className,
  itemDataComponent = "animated-slot-list-item",
  itemVariant = "card",
  delayStepSeconds = 0.04,
  hideEmptySlots = true,
  getSlotState,
  slotClassName,
  onSlotClick,
  getItemKey,
  render,
  hasMore = false,
  onLoadMore,
  isFetchingMore = false,
}: AnimatedSlotListProps<T>) {
  const listRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadMoreTriggeredRef = useRef(false);

  const itemsLength = items?.length ?? 0;
  const effectiveFetchingMoreCount = fetchingMoreCount ?? 0;
  const slotCount: number =
    count !== undefined
      ? count
      : isLoading
        ? loadingCount
        : itemsLength + (isFetchingMore ? effectiveFetchingMoreCount : 0);

  useEffect(() => {
    loadMoreTriggeredRef.current = false;
  }, [itemsLength, hasMore, isFetchingMore]);

  useEffect(() => {
    if (!hasMore || !onLoadMore || isFetchingMore) return;

    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const panelContent = sentinel.closest('[data-slot="list-panel-content"]');
    const root = panelContent instanceof HTMLElement ? panelContent : null;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry?.isIntersecting || loadMoreTriggeredRef.current) return;

        loadMoreTriggeredRef.current = true;
        onLoadMore();
      },
      {
        root,
        rootMargin: "200px 0px",
        threshold: 0,
      }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, onLoadMore, isFetchingMore]);

  return (
    <div
      ref={listRef}
      data-component="animated-slot-list"
      className={cn("relative -mx-2 flex flex-col gap-2 px-2", className)}
    >
      {Array.from({ length: slotCount }, (_, index) => {
        const isAppendLoadingSlot = !isLoading && isFetchingMore && index >= itemsLength;
        const isSlotLoading = isLoading || isAppendLoadingSlot;
        const item = !isSlotLoading ? (items?.[index] ?? null) : null;
        const slotArgs = { index, item, isLoading: isSlotLoading };

        const staggerIndex = isAppendLoadingSlot ? index - itemsLength : index;
        const shouldAnimateSlot = staggerIndex > 0;
        const animationDelay = `${Math.max(0, staggerIndex) * delayStepSeconds}s`;
        const slotState = getSlotState?.(slotArgs) ?? {};
        const isInteractive =
          slotState.isInteractive ?? Boolean(!isSlotLoading && item && onSlotClick);
        const variantClassName =
          itemVariant === "card"
            ? cn(
                "flex h-[calc(94px*var(--glint-ui-scale,1))] items-center gap-[calc(12px*var(--glint-ui-scale,1))] overflow-hidden rounded-[18px] border-2 border-transparent bg-white p-[calc(16px*var(--glint-ui-scale,1))] text-left transition-all duration-200 [&>*:only-child]:w-full",
                isInteractive &&
                  "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-v3-primary focus-visible:ring-offset-2",
                slotState.isActive
                  ? "border-v3-primary bg-v3-primary-light"
                  : isInteractive && "hover:border-v3-primary/30 hover:bg-v3-primary-light/50"
              )
            : "";

        const computedSlotClassName =
          typeof slotClassName === "function"
            ? slotClassName(slotArgs)
            : slotClassName ?? "";

        const shouldHide = hideEmptySlots && !isSlotLoading && !item;
        const slotKey =
          !isSlotLoading && item && getItemKey
            ? getItemKey(item, index)
            : `slot-${index}`;

        if (isSlotLoading && itemVariant === "card") {
          return (
            <div
              key={slotKey}
              data-component={itemDataComponent}
              className={cn(
                shouldAnimateSlot && "animate-v3-pop-up",
                "h-[calc(94px*var(--glint-ui-scale,1))] overflow-hidden px-[calc(16px*var(--glint-ui-scale,1))] py-[calc(16px*var(--glint-ui-scale,1))]",
                computedSlotClassName
              )}
              style={shouldAnimateSlot ? { animationDelay } : undefined}
            >
              <div
                data-component={`${itemDataComponent}-text-skeleton`}
                className="ml-[calc(56px*var(--glint-ui-scale,1))] max-w-[calc(220px*var(--glint-ui-scale,1))] space-y-[calc(8px*var(--glint-ui-scale,1))]"
              >
                <Skeleton className="h-[calc(16px*var(--glint-ui-scale,1))] w-[calc(112px*var(--glint-ui-scale,1))] bg-v3-dim-white" />
                <Skeleton className="h-[calc(12px*var(--glint-ui-scale,1))] w-full bg-v3-dim-white" />
              </div>
            </div>
          );
        }

        const handleClick =
          !isSlotLoading && item && onSlotClick ? () => onSlotClick(item, index) : undefined;

        return (
          <div
            key={slotKey}
            data-component={itemDataComponent}
            className={cn(
              shouldAnimateSlot && "animate-v3-pop-up",
              variantClassName,
              computedSlotClassName,
              shouldHide && "hidden"
            )}
            style={shouldAnimateSlot ? { animationDelay } : undefined}
            onClick={handleClick}
            {...(isInteractive && handleClick
              ? {
                  role: "button" as const,
                  tabIndex: 0,
                  "aria-pressed":
                    slotState.isActive === undefined ? undefined : Boolean(slotState.isActive),
                  onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
                    if (event.key === "Enter" || event.key === " ") {
                      if (event.key === " ") event.preventDefault();
                      handleClick();
                    }
                  },
                }
              : {})}
          >
            {render({ index, item, isLoading: isSlotLoading })}
          </div>
        );
      })}

      {hasMore && !isFetchingMore && (
        <div ref={sentinelRef} className="h-1" aria-hidden="true" />
      )}

      {isFetchingMore && (
        <div className="flex justify-center py-4">
          <Loader2 className="w-5 h-5 animate-spin text-v3-primary" />
        </div>
      )}

    </div>
  );
}
