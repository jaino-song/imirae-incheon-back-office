"use client";

import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";

export interface DetailTab {
  key: string;
  label: string;
}

export interface DetailTabsProps {
  /** Caller-context canonical base, e.g. `mobile_clients_detail-panel_tabs`. */
  "data-component"?: string;
  tabs: DetailTab[];
  activeTab: string;
  onTabChange: (key: string) => void;
}

export function DetailTabs({ "data-component": dataComponent, tabs, activeTab, onTabChange }: DetailTabsProps) {
  const prefersReducedMotion = useReducedMotion();
  const sub = (suffix: string) => (dataComponent ? `${dataComponent}_${suffix}` : undefined);

  return (
    <div data-component={dataComponent} data-slot="detail-tabs" className="relative flex gap-1 border-b border-v3-border">
      {tabs.map((tab) => (
        <button
          data-component={sub("tab-button")}
          key={tab.key}
          onClick={() => onTabChange(tab.key)}
          className={cn(
            "relative flex-1 text-center text-[0.8rem] pb-2 px-3 transition-colors",
            activeTab === tab.key ? "text-primary font-semibold" : "text-v3-text-muted hover:text-v3-text"
          )}
        >
          {tab.label}
          {activeTab === tab.key ? (
            prefersReducedMotion ? (
              <div
                data-component={sub("tab-button_indicator")}
                className="absolute bottom-0 left-0 h-0.5 w-full bg-primary"
              />
            ) : (
              <motion.div
                data-component={sub("tab-button_indicator")}
                layoutId="detail-tabs-indicator"
                transition={{ type: "spring", stiffness: 400, damping: 30 }}
                className="absolute bottom-0 left-0 h-0.5 w-full bg-primary"
              />
            )
          ) : null}
        </button>
      ))}
    </div>
  );
}
