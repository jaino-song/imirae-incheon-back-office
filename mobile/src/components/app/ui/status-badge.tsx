"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { STATUS_SURFACE } from "@/components/app/ui/status-surface";

const statusBadgeVariants = cva(
  "inline-flex items-center justify-center rounded-[50px] border px-3 py-1 text-[0.65rem] font-semibold leading-none whitespace-nowrap shrink-0 transition-colors overflow-hidden gap-1 [&>svg]:size-3 [&>svg]:pointer-events-none",
  {
    variants: {
      variant: {
        neutral: STATUS_SURFACE.neutral,
        primary: STATUS_SURFACE.primary,
        info: STATUS_SURFACE.info,
        success: STATUS_SURFACE.success,
        warning: STATUS_SURFACE.warning,
        danger: STATUS_SURFACE.danger,
        amber: "bg-amber-100 border-amber-200 text-amber-700",
        outline: "bg-transparent border-border text-v3-dark",

        waiting: STATUS_SURFACE.warning,
        in_progress: STATUS_SURFACE.info,
        completed: STATUS_SURFACE.success,
        cancelled: STATUS_SURFACE.neutral,
        replacement_requested: STATUS_SURFACE.danger,

        doc_created: STATUS_SURFACE.neutral,
        doc_requested: STATUS_SURFACE.info,
        doc_opened: STATUS_SURFACE.warning,
        doc_completed: STATUS_SURFACE.success,
        doc_rejected: STATUS_SURFACE.danger,
        doc_revoked: STATUS_SURFACE.danger,
        doc_deleted: STATUS_SURFACE.neutral,
        default: STATUS_SURFACE.neutral,
      },
      size: {
        sm: "px-3 py-1 text-[0.65rem]",
        default: "px-3 py-1 text-[0.65rem]",
        lg: "px-3.5 py-1.5 text-[0.75rem]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface StatusBadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof statusBadgeVariants> {
  "data-component"?: string;
  children: React.ReactNode;
}

function StatusBadge({
  "data-component": dataComponent,
  className,
  variant,
  size,
  children,
  ...props
}: StatusBadgeProps) {
  return (
    <span
      data-component={dataComponent}
      className={cn(statusBadgeVariants({ variant, size }), className)}
      {...props}
    >
      {children}
    </span>
  );
}

const StatusPill = StatusBadge;

export { StatusBadge, StatusPill, statusBadgeVariants };
