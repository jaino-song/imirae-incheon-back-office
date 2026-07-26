"use client";

import React from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export type StatMiniDensity = "default" | "responsive-square";

interface StatMiniProps {
  icon: React.ComponentType<{ className?: string }>;
  value: string | number;
  label: string;
  colorIndex?: number;
  animationDelay?: React.CSSProperties["animationDelay"];
  isLoading?: boolean;
  counter?: string;
  density?: StatMiniDensity;
}

const colorVariants = [
  { bg: "bg-v3-primary-light", text: "text-v3-primary" },
  { bg: "bg-v3-orange-light", text: "text-v3-orange" },
  { bg: "bg-v3-green-light", text: "text-v3-green" },
  { bg: "bg-v3-burgundy-light", text: "text-v3-burgundy" },
] as const;

export function StatMini({
  icon: Icon,
  value,
  label,
  colorIndex = 0,
  animationDelay,
  isLoading = false,
  counter = "",
  density = "default",
}: StatMiniProps) {
  const variant = colorVariants[colorIndex % colorVariants.length];
  const animationStyle = animationDelay ? { animationDelay } : undefined;
  const isResponsiveSquare = density === "responsive-square";

  return (
    <div
      data-component="desktop_v3_stat-mini"
      className={cn(
        isResponsiveSquare
          ? "flex aspect-square w-[calc(96px*var(--glint-ui-scale,1))] items-center justify-center rounded-[20px] bg-white p-[calc(12px*var(--glint-ui-scale,1))] text-center shadow-v3 min-[961px]:aspect-auto min-[961px]:w-[calc(176px*var(--glint-ui-scale,1))] min-[961px]:justify-start min-[961px]:gap-[calc(16px*var(--glint-ui-scale,1))] min-[961px]:p-[calc(16px*var(--glint-ui-scale,1))] min-[961px]:text-left"
          : "flex w-[calc(176px*var(--glint-ui-scale,1))] items-center justify-start gap-[calc(16px*var(--glint-ui-scale,1))] rounded-[20px] bg-white p-[calc(16px*var(--glint-ui-scale,1))] shadow-v3",
        // Component-level animation so stats behave identically across pages.
        "animate-v3-pop-up"
      )}
      style={animationStyle}
    >
      <div
        data-component="desktop_v3_stat-mini_icon"
        className={cn(
          "h-[calc(48px*var(--glint-ui-scale,1))] w-[calc(48px*var(--glint-ui-scale,1))] items-center justify-center rounded-[14px]",
          isResponsiveSquare ? "hidden min-[961px]:flex" : "flex",
          isLoading ? "bg-v3-dim-white" : variant.bg
        )}
      >
        {isLoading ? (
          <Skeleton className="h-[calc(24px*var(--glint-ui-scale,1))] w-[calc(24px*var(--glint-ui-scale,1))] rounded-md bg-white/70" />
        ) : (
          <Icon className={`h-[calc(24px*var(--glint-ui-scale,1))] w-[calc(24px*var(--glint-ui-scale,1))] ${variant.text}`} />
        )}
      </div>
      {isLoading ? (
        <div className={cn("space-y-[calc(8px*var(--glint-ui-scale,1))]", isResponsiveSquare && "min-[961px]:text-left")}>
          <Skeleton className="h-[calc(33px*var(--glint-ui-scale,1))] w-[calc(64px*var(--glint-ui-scale,1))] bg-v3-dim-white" />
          <Skeleton className="h-[calc(12px*var(--glint-ui-scale,1))] w-[calc(80px*var(--glint-ui-scale,1))] bg-v3-dim-white" />
        </div>
      ) : (
        <div className={cn(isResponsiveSquare && "min-w-0")}>
          <span
            className={cn(
              "flex items-center gap-[calc(4px*var(--glint-ui-scale,1))]",
              isResponsiveSquare && "justify-center min-[961px]:justify-start"
            )}
          >
            <p className="text-[calc(24px*var(--glint-ui-scale,1))] font-bold text-v3-dark">{value}</p>
            <p className="mb-[calc(4px*var(--glint-ui-scale,1))] self-end text-[calc(11.2px*var(--glint-ui-scale,1))] text-v3-text-muted">{counter}</p>
          </span>
          <p className="text-[calc(11.2px*var(--glint-ui-scale,1))] text-v3-text-muted">{label}</p>
        </div>
      )}
    </div>
  );
}
