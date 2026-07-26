"use client";

import { createContext, useCallback, useContext, useLayoutEffect, useRef } from "react";
import type { CSSProperties, MouseEvent, ReactNode } from "react";
import { Search, X } from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/utils";

export type AvatarTone = "primary" | "green" | "burgundy" | "orange" | "purple" | "muted";
export type InfoTone = "green" | "burgundy" | "muted" | "primary" | "orange";
export type DocRowTone = "green" | "muted" | "primary" | "burgundy" | "orange";
export type BadgeTone = DocRowTone | "kakao" | "purple";
export type DetailTab = { id: string; label: string };
export type DetailHeaderBadge = {
  label: ReactNode;
  tone: BadgeTone;
  dataComponent?: string;
  className?: string;
};
export type DetailAction = {
  label: ReactNode;
  variant?: "primary" | "secondary";
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
  busy?: boolean;
  ariaLabel?: string;
  dataComponent?: string;
  className?: string;
};

const MOBILE_DETAIL_STACK_SOURCE_COMPONENT = "MobileDetailStack";
const MOBILE_DETAIL_SHEET_SOURCE_COMPONENT = "MobileDetailSheet";
const MOBILE_DETAIL_PAGE_SOURCE_COMPONENT = "MobileDetailPage";
const MOBILE_DETAIL_HEADER_SOURCE_COMPONENT = "MobileDetailHeader";
const MOBILE_DETAIL_ACTIONS_SOURCE_COMPONENT = "MobileDetailActions";
const MOBILE_DETAIL_TAB_PANEL_SOURCE_COMPONENT = "MobileDetailTabPanel";
const INFO_CARD_SOURCE_COMPONENT = "InfoCard";
const INFO_ROW_SOURCE_COMPONENT = "InfoRow";

export function MobileDetailStack({
  "data-component": dataComponent,
  sourceComponent = MOBILE_DETAIL_STACK_SOURCE_COMPONENT,
  isOpen,
  onClose,
  list,
  children,
  sectionDataComponent,
  sectionClassName,
  sectionStyle,
  sectionAriaHidden,
  stackDataComponent,
  stackClassName,
  listDataComponent,
  listClassName,
  scrimDataComponent,
  scrimClassName,
  scrimDisabled,
  detailDataComponent,
  detailClassName,
  detailRole,
  detailAriaModal,
  detailAriaLabelledBy,
  detailAriaDescribedBy,
  sheetHeaderDataComponent,
  sheetHeaderClassName,
  closeLabel = "상세 닫기",
  closeDisabled,
}: {
  "data-component": string;
  /** @internal Zero-DOM wrapper identity; route callers must not override this. */
  sourceComponent?: typeof MOBILE_DETAIL_STACK_SOURCE_COMPONENT | typeof MOBILE_DETAIL_SHEET_SOURCE_COMPONENT;
  name: string;
  isOpen: boolean;
  onClose: () => void;
  list: ReactNode;
  children: ReactNode;
  sectionDataComponent?: string;
  sectionClassName?: string;
  sectionStyle?: CSSProperties;
  sectionAriaHidden?: boolean;
  stackDataComponent?: string;
  stackClassName?: string;
  listDataComponent?: string;
  listClassName?: string;
  scrimDataComponent?: string;
  scrimClassName?: string;
  scrimDisabled?: boolean;
  detailDataComponent?: string;
  detailClassName?: string;
  detailRole?: "dialog" | "region";
  detailAriaModal?: boolean;
  detailAriaLabelledBy?: string;
  detailAriaDescribedBy?: string;
  sheetHeaderDataComponent?: string;
  sheetHeaderClassName?: string;
  closeLabel?: string;
  closeDisabled?: boolean;
}) {
  return (
    <section
      data-component={sectionDataComponent ?? dataComponent}
      data-slot="mobile-detail-stack"
      data-source-component={sourceComponent}
      className={sectionClassName}
      style={sectionStyle}
      aria-hidden={sectionAriaHidden}
    >
      <div
        className={cn("nav-stack", isOpen && "show-detail", stackClassName)}
        data-component={stackDataComponent ?? `${dataComponent}_stack`}
        data-slot="mobile-detail-stack-track"
      >
        <div
          className={cn("nav-page list", listClassName)}
          data-component={listDataComponent ?? `${dataComponent}_stack_list-page`}
          data-slot="mobile-detail-stack-list-page"
          aria-hidden={list == null}
        >
          {list}
        </div>
        <button
          type="button"
          aria-label={closeLabel}
          className={cn("scrim", scrimClassName)}
          data-component={scrimDataComponent ?? `${dataComponent}_stack_scrim`}
          data-slot="mobile-detail-stack-scrim"
          onClick={onClose}
          disabled={scrimDisabled}
        />
        <div
          className={cn("nav-page detail", detailClassName)}
          data-component={detailDataComponent ?? `${dataComponent}_stack_detail-page`}
          data-slot="mobile-detail-stack-detail-page"
          role={detailRole}
          aria-modal={detailAriaModal}
          aria-labelledby={detailAriaLabelledBy}
          aria-describedby={detailAriaDescribedBy}
          aria-hidden={!isOpen}
        >
          <div data-component={`${detailDataComponent ?? `${dataComponent}_stack_detail-page`}_handle`} className="sheet-handle" />
          <div className={cn("sheet-header", sheetHeaderClassName)} data-component={sheetHeaderDataComponent ?? `${detailDataComponent ?? `${dataComponent}_stack_detail-page`}_header`}>
            <button
              data-component={`${sheetHeaderDataComponent ?? `${detailDataComponent ?? `${dataComponent}_stack_detail-page`}_header`}_close`}
              type="button"
              className="sheet-close"
              aria-label={closeLabel}
              onClick={onClose}
              disabled={closeDisabled}
              style={{ marginLeft: "auto" }}
            >
              <X aria-hidden="true" size={22} strokeWidth={2.5} />
            </button>
          </div>
          {children}
        </div>
      </div>
    </section>
  );
}

export function MobileDetailSheet({
  "data-component": dataComponent,
  name,
  isOpen,
  onClose,
  list,
  detail,
  detailDataComponent,
}: {
  "data-component": string;
  name: string;
  isOpen: boolean;
  onClose: () => void;
  list: ReactNode;
  detail: ReactNode;
  /**
   * Explicit name for the sliding detail pane. Pass it when the page also
   * annotates its own detail body, so the two elements do not end up sharing
   * one generated `data-component` value.
   */
  detailDataComponent?: string;
}) {
  return (
    <MobileDetailStack
      data-component={dataComponent}
      sourceComponent={MOBILE_DETAIL_SHEET_SOURCE_COMPONENT}
      name={name}
      isOpen={isOpen}
      onClose={onClose}
      list={list}
      detailDataComponent={detailDataComponent}
      sectionClassName="mobile-detail-sheet relative flex flex-col flex-1 min-h-0 overflow-hidden -mx-4 -mb-24"
      sectionStyle={{ minHeight: "var(--mobile-detail-sheet-min-height, calc(100dvh - 80px))" }}
    >
      {detail}
    </MobileDetailStack>
  );
}

export function MobileDetailPage({
  "data-component": dataComponent,
  children,
  className,
  style,
}: {
  "data-component": string;
  name: string;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      className={cn("detail-body detail-column", className)}
      data-component={dataComponent}
      data-source-component={MOBILE_DETAIL_PAGE_SOURCE_COMPONENT}
      style={style}
    >
      {children}
    </div>
  );
}

export function MobileDetailHeader({
  "data-component": dataComponent,
  avatar,
  avatarTone = "primary",
  avatarClassName,
  title,
  titleClassName,
  titleStyle,
  badges,
  menu,
  className,
}: {
  "data-component": string;
  name: string;
  avatar: ReactNode;
  avatarTone?: AvatarTone;
  avatarClassName?: string;
  title: ReactNode;
  titleClassName?: string;
  titleStyle?: CSSProperties;
  badges?: DetailHeaderBadge[];
  menu?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn("client-detail-header pop-up", className)}
      data-component={dataComponent}
      data-source-component={MOBILE_DETAIL_HEADER_SOURCE_COMPONENT}
    >
      <div
        className={cn("client-detail-avatar-lg", `av-${avatarTone}`, avatarClassName)}
        data-component={`${dataComponent}_avatar`}
      >
        {avatar}
      </div>
      <div className="client-detail-title" data-component={`${dataComponent}_title-group`}>
        <div
          className={cn("client-detail-name", titleClassName)}
          data-component={`${dataComponent}_title-group_name`}
          style={titleStyle}
        >
          {title}
        </div>
        {badges && badges.length > 0 ? (
          <div className="client-detail-badges" data-component={`${dataComponent}_title-group_badges`}>
            {badges.map((badge, index) => (
              <span
                key={`${badge.tone}-${index}`}
                className={cn("badge-mini", badge.tone, badge.className)}
                data-component={badge.dataComponent}
              >
                {badge.label}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      {menu}
    </div>
  );
}

export function MobileDetailActions({
  "data-component": dataComponent,
  name,
  actions,
  children,
  className,
}: {
  "data-component": string;
  name: string;
  actions?: DetailAction[];
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn("detail-actions", className)}
      data-component={dataComponent}
      data-source-component={MOBILE_DETAIL_ACTIONS_SOURCE_COMPONENT}
    >
      {actions?.map((action, index) => {
        const actionClassName = cn("btn", `btn-${action.variant ?? "secondary"}`, action.className);
        const key = action.dataComponent ?? `${name}-action-${index}`;
        const isDisabled = action.disabled ?? (!action.href && !action.onClick);

        if (action.href) {
          return (
            <Link
              key={key}
              href={action.href}
              className={actionClassName}
              aria-label={action.ariaLabel}
              data-component={action.dataComponent ?? `${dataComponent}_action-${index + 1}`}
            >
              {action.label}
            </Link>
          );
        }

        return (
          <button
            key={key}
            className={actionClassName}
            type="button"
            onClick={action.onClick}
            disabled={isDisabled}
            aria-busy={action.busy}
            aria-label={action.ariaLabel}
            data-component={action.dataComponent ?? `${dataComponent}_action-${index + 1}`}
          >
            {action.label}
          </button>
        );
      })}
      {children}
    </div>
  );
}

export function MobileDetailTabPanel({
  "data-component": dataComponent,
  tabId,
  activeTab,
  children,
  className,
}: {
  "data-component": string;
  name: string;
  tabId: string;
  activeTab: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn("tab-content", activeTab === tabId && "active", className)}
      data-tab-content={tabId}
      data-component={dataComponent}
      data-source-component={MOBILE_DETAIL_TAB_PANEL_SOURCE_COMPONENT}
    >
      {children}
    </div>
  );
}

const InfoCardDataComponentContext = createContext<string | null>(null);

export function InfoCard({
  "data-component": dataComponent,
  title,
  children,
  delay,
  padded = false,
}: {
  "data-component": string;
  title: string;
  children: ReactNode;
  delay?: number;
  padded?: boolean;
}) {
  return (
    <InfoCardDataComponentContext.Provider value={dataComponent}>
      <div
        data-component={dataComponent}
        data-source-component={INFO_CARD_SOURCE_COMPONENT}
        className={cn("info-card pop-up", padded && "info-card-padded")}
        style={delay ? { animationDelay: `${delay}ms` } : undefined}
      >
        <div data-component={`${dataComponent}_title`} className="info-card-title">{title}</div>
        {children}
      </div>
    </InfoCardDataComponentContext.Provider>
  );
}

export function InfoRow({
  "data-component": explicitDataComponent,
  label,
  value,
  tone,
}: {
  "data-component"?: string;
  label?: string;
  value: ReactNode;
  tone?: InfoTone;
}) {
  const ownerDataComponent = useContext(InfoCardDataComponentContext);
  const dataComponent =
    explicitDataComponent ?? (ownerDataComponent ? `${ownerDataComponent}_row` : undefined);
  return (
    <div
      data-component={dataComponent}
      data-source-component={INFO_ROW_SOURCE_COMPONENT}
      className={cn("info-row", !label && "info-row-no-label")}
    >
      {label ? <span data-component={dataComponent ? `${dataComponent}_label` : undefined} className="info-row-label">{label}</span> : null}
      <span data-component={dataComponent ? `${dataComponent}_value` : undefined} className={cn("info-row-value", tone && `info-row-value-${tone}`)}>{value}</span>
    </div>
  );
}

export function Avatar({
  initial,
  tone,
  large = false,
}: {
  initial: string;
  tone: AvatarTone;
  large?: boolean;
}) {
  return <div className={cn(large ? "client-detail-avatar-lg" : "list-avatar", `av-${tone}`)}>{initial}</div>;
}

export function DetailTabPills({
  "data-component": dataComponent,
  tabs,
  activeTab,
  onTabChange,
}: {
  "data-component"?: string;
  tabs: DetailTab[];
  activeTab: string;
  onTabChange: (tab: string) => void;
}) {
  const tabsRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLSpanElement>(null);
  const buttonRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const updateIndicatorBounds = useCallback(() => {
    const indicator = indicatorRef.current;
    const activeButton = buttonRefs.current[activeTab];
    if (!indicator || !activeButton) {
      indicator?.style.setProperty("opacity", "0");
      return;
    }

    indicator.style.setProperty("--detail-tab-indicator-x", `${activeButton.offsetLeft}px`);
    indicator.style.setProperty("--detail-tab-indicator-width", `${activeButton.offsetWidth}px`);
    indicator.style.setProperty("opacity", "1");
  }, [activeTab]);

  useLayoutEffect(() => {
    updateIndicatorBounds();

    const tabsElement = tabsRef.current;
    const activeButton = buttonRefs.current[activeTab];
    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(updateIndicatorBounds);

    if (tabsElement) resizeObserver?.observe(tabsElement);
    if (activeButton) resizeObserver?.observe(activeButton);

    window.addEventListener("resize", updateIndicatorBounds);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updateIndicatorBounds);
    };
  }, [activeTab, tabs.length, updateIndicatorBounds]);

  const handleTabClick = (event: MouseEvent<HTMLButtonElement>, tabId: string) => {
    if (tabId === activeTab) return;

    const scrollContainer = event.currentTarget.closest(".detail-body");
    if (scrollContainer instanceof HTMLElement && scrollContainer.scrollTop > 0) {
      scrollContainer.scrollTop = 0;
      window.requestAnimationFrame(() => onTabChange(tabId));
      return;
    }

    onTabChange(tabId);
  };

  return (
    <div
      ref={tabsRef}
      className="filter-row detail-tabs"
      // TODO(data-component): Remove the legacy fallbacks after caller migration.
      data-component={dataComponent ?? "mobile-redesign-detail-tabs"}
    >
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            ref={(button) => {
              buttonRefs.current[tab.id] = button;
            }}
            className={cn("filter-pill", isActive && "active")}
            data-tab={tab.id}
            aria-pressed={isActive}
            onClick={(event) => handleTabClick(event, tab.id)}
          >
            {tab.label}
          </button>
        );
      })}
      <span
        ref={indicatorRef}
        className="detail-tabs-indicator"
        data-component={dataComponent ? `${dataComponent}_indicator` : "mobile-redesign-detail-tabs-indicator"}
      />
    </div>
  );
}

export function DocRow({
  initial,
  title,
  meta,
  badge,
  tone,
}: {
  initial: string;
  title: string;
  meta: string;
  badge: string;
  tone: DocRowTone;
}) {
  const iconToneClass: Record<DocRowTone, string> = {
    green: "bg-v3-green-light text-v3-green",
    primary: "bg-v3-primary-light text-v3-primary",
    burgundy: "bg-v3-burgundy-light text-v3-burgundy",
    orange: "bg-v3-orange-light text-v3-orange",
    muted: "bg-v3-dim-white text-v3-text-muted",
  };
  return (
    <div className="doc-row">
      <div className={cn("doc-icon", iconToneClass[tone])}>{initial}</div>
      <div className="doc-info">
        <div className="doc-title">{title}</div>
        <div className="doc-meta">{meta}</div>
      </div>
      <span className={cn("badge-mini", tone)}>{badge}</span>
    </div>
  );
}

export function MobileSearchBar({
  "data-component": dataComponent,
  placeholder,
  label,
  value,
  onChange,
}: {
  "data-component"?: string;
  placeholder: string;
  label: string;
  value?: string;
  onChange?: (value: string) => void;
}) {
  return (
    <div
      className="search-bar"
      // TODO(data-component): Remove the legacy fallback after caller migration.
      data-component={dataComponent ?? `mobile-${label}-search`}
    >
      <Search size={14} strokeWidth={2.5} />
      <input
        name={`${label}Search`}
        autoComplete="off"
        aria-label={placeholder}
        placeholder={placeholder}
        value={value ?? ""}
        onChange={(e) => onChange?.(e.target.value)}
      />
    </div>
  );
}
