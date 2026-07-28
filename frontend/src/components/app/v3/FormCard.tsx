"use client";

import React from "react";

import { AppContentCard } from "@/components/ui/app-surface";
import { cn } from "@/lib/utils";

export interface FormCardProps {
  title: string;
  children: React.ReactNode;
  description?: React.ReactNode;
  titleTrailing?: React.ReactNode;
  className?: string;
  contentClassName?: string;
  "data-component"?: string;
}

export function FormCard({
  title,
  children,
  description,
  titleTrailing,
  className,
  contentClassName,
  "data-component": dataComponent = "desktop_v3_form-card",
}: FormCardProps) {
  return (
    <AppContentCard
      as="section"
      data-component={dataComponent}
      variant="outlined"
      title={title}
      description={description}
      titleVariant="eyebrow"
      titleElement="h3"
      titleTrailing={titleTrailing}
      contentClassName={contentClassName ?? "block"}
      className={cn("border-v3-border bg-transparent", className)}
    >
      {children}
    </AppContentCard>
  );
}
