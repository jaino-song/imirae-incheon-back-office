"use client";

import React from "react";

const SOURCE_COMPONENT = "InfoRow";
// TODO(data-component): Remove legacy fallback data-component="info-row" after caller migration.

interface InfoRowProps {
  "data-component"?: string;
  label: string;
  value: React.ReactNode;
}

export function InfoRow({
  "data-component": dataComponent,
  label,
  value,
}: InfoRowProps) {
  return (
    <div
      // TODO(data-component): Remove the legacy fallback after caller migration.
      data-component={dataComponent ?? "info-row"}
      data-source-component={SOURCE_COMPONENT}
      className="flex items-center justify-between py-2.5 border-b border-v3-border last:border-b-0"
    >
      <span className="text-[0.8rem] text-v3-text-muted">{label}</span>
      <span className="text-[0.8rem] font-semibold text-v3-dark">{value}</span>
    </div>
  );
}
