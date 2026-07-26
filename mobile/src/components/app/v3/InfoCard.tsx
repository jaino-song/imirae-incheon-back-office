"use client";

import React from "react";

const SOURCE_COMPONENT = "InfoCard";
/**
 * TODO(data-component): Remove these legacy fallbacks after caller migration.
 * data-component="info-card"
 * data-component="info-card-title"
 */

interface InfoCardProps {
  "data-component"?: string;
  title: string;
  children: React.ReactNode;
}

export function InfoCard({
  "data-component": dataComponent,
  title,
  children,
}: InfoCardProps) {
  return (
    <div
      // TODO(data-component): Remove the legacy fallback after caller migration.
      data-component={dataComponent ?? "info-card"}
      data-source-component={SOURCE_COMPONENT}
      className="bg-v3-dim-white rounded-2xl p-4"
    >
      <h3
        data-component={dataComponent ? `${dataComponent}_title` : "info-card-title"}
        className="text-[0.7rem] uppercase tracking-[0.1em] text-v3-text-muted font-semibold mb-3"
      >
        {title}
      </h3>
      {children}
    </div>
  );
}
