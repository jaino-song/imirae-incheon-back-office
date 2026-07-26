"use client";

import { useMemo, useState } from "react";
import type { KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { formatMessageDateTimeCompact } from "@babyjamjam/shared";

import "@/components/app/mobile-redesign/redesign.css";
import { useSystemTemplates } from "@/features/system-templates/hooks";
import { useMessageTemplates } from "@/hooks/use-message-templates";
import { useListInfiniteScroll } from "@/hooks/useListInfiniteScroll";
import {
  ListCard,
  ListLoadMoreButton,
  ListLoadMoreSentinel,
} from "@/components/app/mobile-redesign/primitives";
import { MessageSectionNav } from "@/components/app/mobile-redesign/MessageSectionNav";

import styles from "./page.module.css";

type TemplateKind = "system" | "user";
type TemplateFilter = "전체" | "기본 템플릿" | "지점 템플릿";
type TemplateIconName =
  | "message"
  | "send"
  | "check"
  | "userCheck"
  | "thumbsUp"
  | "checkCircle"
  | "calendar";

interface TemplateRow {
  id: string;
  displayId: string;
  kind: TemplateKind;
  name: string;
  eventLabel: string;
  updatedLabel: string;
  icon: TemplateIconName;
}

const TEMPLATE_FILTERS: TemplateFilter[] = [
  "전체",
  "기본 템플릿",
  "지점 템플릿",
];

const TEMPLATE_ICONS: TemplateIconName[] = [
  "message",
  "send",
  "check",
  "userCheck",
  "thumbsUp",
  "checkCircle",
  "calendar",
];

const getTemplateDestination = (template: TemplateRow): string => {
  if (template.kind === "system") {
    return `/messages/system-templates/${template.displayId}`;
  }

  return `/messages/templates/${encodeURIComponent(template.displayId)}/edit`;
};

const getFilterCount = (
  rows: TemplateRow[],
  filter: TemplateFilter,
): string => {
  if (filter === "전체") return String(rows.length);
  if (filter === "기본 템플릿") return String(rows.filter((row) => row.kind === "system").length);
  return String(rows.filter((row) => row.kind === "user").length);
};

const matchesFilter = (row: TemplateRow, filter: TemplateFilter): boolean => {
  if (filter === "전체") return true;
  if (filter === "기본 템플릿") return row.kind === "system";
  return row.kind === "user";
};

const normalizeSearch = (value: string): string => value.trim().toLocaleLowerCase("ko-KR");

export default function TemplatesPage() {
  const router = useRouter();
  const [activeFilter, setActiveFilter] = useState<TemplateFilter>("전체");
  const [searchQuery, setSearchQuery] = useState("");

  const { data: systemTemplates, isLoading: isLoadingSystemTemplates } = useSystemTemplates();
  const { data: userTemplates, isLoading: isLoadingUserTemplates } = useMessageTemplates();
  const isLoading = isLoadingSystemTemplates || isLoadingUserTemplates;

  const liveRows = useMemo<TemplateRow[]>(() => {
    const systemRows = (systemTemplates || []).map<TemplateRow>((template, index) => ({
      id: `system-${template.templateKey}`,
      displayId: template.templateKey,
      kind: "system",
      name: template.name,
      eventLabel: template.description || "기본 템플릿",
      updatedLabel: formatMessageDateTimeCompact(template.updatedAt),
      icon: TEMPLATE_ICONS[index % TEMPLATE_ICONS.length] ?? "message",
    }));

    const userRows = (userTemplates || []).map<TemplateRow>((template, index) => ({
      id: `user-${template.id}`,
      displayId: template.id,
      kind: "user",
      name: template.name,
      eventLabel: "지점 템플릿",
      updatedLabel: formatMessageDateTimeCompact(template.updatedAt),
      icon: TEMPLATE_ICONS[(index + 4) % TEMPLATE_ICONS.length] ?? "thumbsUp",
    }));

    return [...systemRows, ...userRows];
  }, [systemTemplates, userTemplates]);

  const rows = liveRows;

  const visibleRows = useMemo(() => {
    const query = normalizeSearch(searchQuery);
    return rows
      .filter((row) => matchesFilter(row, activeFilter))
      .filter((row) => {
        if (!query) return true;
        return `${row.name} ${row.eventLabel}`
          .toLocaleLowerCase("ko-KR")
          .includes(query);
      });
  }, [activeFilter, rows, searchQuery]);

  const systemRowsFull = visibleRows.filter((row) => row.kind === "system");
  const userRowsFull = visibleRows.filter((row) => row.kind === "user");
  const systemTitle = `기본 템플릿 · ${systemRowsFull.length}개`;
  const userTitle = `지점 템플릿 · ${userRowsFull.length}개`;

  const maxFullCount = Math.max(systemRowsFull.length, userRowsFull.length);
  const { visibleCount, isInitialLoad, hasMore, sentinelRef, scrollContainerRef, loadMore } =
    useListInfiniteScroll({
      resetKey: `${activeFilter}::${searchQuery}`,
      totalItems: maxFullCount,
    });

  const systemRows = systemRowsFull.slice(0, visibleCount);
  const userRows = userRowsFull.slice(0, visibleCount);

  const openTemplate = (row: TemplateRow) => {
    router.push(getTemplateDestination(row));
  };

  const handleRowKeyDown = (event: KeyboardEvent<HTMLDivElement>, row: TemplateRow) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openTemplate(row);
    }
  };

  return (
    <section
      data-component="mobile_messages_templates_page"
      data-slot="messages-page"
      data-page="messages-templates"
      className="messages-page"
    >
      <div
        className="shell-content flex-col gap-[calc(8px*var(--glint-ui-scale,1))]"
        data-component="mobile_messages_templates_page_content"
        data-slot="messages-content"
      >
        <MessageSectionNav
          data-component="mobile_messages_templates_page_content_section-nav"
          activeId="templates"
        />
        <ListCard
          data-component="mobile_messages_templates_page_content_list-card"
          title="템플릿 관리"
          actionLabel="+ 새 템플릿"
          actionHref="/messages/templates/new"
          filters={TEMPLATE_FILTERS.map((filter) => ({
            label: filter,
            count: getFilterCount(rows, filter),
          }))}
          activeFilter={activeFilter}
          onFilterChange={(filter) => setActiveFilter(filter as TemplateFilter)}
          beforeFilters={(
            <label className={`search-bar ${styles.searchBar}`} data-component="mobile_messages_templates_page_content_list-card_search">
              <MockupIcon name="search" size={14} />
              <input
                type="text"
                value={searchQuery}
                placeholder="템플릿명, 이벤트 검색"
                aria-label="템플릿명, 이벤트 검색"
                onChange={(event) => setSearchQuery(event.target.value)}
              />
            </label>
          )}
          scrollRef={scrollContainerRef}
          loadMore={isInitialLoad && hasMore ? (
            <ListLoadMoreButton
              data-component="mobile_messages_templates_page_content_list-card_load-more_button"
              onLoadMore={loadMore}
              dataComponentPrefix="messages-templates"
            />
          ) : null}
        >
            {isLoading ? (
              <div className="detail-empty-state" data-component="mobile_messages_templates_page_content_list-card_body_loading">
                템플릿을 불러오고 있습니다.
              </div>
            ) : null}
            {systemRows.length > 0 && (
              <TemplateSection
                title={systemTitle}
                rows={systemRows}
                onOpen={openTemplate}
                onKeyDown={handleRowKeyDown}
              />
            )}
            {userRows.length > 0 && (
              <TemplateSection
                title={userTitle}
                rows={userRows}
                onOpen={openTemplate}
                onKeyDown={handleRowKeyDown}
              />
            )}
            {!isLoading && visibleRows.length === 0 ? (
              <div className="detail-empty-state" data-component="mobile_messages_templates_page_content_list-card_body_empty">
                {searchQuery.trim() ? "조건에 맞는 템플릿이 없습니다." : "등록된 템플릿이 없습니다."}
              </div>
            ) : null}
            {!isInitialLoad && hasMore && (
              <ListLoadMoreSentinel
                data-component="mobile_messages_templates_page_content_list-card_body_sentinel"
                sentinelRef={sentinelRef}
                dataComponentPrefix="messages-templates"
              />
            )}
        </ListCard>
      </div>
    </section>
  );
}

function TemplateSection({
  title,
  rows,
  onOpen,
  onKeyDown,
}: {
  title: string;
  rows: TemplateRow[];
  onOpen: (row: TemplateRow) => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>, row: TemplateRow) => void;
}) {
  return (
    <div className="section-block" data-component="mobile_messages_templates_page_content_list-card_body_section">
      <div className="section-header" data-component="mobile_messages_templates_page_content_list-card_body_section_header">
        {title}
      </div>
      {rows.map((row) => (
        <TemplateListRow
          key={row.id}
          row={row}
          onOpen={onOpen}
          onKeyDown={onKeyDown}
        />
      ))}
    </div>
  );
}

function TemplateListRow({
  row,
  onOpen,
  onKeyDown,
}: {
  row: TemplateRow;
  onOpen: (row: TemplateRow) => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>, row: TemplateRow) => void;
}) {
  return (
    <div
      className="list-item"
      data-component="mobile_messages_templates_page_content_list-card_body_section_row"
      role="button"
      tabIndex={0}
      onClick={() => onOpen(row)}
      onKeyDown={(event) => onKeyDown(event, row)}
    >
      <div
        className={`${styles.templateIcon} ${styles.templateIconSms}`}
        data-component="mobile_messages_templates_page_content_list-card_body_section_row_icon"
      >
        <MockupIcon name={row.icon} size={18} />
      </div>
      <div className="list-info" data-component="mobile_messages_templates_page_content_list-card_body_section_row_info">
        <div className="list-name" data-component="mobile_messages_templates_page_content_list-card_body_section_row_info_name">
          {row.name}
          <span className={`${styles.channel} ${styles.channelSms}`}>
            SMS
          </span>
        </div>
        <div className={styles.templateMeta} data-component="mobile_messages_templates_page_content_list-card_body_section_row_info_meta">
          {row.eventLabel} <span className={styles.metaSeparator}>·</span> {row.updatedLabel}
        </div>
      </div>
    </div>
  );
}

function MockupIcon({
  name,
  size,
}: {
  name: TemplateIconName | "chevronLeft" | "search";
  size: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
    >
      {name === "chevronLeft" && <polyline points="15 18 9 12 15 6" />}
      {name === "search" && (
        <>
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.3-4.3" />
        </>
      )}
      {name === "message" && (
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      )}
      {name === "send" && (
        <>
          <path d="m22 2-7 20-4-9-9-4Z" />
          <path d="M22 2 11 13" />
        </>
      )}
      {name === "check" && <path d="M20 6 9 17l-5-5" />}
      {name === "userCheck" && (
        <>
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <polyline points="17 11 19 13 23 9" />
        </>
      )}
      {name === "thumbsUp" && (
        <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
      )}
      {name === "checkCircle" && (
        <>
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
          <polyline points="22 4 12 14.01 9 11.01" />
        </>
      )}
      {name === "calendar" && (
        <>
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <path d="M8 2v4M16 2v4M3 10h18" />
        </>
      )}
    </svg>
  );
}
