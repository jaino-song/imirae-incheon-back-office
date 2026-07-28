"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const tagPillVariants = cva(
  "inline-flex items-center justify-center rounded-full border px-2.5 py-1 text-[0.68rem] font-medium leading-none whitespace-nowrap shrink-0 transition-colors overflow-hidden",
  {
    variants: {
      variant: {
        amber: "bg-amber-100 border-amber-200 text-amber-700",
        emerald: "bg-emerald-100 border-emerald-200 text-emerald-700",
        sky: "bg-sky-100 border-sky-200 text-sky-700",
        cyan: "bg-cyan-100 border-cyan-200 text-cyan-700",
        indigo: "bg-indigo-100 border-indigo-200 text-indigo-700",
        neutral: "bg-[hsl(220,20%,97%)] border-[hsl(220,20%,90%)] text-v3-text-muted",
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
  children: React.ReactNode;
}

export function TagPill({
  className,
  variant,
  size,
  children,
  ...props
}: TagPillProps) {
  return (
    <span data-slot="tag-pill" className={cn(tagPillVariants({ variant, size }), className)} {...props}>
      {children}
    </span>
  );
}
