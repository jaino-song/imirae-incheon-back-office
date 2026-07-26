"use client";

import React from "react";
import { StatMini } from "./StatMini";

export interface StatsBarItem {
  icon: React.ComponentType<{ className?: string }>;
  value: string | number;
  label: string;
  counter?: string;
  colorIndex?: number;
}

interface StatsBarProps {
  /** Caller-context canonical base, e.g. `mobile_admin_feedback_stats`. */
  "data-component": string;
  items: readonly StatsBarItem[];
  isLoading?: boolean;
}

export function StatsBar({ "data-component": dataComponent, items, isLoading = false }: StatsBarProps) {
  return (
    <div
      data-component={dataComponent}
      className="grid grid-cols-2 gap-4 [&>*:last-child:nth-child(odd)]:col-span-2"
    >
      {items.map((item, idx) => (
        <StatMini
          data-component={`${dataComponent}_stat-mini-${idx + 1}`}
          key={item.label}
          icon={item.icon}
          value={item.value}
          label={item.label}
          counter={item.counter}
          colorIndex={item.colorIndex ?? idx}
          animationDelay={`${idx * 0.08}s`}
          isLoading={isLoading}
        />
      ))}
    </div>
  );
}
