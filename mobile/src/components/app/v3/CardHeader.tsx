"use client";

import React from "react";
import { cn } from "@/lib/utils";

interface CardHeaderProps {
  /** Caller-context canonical base for the header root. */
  "data-component"?: string;
  title?: string;
  subtitle?: string;
  icon?: React.ComponentType<{ className?: string }>;
  actions?: React.ReactNode;
  align?: "left" | "center";
  className?: string;
}

export function CardHeader({ "data-component": dataComponent, title, subtitle, icon: Icon, actions, align = "left", className }: CardHeaderProps) {
  const sub = (suffix: string) => (dataComponent ? `${dataComponent}_${suffix}` : undefined);
  return (
    <div
      data-component={dataComponent}
      data-slot="card-header"
      className={cn(
        "flex flex-col gap-4 animate-v3-slide-up",
        align === "left" && "md:flex-row md:items-center md:justify-between",
        align === "center" && "items-center text-center",
        className
      )}
    >
      <div data-component={sub("title")} className="flex flex-col gap-1">
        <h1 className={cn(
          "text-[1.75rem] font-bold text-v3-dark flex items-center gap-2",
          align === "center" && "justify-center"
        )}>
          {Icon && <Icon className="w-6 h-6 text-v3-primary" />}
          {title}
        </h1>
        {subtitle && (
          <p className="text-muted-foreground">{subtitle}</p>
        )}
      </div>
      {actions && <div data-component={sub("actions")} className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
