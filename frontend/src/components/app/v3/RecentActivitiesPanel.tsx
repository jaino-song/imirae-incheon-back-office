"use client";

import React, { useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { AlertTriangle, Loader2, Users } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getClientBadgeAvatarClassName,
  getClientBadges,
  getPrimaryClientBadge,
  prioritizeClientBadges,
} from "@/lib/client/badges";
import { getDashboardClientDueLabel } from "@/lib/dashboard/client-due";
import { cn } from "@/lib/utils";
import { AnimatedSlotList } from "./AnimatedSlotList";
import { AnimatedSlotListItemContent } from "./AnimatedSlotListItemContent";
import { ListEmptyState } from "./ListEmptyState";
import { ListPanel } from "./ListPanel";
import { StatusBadge } from "./StatusBadge";
import type { Client } from "@/lib/client/types";

type RecentActivityListItem = {
  key: string;
  client: Client;
};

export interface RecentActivitiesPanelProps {
  title?: string;
  items: Client[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  selectedId?: number | null;
  onSelect: (client: Client) => void;
  hasMore?: boolean;
  onLoadMore?: () => void;
  isFetchingMore?: boolean;
  viewAllHref?: string;
  viewAllLabel?: string;
  className?: string;
}

const SKELETON_ICON_BG = [
  "bg-v3-primary",
  "bg-[hsl(355,36%,45%)]",
  "bg-[hsl(34,100%,55%)]",
  "bg-[hsl(213,15%,50%)]",
];

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="p-8 text-center space-y-3">
      <div className="w-12 h-12 mx-auto rounded-[18px] bg-[hsl(355,40%,94%)] flex items-center justify-center">
        <AlertTriangle className="w-6 h-6 text-[hsl(355,36%,45%)]" />
      </div>
      <p className="text-[0.9rem] font-bold text-v3-dark">
        데이터를 불러올 수 없습니다
      </p>
      <p className="text-[0.73rem] text-v3-text-muted">
        네트워크 상태를 확인한 뒤 다시 시도해 주세요.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex items-center justify-center rounded-[12px] border border-[hsla(355,36%,45%,0.25)] bg-[hsl(355,40%,94%)] px-3 py-2 text-[0.73rem] font-bold text-[hsl(355,36%,45%)] transition hover:-translate-y-0.5"
      >
        다시 시도
      </button>
    </div>
  );
}

export function RecentActivitiesPanel({
  title = "최근 현황",
  items,
  isLoading,
  isError,
  onRetry,
  selectedId,
  onSelect,
  hasMore = false,
  onLoadMore,
  isFetchingMore = false,
  viewAllHref = "/clients",
  viewAllLabel = "전체 고객 보기",
  className,
}: RecentActivitiesPanelProps) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadMoreTriggeredRef = useRef(false);

  const listItems = useMemo<RecentActivityListItem[]>(() => items.map((client) => ({
    key: `recent-${client.id}`,
    client,
  })), [items]);

  useEffect(() => {
    loadMoreTriggeredRef.current = false;
  }, [listItems.length, hasMore, isFetchingMore]);

  useEffect(() => {
    if (!hasMore || !onLoadMore || isFetchingMore) {
      return;
    }

    const sentinel = sentinelRef.current;
    if (!sentinel) {
      return;
    }

    const scrollContainer = sentinel.closest('[data-slot="list-panel-content"]');
    const root = scrollContainer instanceof HTMLElement ? scrollContainer : null;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry?.isIntersecting || loadMoreTriggeredRef.current) {
          return;
        }

        loadMoreTriggeredRef.current = true;
        onLoadMore();
      },
      {
        root,
        rootMargin: "200px 0px",
        threshold: 0,
      },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, onLoadMore, isFetchingMore]);

  const isListEmpty = !isLoading && !isError && listItems.length === 0;

  return (
    <ListPanel data-component="desktop_dashboard_split_activities-panel_list-panel"
      title={title}
      emptyState={
        isListEmpty ? (
          <ListEmptyState message="종료 1영업일 전인 계약이 없습니다" />
        ) : undefined
      }
      className={className}
    >
      {!isLoading && isError ? (
        <ErrorState onRetry={onRetry} />
      ) : isListEmpty ? null : (
          <>
            <AnimatedSlotList<RecentActivityListItem>
              data-component="desktop_dashboard_split_activities-panel_list-panel_list"
              items={listItems}
              isLoading={isLoading}
              loadingCount={6}
              className="space-y-2"
              itemDataComponent="desktop_dashboard_split_activities-panel_list-panel_list_item"
              getItemKey={(item) => item.key}
              onSlotClick={(item) => onSelect(item.client)}
              itemVariant="card"
              getSlotState={({ item, isLoading: loading }) => ({
                isActive: !loading && item?.client.id === selectedId,
                isInteractive: !loading && Boolean(item),
              })}
              render={({ index, item, isLoading: loading }) => {
                if (loading) {
                  const iconBgClass =
                    SKELETON_ICON_BG[index % SKELETON_ICON_BG.length]?.split(" ")[0] ?? "bg-v3-primary";
                  return (
                    <>
                      <div
                        className={cn(
                          "w-11 h-11 rounded-[14px] flex items-center justify-center shrink-0",
                          iconBgClass,
                        )}
                      >
                        <Skeleton className="w-4 h-4 rounded-md bg-white/70" />
                      </div>
                      <div className="flex-1 min-w-0 space-y-2">
                        <div className="flex items-center gap-2">
                          <Skeleton className="h-4 w-24 bg-v3-dim-white" />
                          <Skeleton className="h-4 w-12 rounded-full bg-v3-dim-white" />
                        </div>
                        <Skeleton className="h-3 w-40 bg-v3-dim-white" />
                      </div>
                      <Skeleton className="h-6 w-14 rounded-full bg-v3-dim-white shrink-0" />
                    </>
                  );
                }

                if (!item) {
                  return null;
                }

                const clientBadges = getClientBadges(item.client);
                const sortedClientBadges = prioritizeClientBadges(clientBadges);
                const primaryClientBadge = getPrimaryClientBadge(clientBadges);
                const subtitle = getDashboardClientDueLabel(item.client)
                  ?? `${item.client.type || "일반"} · ${item.client.primaryEmployee?.name || "-"}`;

                return (
                  <AnimatedSlotListItemContent
                    dataComponent="desktop_dashboard_split_activities-panel_list-panel_list_item_content"
                    icon={Users}
                    iconContainerClassName={getClientBadgeAvatarClassName(primaryClientBadge)}
                    title={item.client.name}
                    subtitle={subtitle}
                    status={
                      sortedClientBadges.length > 0
                        ? sortedClientBadges.map((badge) => (
                            <StatusBadge
                              key={badge.key}
                              status={badge.status}
                              label={badge.label}
                            />
                          ))
                        : null
                    }
                  />
                );
              }}
            />
          </>
      )}

      {hasMore && onLoadMore && !isFetchingMore ? (
        <div ref={sentinelRef} className="h-1" aria-hidden="true" />
      ) : null}

      {isFetchingMore ? (
        <div className="flex justify-center py-4">
          <Loader2 className="w-5 h-5 animate-spin text-v3-primary" />
        </div>
      ) : null}

      {hasMore && !onLoadMore ? (
        <Link
          href={viewAllHref}
          className="inline-flex w-full items-center justify-center gap-2 rounded-[14px] border border-v3-border bg-v3-dim-white px-3 py-[11px] text-[0.75rem] font-bold text-v3-primary transition hover:-translate-y-0.5 hover:border-v3-primary/30 hover:bg-v3-primary-light"
        >
          {viewAllLabel} <span aria-hidden="true">→</span>
        </Link>
      ) : null}
    </ListPanel>
  );
}
