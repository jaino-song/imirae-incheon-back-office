"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const SOURCE_COMPONENT = "StatusBadge";

const statusBadgeVariants = cva(
  "inline-flex items-center justify-center overflow-hidden rounded-[50px] border px-[calc(12px*var(--glint-ui-scale,1))] py-[calc(4px*var(--glint-ui-scale,1))] text-[calc(10.4px*var(--glint-ui-scale,1))] font-semibold leading-none whitespace-nowrap shrink-0 transition-colors gap-[calc(4px*var(--glint-ui-scale,1))] [&>svg]:size-[calc(12px*var(--glint-ui-scale,1))] [&>svg]:pointer-events-none",
  {
    variants: {
      variant: {
        neutral: "bg-[hsl(220,20%,97%)] border-[hsl(220,20%,90%)] text-v3-text-muted",
        primary: "bg-[hsl(214,80%,95%)] border-[hsl(214,70%,85%)] text-v3-primary",
        info: "bg-[hsl(214,80%,95%)] border-[hsl(214,70%,85%)] text-v3-primary",
        success: "bg-[hsl(137,60%,94%)] border-[hsl(137,34%,84%)] text-v3-green",
        warning: "bg-[hsl(47,100%,92%)] border-[hsla(38,92%,35%,0.18)] text-[hsl(38,92%,35%)]",
        danger: "bg-[hsl(355,40%,94%)] border-[hsla(355,36%,45%,0.20)] text-[hsl(355,36%,45%)]",
        amber: "bg-amber-100 border-amber-200 text-amber-700",
        outline: "bg-transparent border-border text-v3-dark",

        // Existing semantic aliases
        pre_booking: "bg-[hsl(220,20%,97%)] border-[hsl(220,20%,90%)] text-v3-text-muted",
        waiting: "bg-[hsl(47,100%,92%)] border-[hsla(38,92%,35%,0.18)] text-[hsl(38,92%,35%)]",
        in_progress: "bg-[hsl(214,80%,95%)] border-[hsl(214,70%,85%)] text-v3-primary",
        completed: "bg-[hsl(137,60%,94%)] border-[hsl(137,34%,84%)] text-v3-green",
        terminated: "bg-[hsl(220,20%,97%)] border-[hsl(220,20%,90%)] text-v3-text-muted",
        replacement_requested: "bg-[hsl(355,40%,94%)] border-[hsla(355,36%,45%,0.20)] text-[hsl(355,36%,45%)]",

        doc_created: "bg-[hsl(220,20%,97%)] border-[hsl(220,20%,90%)] text-v3-text-muted",
        doc_requested: "bg-[hsl(214,80%,95%)] border-[hsl(214,70%,85%)] text-v3-primary",
        doc_opened: "bg-[hsl(47,100%,92%)] border-[hsla(38,92%,35%,0.18)] text-[hsl(38,92%,35%)]",
        doc_completed: "bg-[hsl(137,60%,94%)] border-[hsl(137,34%,84%)] text-v3-green",
        doc_rejected: "bg-[hsl(355,40%,94%)] border-[hsla(355,36%,45%,0.20)] text-[hsl(355,36%,45%)]",
        doc_revoked: "bg-[hsl(355,40%,94%)] border-[hsla(355,36%,45%,0.20)] text-[hsl(355,36%,45%)]",
        doc_deleted: "bg-[hsl(220,20%,97%)] border-[hsl(220,20%,90%)] text-v3-text-muted",
        default: "bg-[hsl(220,20%,97%)] border-[hsl(220,20%,90%)] text-v3-text-muted",
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
      // TODO(data-component): Remove the legacy fallback after all callers migrate.
      data-component="status-badge"
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
