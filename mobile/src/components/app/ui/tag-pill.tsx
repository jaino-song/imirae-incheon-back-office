"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const tagPillVariants = cva(
  "inline-flex items-center justify-center rounded-full px-2.5 py-1 text-[0.68rem] font-medium leading-none whitespace-nowrap shrink-0 transition-colors overflow-hidden",
  {
    variants: {
      variant: {
        amber: "bg-amber-100 text-amber-700",
        emerald: "bg-emerald-100 text-emerald-700",
        sky: "bg-sky-100 text-sky-700",
        cyan: "bg-cyan-100 text-cyan-700",
        indigo: "bg-indigo-100 text-indigo-700",
        neutral: "bg-[hsl(220,20%,97%)] text-v3-text-muted",
      },
      size: {
        default: "px-2.5 py-1 text-[0.68rem]",
        sm: "px-2.5 py-1 text-[0.68rem]",
        lg: "px-3 py-1.5 text-[0.75rem]",
      },
    },
    defaultVariants: {
      variant: "neutral",
      size: "default",
    },
  }
);

export interface TagPillProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof tagPillVariants> {
  /** Caller-context canonical value for this pill. */
  "data-component"?: string;
  children: React.ReactNode;
}

export function TagPill({
  "data-component": dataComponent,
  className,
  variant,
  size,
  children,
  ...props
}: TagPillProps) {
  return (
    <span data-component={dataComponent} data-slot="tag-pill" className={cn(tagPillVariants({ variant, size }), className)} {...props}>
      {children}
    </span>
  );
}

