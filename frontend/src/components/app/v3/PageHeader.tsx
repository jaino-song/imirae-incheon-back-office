"use client";

import React from "react";

interface PageHeaderProps {
  title?: string;
  icon?: React.ComponentType<{ className?: string }>;
  actions?: React.ReactNode;
}

export function PageHeader({ title, icon: Icon, actions }: PageHeaderProps) {
  return (
    <div data-component="desktop_v3_page-header" className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 animate-v3-slide-up">
      <div data-component="desktop_v3_page-header_title">
        <h1 className="text-[1.75rem] font-bold text-v3-dark flex items-center gap-2">
          {Icon && <Icon className="w-6 h-6 text-v3-primary" />}
          {title}
        </h1>
      </div>
      {actions && <div data-component="desktop_v3_page-header_actions" className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
