"use client";

import { useState } from "react";
import Link from "next/link";
import type { ComponentProps, CSSProperties, ReactNode, RefObject } from "react";
import { ChevronDown, ChevronRight, FileCheck2, type LucideIcon } from "lucide-react";

import { StatusPill } from "@/components/app/ui/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ListCardBody } from "./ListCardBody";
import { ListCardHeader } from "./ListCardHeader";
import { ListCardLoadMore } from "./ListCardLoadMore";
import type { ContractRow, ListRow, MenuGroup, SectionRows } from "./mockup-data";

const LIST_LOAD_MORE_BUTTON_SOURCE_COMPONENT = "ListLoadMoreButton";
const LIST_LOAD_MORE_SENTINEL_SOURCE_COMPONENT = "ListLoadMoreSentinel";
const LIST_COUNT_SKELETON_SOURCE_COMPONENT = "ListCountSkeleton";
const LIST_ROWS_SKELETON_SOURCE_COMPONENT = "ListRowsSkeleton";
const FILTER_PILLS_SOURCE_COMPONENT = "FilterPills";
const MOBILE_SECTION_NAV_SOURCE_COMPONENT = "MobileSectionNav";
const LIST_CARD_SOURCE_COMPONENT = "ListCard";
const SECTIONED_LIST_SOURCE_COMPONENT = "SectionedList";
const LIST_ITEM_ROW_SOURCE_COMPONENT = "ListItemRow";
const CONTRACT_LIST_SOURCE_COMPONENT = "ContractList";
/**
 * TODO(data-component): Remove these legacy fallbacks after caller migration.
 * data-component="section-nav-mobile"
 * data-component="mobile-redesign-list-card"
 * data-component="mobile-redesign-filter-row"
 * data-component="mobile-redesign-filter-pill"
 * data-component="mobile-redesign-filter-pill"
 * data-component="mobile-redesign-action-feedback"
 * data-component="mobile-redesign-contract-section"
 * data-component="mobile-redesign-contract-row"
 */

export function ListLoadMoreButton({
  "data-component": dataComponent,
  onLoadMore,
  dataComponentPrefix,
}: {
  "data-component"?: string;
  onLoadMore: () => void;
  dataComponentPrefix: string;
}) {
  return (
    <button
      type="button"
      onClick={onLoadMore}
      className="peek-bounce flex min-h-[44px] min-w-[44px] flex-col items-center justify-center gap-0.5 text-v3-primary"
      // TODO(data-component): Remove the legacy fallback after caller migration.
      data-component={dataComponent ?? `${dataComponentPrefix}-load-more-button`}
      data-source-component={LIST_LOAD_MORE_BUTTON_SOURCE_COMPONENT}
      aria-label="더 많은 항목 불러오기"
    >
      <span className="text-[0.78rem] font-bold">탭하여 더보기</span>
      <ChevronDown size={20} strokeWidth={2.5} />
    </button>
  );
}

export function ListLoadMoreSentinel({
  "data-component": dataComponent,
  sentinelRef,
  dataComponentPrefix,
}: {
  "data-component"?: string;
  sentinelRef: RefObject<HTMLDivElement | null>;
  dataComponentPrefix: string;
}) {
  return (
    <div
      ref={sentinelRef}
      className="h-1"
      aria-hidden="true"
      // TODO(data-component): Remove the legacy fallback after caller migration.
      data-component={dataComponent ?? `${dataComponentPrefix}-load-sentinel`}
      data-source-component={LIST_LOAD_MORE_SENTINEL_SOURCE_COMPONENT}
    />
  );
}

export function ListCountSkeleton({
  "data-component": dataComponent,
  dataComponentPrefix,
}: {
  "data-component"?: string;
  dataComponentPrefix: string;
}) {
  return (
    <span
      className="inline-block h-[0.7rem] w-7 animate-pulse rounded-full bg-v3-dim-white align-middle"
      // TODO(data-component): Remove the legacy fallback after caller migration.
      data-component={dataComponent ?? `${dataComponentPrefix}-count-skeleton`}
      data-source-component={LIST_COUNT_SKELETON_SOURCE_COMPONENT}
    />
  );
}

export function ListRowsSkeleton({
  "data-component": dataComponent,
  dataComponentPrefix,
  rowCount = 6,
}: {
  "data-component"?: string;
  dataComponentPrefix: string;
  rowCount?: number;
}) {
  return (
    <div
      className="section-block"
      // TODO(data-component): Remove the legacy fallbacks after caller migration.
      data-component={dataComponent ?? `${dataComponentPrefix}-loading-skeleton`}
      data-source-component={LIST_ROWS_SKELETON_SOURCE_COMPONENT}
    >
      {Array.from({ length: rowCount }).map((_, index) => (
        <div
          key={`${dataComponentPrefix}-skeleton-${index}`}
          className="list-item"
          data-component={
            dataComponent ? `${dataComponent}_row` : `${dataComponentPrefix}-row-skeleton`
          }
          aria-hidden="true"
          style={{ animationDelay: `${Math.min(index, 4) * 40}ms` }}
        >
          <Skeleton className="list-avatar rounded-full bg-v3-dim-white animate-pulse" />
          <div
            className="list-info flex flex-col"
            data-component={
              dataComponent ? `${dataComponent}_row_info` : `${dataComponentPrefix}-row-skeleton-info`
            }
          >
            <Skeleton className="h-4 w-20 bg-v3-dim-white animate-pulse" />
            <Skeleton className="mt-1.5 h-3 w-32 bg-v3-dim-white animate-pulse" />
          </div>
          <div
            className="list-right"
            data-component={
              dataComponent ? `${dataComponent}_row_right` : `${dataComponentPrefix}-row-skeleton-right`
            }
          >
            <Skeleton className="h-6 w-14 rounded-full bg-v3-dim-white animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
}

const avatarToneClass: Record<NonNullable<ListRow["avatarTone"]>, string> = {
  primary: "bg-v3-primary",
  green: "bg-v3-green",
  burgundy: "bg-v3-burgundy",
  orange: "bg-v3-orange",
  purple: "bg-v3-purple",
};

const badgeToneVariant: Record<ListRow["badgeTone"], NonNullable<ComponentProps<typeof StatusPill>["variant"]>> = {
  primary: "primary",
  green: "success",
  burgundy: "danger",
  orange: "warning",
  muted: "neutral",
};

const iconToneClass: Record<ContractRow["iconTone"], string> = {
  primary: "bg-v3-primary-light text-v3-primary",
  green: "bg-v3-green-light text-v3-green",
  muted: "bg-v3-dim-white text-v3-text-muted",
};

const menuToneClass: Record<MenuGroup["rows"][number]["tone"], string> = {
  primary: "bg-v3-primary-light",
  green: "bg-v3-green-light",
  burgundy: "bg-v3-burgundy-light",
  orange: "bg-v3-orange-light",
  purple: "bg-v3-purple-light",
  muted: "bg-v3-dim-white",
  gold: "bg-[hsl(50,100%,88%)]",
};

const menuIconStroke: Record<MenuGroup["rows"][number]["tone"], string> = {
  primary: "hsl(214,100%,34%)",
  green: "hsl(137,34%,31%)",
  burgundy: "hsl(355,36%,45%)",
  orange: "hsl(34,100%,55%)",
  purple: "hsl(267,50%,46%)",
  muted: "hsl(214,25%,28%)",
  gold: "hsl(45,70%,30%)",
};

type MobileMenuTone = MenuGroup["rows"][number]["tone"];
type MobileMenuIconComponent = MenuGroup["rows"][number]["icon"];

export function MobileMenuIcon({
  icon: Icon,
  tone,
}: {
  icon: MobileMenuIconComponent;
  tone: MobileMenuTone;
}) {
  return (
    <div className={`menu-icon ${menuToneClass[tone]}`}>
      <Icon size={18} strokeWidth={2.5} color={menuIconStroke[tone]} />
    </div>
  );
}

export function MobileMenuGroup({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="menu-group" data-component="mobile-redesign-menu-group">
      <div className="menu-group-title">{title}</div>
      {children}
    </div>
  );
}

export function MobileMenuRow({
  label,
  icon,
  tone,
  href,
  disabled = false,
  description,
  rightContent,
  className,
  children,
}: {
  label: string;
  icon: MobileMenuIconComponent;
  tone: MobileMenuTone;
  href?: string;
  disabled?: boolean;
  description?: ReactNode;
  rightContent?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  const rowClassName = [
    "menu-row",
    !href && !disabled ? "menu-row-static" : "",
    disabled ? "menu-row-disabled" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");
  const rowContent = (
    <>
      <MobileMenuIcon icon={icon} tone={tone} />
      <div className="menu-text">
        <div className="menu-label">{label}</div>
        {description ? <div className="menu-description">{description}</div> : null}
        {children}
      </div>
      {rightContent}
    </>
  );

  if (disabled) {
    return (
      <button
        type="button"
        className={rowClassName}
        data-component="mobile-redesign-menu-row"
        disabled
      >
        {rowContent}
      </button>
    );
  }

  if (href) {
    return (
      <Link
        href={href}
        className={rowClassName}
        data-component="mobile-redesign-menu-row"
      >
        {rowContent}
      </Link>
    );
  }

  return (
    <div className={rowClassName} data-component="mobile-redesign-menu-row">
      {rowContent}
    </div>
  );
}

export function Badge({
  "data-component": dataComponent,
  label,
  tone,
}: {
  "data-component"?: string;
  label: string;
  tone: ListRow["badgeTone"];
}) {
  return (
    <StatusPill data-component={dataComponent} variant={badgeToneVariant[tone]} size="sm">
      {label}
    </StatusPill>
  );
}

export function ListRowBadges({ badges }: { badges: Array<{ label: string; tone: ListRow["badgeTone"] }> }) {
  const [primaryBadge, ...hiddenBadges] = badges;

  if (!primaryBadge) return null;

  return (
    <span
      className="list-row-badges"
      data-component="mobile-redesign-list-row-badges"
    >
      <Badge label={primaryBadge.label} tone={primaryBadge.tone} />
      {hiddenBadges.length > 0 && (
        <span
          className="list-row-badges-more"
          data-component="mobile-redesign-list-row-badges-more"
        >
          +{hiddenBadges.length}
        </span>
      )}
    </span>
  );
}

type FilterPillItem = {
  label: string;
  count: ReactNode;
  active?: boolean;
  skeleton?: boolean;
};

export function FilterPills({
  "data-component": dataComponent,
  items,
  activeLabel: controlledActive,
  onChange,
}: {
  "data-component"?: string;
  items: FilterPillItem[];
  activeLabel?: string;
  onChange?: (label: string) => void;
}) {
  const initialActive = items.find((item) => item.active)?.label ?? items[0]?.label;
  const [uncontrolledActive, setUncontrolledActive] = useState(initialActive);
  const activeLabel = controlledActive ?? uncontrolledActive;
  const handleClick = (label: string) => {
    if (onChange) onChange(label);
    else setUncontrolledActive(label);
  };

  return (
    <div
      className="filter-row"
      // TODO(data-component): Remove the legacy fallbacks after caller migration.
      data-component={dataComponent ?? "mobile-redesign-filter-row"}
      data-source-component={FILTER_PILLS_SOURCE_COMPONENT}
    >
      {items.map((item) => (
        item.skeleton ? (
          <button
            key={item.label}
            type="button"
            className="filter-pill filter-pill-skeleton"
            data-component={
              dataComponent ? `${dataComponent}_pill` : "mobile-redesign-filter-pill"
            }
            data-loading="true"
            aria-hidden="true"
            disabled
            tabIndex={-1}
          >
            <span className="filter-pill-skeleton-content">
              {item.label}
              <span className="filter-pill-skeleton-count">00</span>
            </span>
          </button>
        ) : (
          <button
            key={item.label}
            type="button"
            className={`filter-pill ${item.label === activeLabel ? "active" : ""}`}
            data-component={
              dataComponent ? `${dataComponent}_pill` : "mobile-redesign-filter-pill"
            }
            aria-pressed={item.label === activeLabel}
            onClick={() => handleClick(item.label)}
          >
            {item.label} <span className="count">{item.count}</span>
          </button>
        )
      ))}
    </div>
  );
}

export interface MobileSectionNavItem<TId extends string = string> {
  id: TId;
  label: string;
  icon: LucideIcon;
  disabled?: boolean;
}

export function MobileSectionNav<TId extends string>({
  "data-component": dataComponent,
  sourceComponent = MOBILE_SECTION_NAV_SOURCE_COMPONENT,
  items,
  activeId,
  onSelect,
  ariaLabel = "페이지 섹션",
}: {
  "data-component"?: string;
  /** @internal Zero-DOM wrapper identity; route callers must not override this. */
  sourceComponent?: typeof MOBILE_SECTION_NAV_SOURCE_COMPONENT | "MessageSectionNav";
  items: readonly MobileSectionNavItem<TId>[];
  activeId: TId;
  onSelect: (id: TId) => void;
  ariaLabel?: string;
}) {
  return (
    <nav
      aria-label={ariaLabel}
      // TODO(data-component): Remove the legacy fallback after caller migration.
      data-component={dataComponent ?? "section-nav-mobile"}
      data-source-component={sourceComponent}
      data-mode="compact"
      className="-mx-[calc(14px*var(--glint-ui-scale,1))] shrink-0 overflow-x-auto px-[calc(14px*var(--glint-ui-scale,1))] scrollbar-hide"
    >
      <div className="flex gap-[calc(8px*var(--glint-ui-scale,1))] pb-[calc(8px*var(--glint-ui-scale,1))]">
        {items.map((item) => {
          const Icon = item.icon;
          const isDisabled = item.disabled === true;
          const isActive = !isDisabled && item.id === activeId;

          return (
            <button
              key={item.id}
              type="button"
              aria-pressed={isActive}
              disabled={isDisabled}
              onClick={isDisabled ? undefined : () => onSelect(item.id)}
              className={`flex h-[calc(28px*var(--glint-ui-scale,1))] items-center gap-[calc(6px*var(--glint-ui-scale,1))] whitespace-nowrap rounded-full border px-[calc(12px*var(--glint-ui-scale,1))] py-0 text-[calc(0.72rem*var(--glint-ui-scale,1))] font-semibold transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-v3-primary focus-visible:ring-offset-2 disabled:pointer-events-none disabled:cursor-default ${
                isDisabled
                  ? "border-[hsl(var(--v3-border))] bg-[hsl(var(--v3-dim-white))] text-[hsl(var(--v3-text-muted))] opacity-40"
                  : isActive
                  ? "border-[hsl(var(--v3-primary))] bg-[hsl(var(--v3-primary))] text-white"
                  : "border-[hsl(var(--v3-border))] bg-[hsl(var(--v3-bg))] text-[hsl(var(--v3-text-muted))]"
              }`}
            >
              <Icon
                aria-hidden="true"
                className="h-[calc(14px*var(--glint-ui-scale,1))] w-[calc(14px*var(--glint-ui-scale,1))]"
              />
              {item.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

export function ListCard({
  "data-component": dataComponent,
  title,
  count,
  actionLabel,
  actionHref,
  actionIcon,
  actionType = "button",
  actionDisabled = false,
  onActionClick,
  filters,
  activeFilter,
  onFilterChange,
  beforeFilters,
  beforeScroll,
  scrollRef,
  loadMore,
  children,
}: {
  "data-component"?: string;
  title: string;
  count?: ReactNode;
  actionLabel?: string;
  actionHref?: string;
  actionIcon?: ReactNode;
  actionType?: "button" | "submit";
  actionDisabled?: boolean;
  onActionClick?: () => void;
  filters: FilterPillItem[];
  activeFilter?: string;
  onFilterChange?: (label: string) => void;
  beforeFilters?: ReactNode;
  beforeScroll?: ReactNode;
  scrollRef?: RefObject<HTMLDivElement | null>;
  loadMore?: ReactNode;
  children: ReactNode;
}) {
  const [actionFeedback, setActionFeedback] = useState("");
  const handleActionClick = onActionClick ?? (actionType === "button" && actionLabel
    ? () => setActionFeedback(`${actionLabel.replace(/^\+\s*/, "")} 기능을 열었습니다.`)
    : undefined);

  return (
    <div
      className="list-card flex flex-col gap-4"
      // TODO(data-component): Remove the legacy fallbacks after caller migration.
      data-component={dataComponent ?? "mobile-redesign-list-card"}
      data-source-component={LIST_CARD_SOURCE_COMPONENT}
    >
      <ListCardHeader
        data-component={dataComponent ? `${dataComponent}_header` : undefined}
        title={title}
        count={count}
        actionLabel={actionLabel}
        actionHref={actionHref}
        actionIcon={actionIcon}
        actionType={actionType}
        actionDisabled={actionDisabled}
        onActionClick={handleActionClick}
      />
      {beforeFilters}
      {filters.length > 0 && (
        <FilterPills
          data-component={dataComponent ? `${dataComponent}_filters` : undefined}
          items={filters}
          activeLabel={activeFilter}
          onChange={onFilterChange}
        />
      )}
      {actionFeedback && (
        <div
          className="action-feedback"
          role="status"
          data-component={
            dataComponent ? `${dataComponent}_action-feedback` : "mobile-redesign-action-feedback"
          }
        >
          {actionFeedback}
        </div>
      )}
      {beforeScroll}
      <ListCardBody
        data-component={dataComponent ? `${dataComponent}_body` : undefined}
        scrollRef={scrollRef}
      >
        {children}
      </ListCardBody>
      {loadMore && (
        <ListCardLoadMore data-component={dataComponent ? `${dataComponent}_load-more` : undefined}>
          {loadMore}
        </ListCardLoadMore>
      )}
    </div>
  );
}

export function SectionedList({
  "data-component": dataComponent,
  sections,
  hideSectionHeader,
}: {
  "data-component": string;
  sections: SectionRows[];
  hideSectionHeader?: (section: SectionRows) => boolean;
}) {
  return (
    <>
      {sections.map((section, sectionIndex) => (
        <div
          className="section-block"
          key={section.title}
          data-component={`${dataComponent}_section-${sectionIndex + 1}`}
          data-source-component={SECTIONED_LIST_SOURCE_COMPONENT}
        >
          {!hideSectionHeader?.(section) && <div className="section-header">{section.title}</div>}
          {section.rows.map((row) => (
            <ClientLikeRow key={`${section.title}-${row.name}`} row={row} />
          ))}
        </div>
      ))}
    </>
  );
}

type ListItemRowProps = {
  "data-component"?: string;
  /** @deprecated Use the `data-component` prop. */
  dataComponent?: string;
  left: ReactNode;
  name: ReactNode;
  meta?: ReactNode;
  metaClassName?: string;
  right?: ReactNode;
  onClick?: () => void;
  className?: string;
  style?: CSSProperties;
};

export function ListItemRow({
  "data-component": canonicalDataComponent,
  dataComponent: legacyDataComponent,
  left,
  name,
  meta,
  metaClassName = "list-meta",
  right,
  onClick,
  className,
  style,
}: ListItemRowProps) {
  const rootClass = className ? `list-item ${className}` : "list-item";
  return (
    <button
      type="button"
      className={rootClass}
      data-component={canonicalDataComponent ?? legacyDataComponent}
      data-source-component={LIST_ITEM_ROW_SOURCE_COMPONENT}
      onClick={onClick}
      style={style}
    >
      {left}
      <div className="list-info flex flex-col">
        <div className="list-name">{name}</div>
        {meta !== undefined && <div className={metaClassName}>{meta}</div>}
      </div>
      {right !== undefined && <div className="list-right">{right}</div>}
    </button>
  );
}

export function ClientLikeRow({ row }: { row: ListRow }) {
  const hasDue = Boolean(row.due || row.dueSub);
  const interactive = typeof row.onClick === "function";
  const badges = row.badges?.length
    ? row.badges
    : [{ label: row.badge, tone: row.badgeTone }];

  const handleKey = interactive
    ? (e: React.KeyboardEvent<HTMLDivElement>) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          row.onClick?.();
        }
      }
    : undefined;

  return (
    <div
      className="list-item"
      data-component="mobile-redesign-list-row"
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={row.onClick}
      onKeyDown={handleKey}
    >
      <div className={`list-avatar ${avatarToneClass[row.avatarTone ?? "primary"]}`}>{row.initial}</div>
      <div className="list-info flex flex-col">
        <div className="list-name">{row.name}</div>
        <div className={hasDue ? "list-meta list-meta-due" : "list-meta"}>
          {hasDue ? (
            <>
              {row.due && <span className={`dday ${row.dueTone ?? ""}`}>{row.due}</span>}
              {row.dueSub && <span className="dday-sub">{row.dueSub}</span>}
            </>
          ) : (
            row.meta
          )}
        </div>
      </div>
      <div className="list-right">
        <ListRowBadges badges={badges} />
      </div>
    </div>
  );
}

export function ContractList({
  "data-component": dataComponent,
  sections,
  rowStyle,
}: {
  "data-component"?: string;
  sections: Array<{ title: string; rows: ContractRow[] }>;
  rowStyle?: (index: number) => CSSProperties;
}) {
  return (
    <>
      {sections.map((section, sectionIndex) => (
        <div
          className="section-block"
          key={section.title}
          // TODO(data-component): Remove the legacy fallbacks after caller migration.
          data-component={
            dataComponent
              ? `${dataComponent}_section-${sectionIndex + 1}`
              : "mobile-redesign-contract-section"
          }
          data-source-component={CONTRACT_LIST_SOURCE_COMPONENT}
        >
          <div className="section-header">{section.title}</div>
          {section.rows.map((row, idx) => {
            const interactive = typeof row.onClick === "function";
            return (
              <div
                className="contract-item"
                key={`${section.title}-${row.id ?? row.name}`}
                data-component={
                  dataComponent
                    ? `${dataComponent}_section-${sectionIndex + 1}_row-${idx + 1}`
                    : "mobile-redesign-contract-row"
                }
                data-progress={row.badge}
                role={interactive ? "button" : undefined}
                tabIndex={interactive ? 0 : undefined}
                onClick={row.onClick}
                style={rowStyle?.(idx)}
                onKeyDown={
                  interactive
                    ? (e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          row.onClick?.();
                        }
                      }
                    : undefined
                }
              >
                <div className={`contract-icon ${iconToneClass[row.iconTone]}`}>
                  <FileCheck2 size={18} strokeWidth={2.5} />
                </div>
                <div className="contract-info">
                  <div className="contract-title">{row.name}</div>
                  <div className="contract-meta">
                    <span className={row.badgeTone === "green" ? "step-label muted" : "step-label"}>{row.meta}</span>
                  </div>
                </div>
                <div className="list-right">
                  <Badge label={row.badge} tone={row.badgeTone} />
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </>
  );
}

export function MenuGroups({ groups }: { groups: MenuGroup[] }) {
  return (
    <>
      {groups.map((group) => (
        <MobileMenuGroup title={group.title} key={group.title}>
          {group.rows.map((row) => {
            const badgeSkeletonStyle = row.badgeSkeletonWidth
              ? ({ "--menu-badge-skeleton-width": row.badgeSkeletonWidth } as CSSProperties)
              : undefined;
            const valueSkeletonStyle = row.valueSkeletonWidth
              ? ({ "--menu-value-skeleton-width": row.valueSkeletonWidth } as CSSProperties)
              : undefined;
            const rightContent = (
              <div className="menu-right">
                {row.badgeLoading ? (
                  <span
                    className="menu-badge menu-badge-skeleton"
                    data-component="mobile-all-badge-skeleton"
                    style={badgeSkeletonStyle}
                    aria-hidden="true"
                  />
                ) : row.badge ? (
                  <span className="menu-badge">{row.badge}</span>
                ) : null}
                {row.valueLoading ? (
                  <span
                    className="menu-value menu-value-skeleton"
                    data-component="mobile-all-value-skeleton"
                    style={valueSkeletonStyle}
                    aria-hidden="true"
                  />
                ) : row.value ? (
                  <span className="menu-value">{row.value}</span>
                ) : null}
                {row.statusLabel ? (
                  <span className="menu-status-pill">{row.statusLabel}</span>
                ) : (
                  <ChevronRight size={16} strokeWidth={2} />
                )}
              </div>
            );
            return (
              <MobileMenuRow
                key={`${group.title}-${row.label}`}
                label={row.label}
                icon={row.icon}
                tone={row.tone}
                href={row.href}
                disabled={row.disabled}
                rightContent={rightContent}
              />
            );
          })}
        </MobileMenuGroup>
      ))}
    </>
  );
}
