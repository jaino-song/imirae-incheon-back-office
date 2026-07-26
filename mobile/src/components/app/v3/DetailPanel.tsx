"use client";

import React from "react";
import { ChevronLeft } from "lucide-react";
import { PanelTitleGroup } from "./PanelTitleGroup";
import { useSplitLayoutNavOptional } from "./SplitLayoutContext";

interface DetailPanelProps {
  /** Caller-context canonical base, e.g. `mobile_clients_split-layout_detail-panel`. */
  "data-component"?: string;
  header?: React.ReactNode;
  avatar?: React.ReactNode;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Badges rendered before the title (leftmost position) */
  badgesLeft?: React.ReactNode;
  /** Badges rendered after the title */
  badges?: React.ReactNode;
  /** Badges pushed to the far right of the title row */
  badgesRight?: React.ReactNode;
  trailing?: React.ReactNode;
  mobileActions?: React.ReactNode;
  actions?: React.ReactNode;
  tabs?: React.ReactNode;
  children: React.ReactNode;
}

export function DetailPanel({
  "data-component": dataComponent,
  header = null,
  avatar,
  title,
  subtitle,
  badgesLeft,
  badges,
  badgesRight,
  trailing,
  mobileActions,
  tabs,
  actions,
  children,
}: DetailPanelProps) {
  const sub = (suffix: string) => (dataComponent ? `${dataComponent}_${suffix}` : undefined);
  const nav = useSplitLayoutNavOptional();
  const showBackButton = nav?.isMobile;

  const hasStructuredHeader = !!title;

  const renderedHeader = hasStructuredHeader ? (
    <div className="flex items-center justify-between gap-4">
      <div className="flex items-center gap-4 min-w-0">
        {avatar}
        <PanelTitleGroup
          component="detail-panel"
          title={title}
          subtitle={subtitle}
          badgesLeft={badgesLeft}
          badges={badges}
          badgesRight={badgesRight}
          titleClassName="text-xl"
        />
      </div>
      {trailing}
    </div>
  ) : header;

  return (
    <div data-component={dataComponent} data-slot="detail-panel" className={`bg-white rounded-2xl shadow-v3 flex flex-col gap-4 overflow-hidden h-full min-h-0 ${nav?.isMobile ? "" : "animate-v3-slide-up"}`}>
      {showBackButton && (
        <div
          data-component={sub("mobile-nav")}
          className="flex items-center justify-between px-4 pt-4"
        >
          <button
            data-component={sub("mobile-nav_back")}
            onClick={nav?.goToList}
            className="flex items-center gap-1 text-[0.8rem] text-v3-text-muted hover:text-v3-primary transition-colors"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          {mobileActions && (
            <div data-component={sub("mobile-nav_actions")} className="flex items-center">
              {mobileActions}
            </div>
          )}
        </div>
      )}

      {renderedHeader && <div data-component={sub("header")} className={showBackButton ? "px-6 pt-2" : "p-6"}>
        {renderedHeader}
      </div>}
      {actions && <div data-component={sub("actions")} className="px-6">{actions}</div>}
      {tabs && <div className="px-6">{tabs}</div>}
      <div className="relative flex-1 min-h-0">
        <div className="overflow-y-auto h-full px-6 py-4">
          {children}
        </div>
        <div className="absolute bottom-0 left-0 right-0 h-6 bg-white pointer-events-none z-20 rounded-b-2xl" />
      </div>
    </div>
  );
}
