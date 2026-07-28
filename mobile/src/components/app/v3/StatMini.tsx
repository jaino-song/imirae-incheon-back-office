"use client";

import React from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface StatMiniProps {
  /** Caller-context canonical value. StatsBar passes `${base}_stat-mini-N`. */
  "data-component": string;
  icon: React.ComponentType<{ className?: string }>;
  value: string | number;
  label: string;
  colorIndex?: number;
  animationDelay?: React.CSSProperties["animationDelay"];
  isLoading?: boolean;
  counter?: string;
}

const colorVariants = [
  { bg: "bg-v3-primary-light", text: "text-v3-primary" },
  { bg: "bg-v3-orange-light", text: "text-v3-orange" },
  { bg: "bg-v3-green-light", text: "text-v3-green" },
  { bg: "bg-v3-burgundy-light", text: "text-v3-burgundy" },
] as const;

export function StatMini({
  "data-component": dataComponent,
  icon: Icon,
  value,
  label,
  colorIndex = 0,
  animationDelay,
  isLoading = false,
  counter = "",
}: StatMiniProps) {
  const variant = colorVariants[colorIndex % colorVariants.length];
  const animationStyle = animationDelay ? { animationDelay } : undefined;

  return (
    <div
      data-component={dataComponent}
      data-slot="stat-mini"
      className={cn(
        "flex flex-1 items-center justify-start gap-4 rounded-2xl bg-white p-4 shadow-v3 transition-[transform,box-shadow] duration-300 ease-[cubic-bezier(0.33,1,0.68,1)] will-change-transform hover:-translate-y-1.5 hover:shadow-v3-hover",
        // Component-level animation so stats behave identically across pages.
        "animate-v3-pop-up"
      )}
      style={animationStyle}
    >
      <div
        data-component={`${dataComponent}_icon`}
        className={cn(
          "w-12 h-12 rounded-2xl flex items-center justify-center",
          isLoading ? "bg-v3-dim-white" : variant.bg
        )}
      >
        {isLoading ? (
          <Skeleton className="w-6 h-6 rounded-2xl bg-white/70" />
        ) : (
          <Icon className={`w-6 h-6 ${variant.text}`} />
        )}
      </div>
      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-[29px] w-16 bg-v3-dim-white" />
          <Skeleton className="h-3 w-20 bg-v3-dim-white" />
        </div>
      ) : (
        <div>
          <span className="flex items-center gap-2">
            <p className="text-2xl font-bold text-v3-dark">{value}</p>
            <p className="text-[0.7rem] text-v3-text-muted self-end mb-1">{counter}</p>
          </span>
          <p className="text-[0.7rem] text-v3-text-muted">{label}</p>
        </div>
      )}
    </div>
  );
}
