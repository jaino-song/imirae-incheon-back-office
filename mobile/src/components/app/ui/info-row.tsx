"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface InfoRowProps extends React.HTMLAttributes<HTMLDivElement> {
  label: string;
  value: React.ReactNode;
  icon?: React.ReactNode;
  labelWidth?: string;
}

/** @deprecated v3 InfoRow(@/components/app/v3)를 사용할 것 — 중복 구현 (BJJ-254, manifest deprecatedBy 참조) */
function InfoRow({
  label,
  value,
  icon,
  labelWidth = "w-[120px]",
  className,
  ...props
}: InfoRowProps) {
  return (
    <div
      data-component="info-row"
      className={cn("flex items-center py-2", className)}
      {...props}
    >
      {icon && (
        <span className="mr-2 text-muted-foreground">{icon}</span>
      )}
      <span
        className={cn(
          "shrink-0 text-sm text-muted-foreground",
          labelWidth
        )}
      >
        {label}
      </span>
      <span className="flex-1 text-sm">
        {value || "-"}
      </span>
    </div>
  );
}

export { InfoRow };
