"use client";

import React from "react";

import { cn } from "@/lib/utils";
import { useInfoCardDataComponent } from "./InfoCardDataComponentContext";

interface InfoRowProps {
  label: string;
  value: React.ReactNode;
  size?: "default" | "compact";
  className?: string;
  "data-component"?: string;
}

export function InfoRow({
  label,
  value,
  size = "default",
  className,
  "data-component": explicitDataComponent,
}: InfoRowProps) {
  const ownerDataComponent = useInfoCardDataComponent();
  const dataComponent =
    explicitDataComponent ?? (ownerDataComponent ? `${ownerDataComponent}_row` : undefined);
  const sub = (suffix: string) => (dataComponent ? `${dataComponent}_${suffix}` : undefined);

  return (
    <div
      data-component={dataComponent}
      data-source-component="InfoRow"
      className={cn("flex items-start gap-[calc(16px*var(--glint-ui-scale,1))] border-b border-v3-border py-[calc(10px*var(--glint-ui-scale,1))] last:border-b-0", className)}
    >
      <span data-component={sub("label")} className={cn(
        "shrink-0 text-v3-text-muted",
        size === "compact"
          ? "text-[calc(12px*var(--glint-ui-scale,1))]"
          : "text-[calc(14px*var(--glint-ui-scale,1))]",
      )}>{label}</span>
      <span data-component={sub("value")} className={cn(
        "ml-auto min-w-0 flex-1 text-right font-semibold text-v3-dark",
        size === "compact"
          ? "text-[calc(12px*var(--glint-ui-scale,1))]"
          : "text-[calc(14px*var(--glint-ui-scale,1))]",
      )}>
        {value}
      </span>
    </div>
  );
}
