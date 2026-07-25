"use client";

import React from "react";

import { AppContentCard } from "@/components/ui/app-surface";
import { InfoCardDataComponentProvider } from "./InfoCardDataComponentContext";

interface InfoCardProps {
  title: string;
  children: React.ReactNode;
  description?: React.ReactNode;
  titleTrailing?: React.ReactNode;
  className?: string;
  contentClassName?: string;
  "data-component": string;
  "data-source-component"?: string;
}

export function InfoCard({
  title,
  children,
  description,
  titleTrailing,
  className,
  contentClassName,
  "data-component": dataComponent,
  "data-source-component": dataSourceComponent = "InfoCard",
}: InfoCardProps) {
  return (
    <InfoCardDataComponentProvider value={dataComponent}>
      <AppContentCard
        data-component={dataComponent}
        data-source-component={dataSourceComponent}
        variant="muted"
        title={title}
        description={description}
        titleVariant="eyebrow"
        titleElement="h3"
        titleTrailing={titleTrailing}
        contentClassName={contentClassName ?? "block"}
        className={className}
      >
        {children}
      </AppContentCard>
    </InfoCardDataComponentProvider>
  );
}
