"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const statusBadgeVariants = cva(
  "inline-flex items-center justify-center rounded-[50px] border px-3 py-1 text-[0.65rem] font-semibold leading-none whitespace-nowrap shrink-0 transition-colors overflow-hidden gap-1 [&>svg]:size-3 [&>svg]:pointer-events-none",
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

        waiting: "bg-[hsl(47,100%,92%)] border-[hsla(38,92%,35%,0.18)] text-[hsl(38,92%,35%)]",
        in_progress: "bg-[hsl(214,80%,95%)] border-[hsl(214,70%,85%)] text-v3-primary",
        completed: "bg-[hsl(137,60%,94%)] border-[hsl(137,34%,84%)] text-v3-green",
        cancelled: "bg-[hsl(220,20%,97%)] border-[hsl(220,20%,90%)] text-v3-text-muted",
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
