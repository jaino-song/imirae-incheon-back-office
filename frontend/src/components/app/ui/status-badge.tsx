"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { STATUS_SURFACE } from "@/components/app/ui/status-surface";

const SOURCE_COMPONENT = "StatusBadge";

const statusBadgeVariants = cva(
  "inline-flex items-center justify-center overflow-hidden rounded-[50px] border px-[calc(12px*var(--glint-ui-scale,1))] py-[calc(4px*var(--glint-ui-scale,1))] text-[calc(10.4px*var(--glint-ui-scale,1))] font-semibold leading-none whitespace-nowrap shrink-0 transition-colors gap-[calc(4px*var(--glint-ui-scale,1))] [&>svg]:size-[calc(12px*var(--glint-ui-scale,1))] [&>svg]:pointer-events-none",
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

        // Existing semantic aliases
        pre_booking: STATUS_SURFACE.neutral,
        waiting: STATUS_SURFACE.warning,
        in_progress: STATUS_SURFACE.info,
        completed: STATUS_SURFACE.success,
        terminated: STATUS_SURFACE.neutral,
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
        sm: "px-[calc(12px*var(--glint-ui-scale,1))] py-[calc(4px*var(--glint-ui-scale,1))] text-[calc(10.4px*var(--glint-ui-scale,1))]",
        default: "px-[calc(12px*var(--glint-ui-scale,1))] py-[calc(4px*var(--glint-ui-scale,1))] text-[calc(10.4px*var(--glint-ui-scale,1))]",
        lg: "px-[calc(14px*var(--glint-ui-scale,1))] py-[calc(6px*var(--glint-ui-scale,1))] text-[calc(12px*var(--glint-ui-scale,1))]",
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
  children: React.ReactNode;
}

function StatusBadge({
  className,
  variant,
  size,
  children,
  ...props
}: StatusBadgeProps) {
  return (
    <span
      data-slot="status-badge"
      {...props}
      data-source-component={SOURCE_COMPONENT}
      className={cn(statusBadgeVariants({ variant, size }), className)}
    >
      {children}
    </span>
  );
}

const StatusPill = StatusBadge;

export { StatusBadge, StatusPill, statusBadgeVariants };
