"use client";

import React from "react";

interface ActivityItem {
  icon: React.ComponentType<{ className?: string }>;
  iconVariant: "success" | "warning" | "info" | "danger";
  text: React.ReactNode;
  time: string;
}

interface ActivityTimelineProps {
  "data-component": string;
  items: ActivityItem[];
  maxHeight?: string;
}

const variantStyles: Record<
  ActivityItem["iconVariant"],
  string
> = {
  success: "bg-v3-green-light text-v3-green",
  warning: "bg-v3-orange-light text-v3-orange",
  info: "bg-v3-primary-light text-v3-primary",
  danger: "bg-v3-burgundy-light text-v3-burgundy",
};

export function ActivityTimeline({
  "data-component": dataComponent,
  items,
  maxHeight = "400px",
}: ActivityTimelineProps) {
  return (
    <div
      data-component={dataComponent}
      data-slot="activity-timeline"
      className="flex flex-col gap-4 overflow-y-auto"
      style={{ maxHeight }}
    >
      {items.map((item, index) => {
        const isLast = index === items.length - 1;
        const Icon = item.icon;

        return (
          <div key={index} className="relative flex gap-3">
            {!isLast && (
              <div className="absolute left-5 top-10 -bottom-4 w-px bg-v3-border" />
            )}

            <div
              className={`relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${variantStyles[item.iconVariant]}`}
            >
              <Icon className="h-[18px] w-[18px]" />
            </div>

            <div className="flex flex-col justify-center min-w-0">
              <span className="text-[0.8rem] text-v3-text">{item.text}</span>
              <span className="text-[0.65rem] text-v3-text-muted">
                {item.time}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
