"use client";

import React from "react";

import { AppContentCard } from "@/components/ui/app-surface";
import { InfoCardDataComponentProvider } from "./InfoCardDataComponentContext";

const SOURCE_COMPONENT = "InfoCard";

type InfoCardSourceComponent =
  | typeof SOURCE_COMPONENT
  | "ServiceRecordHeaderCard";

interface InfoCardProps {
  title: string;
  children: React.ReactNode;
  description?: React.ReactNode;
  titleTrailing?: React.ReactNode;
  className?: string;
  contentClassName?: string;
  "data-component": string;
  /**
   * @deprecated Zero-DOM ownership bridge for ServiceRecordHeaderCard only.
   * Arbitrary source-component overrides are not supported.
   */
  "data-source-component"?: InfoCardSourceComponent;
}

export function InfoCard({
  title,
  children,
  description,
  titleTrailing,
  className,
  contentClassName,
  "data-component": dataComponent,
  "data-source-component": sourceComponent = SOURCE_COMPONENT,
}: InfoCardProps) {
  return (
    <InfoCardDataComponentProvider value={dataComponent}>
      <AppContentCard
        data-component={dataComponent}
        sourceComponent={sourceComponent}
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
