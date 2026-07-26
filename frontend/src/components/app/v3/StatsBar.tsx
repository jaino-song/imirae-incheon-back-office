"use client";

import React from "react";
import { StatMini, type StatMiniDensity } from "./StatMini";

export interface StatsBarItem {
  icon: React.ComponentType<{ className?: string }>;
  value: string | number;
  label: string;
  counter?: string;
  colorIndex?: number;
}

interface StatsBarProps {
  items: readonly StatsBarItem[];
  isLoading?: boolean;
  density?: StatMiniDensity;
  name: string;
}

export function StatsBar({
  items,
  isLoading = false,
  density = "default",
  name,
}: StatsBarProps) {
  return (
    <div data-component={`${name}_stats`} className="flex flex-wrap gap-[calc(16px*var(--glint-ui-scale,1))]">
      {items.map((item, idx) => (
        <StatMini
          key={item.label}
          icon={item.icon}
          value={item.value}
          label={item.label}
          counter={item.counter}
          colorIndex={item.colorIndex ?? idx}
          animationDelay={`${idx * 0.08}s`}
          isLoading={isLoading}
          density={density}
        />
      ))}
    </div>
  );
}
