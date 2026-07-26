"use client";

import React from "react";
import type { LucideIcon } from "lucide-react";

export interface SectionNavItem {
  id: string;
  label: string;
  icon: LucideIcon;
}

interface SectionNavProps {
  /** Caller-context canonical value for the nav root. */
  "data-component"?: string;
  items: readonly SectionNavItem[];
  activeId: string;
  onSelect: (id: string) => void;
  footer?: React.ReactNode;
}

export function SectionNav({ "data-component": dataComponent, items, activeId, onSelect, footer }: SectionNavProps) {
  return (
    <nav data-component={dataComponent} data-slot="section-nav" className="lg:w-[220px] shrink-0 self-start">
      <div className="hidden lg:block sticky top-24">
        <div className="flex flex-col gap-1">
          {items.map((item) => {
            const Icon = item.icon;
            const isActive = activeId === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onSelect(item.id)}
                className={`flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 text-left ${
                  isActive
                    ? "bg-[hsl(var(--v3-primary-light))] text-[hsl(var(--v3-primary))]"
                    : "text-[hsl(var(--v3-text-muted))] hover:bg-[hsl(var(--v3-bg))]"
                }`}
              >
                <Icon className="w-4 h-4" />
                {item.label}
              </button>
            );
          })}
        </div>
        {footer && <div className="mt-4 flex flex-col gap-2">{footer}</div>}
      </div>

      <div className="lg:hidden relative -mx-4">
        <div className="overflow-x-auto scrollbar-hide px-4">
          <div className="flex gap-2 pb-2">
            {items.map((item) => {
              const Icon = item.icon;
              const isActive = activeId === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => onSelect(item.id)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-all duration-200 ${
                    isActive
                      ? "bg-[hsl(var(--v3-primary-light))] text-[hsl(var(--v3-primary))]"
                      : "text-[hsl(var(--v3-text-muted))] bg-[hsl(var(--v3-bg))]"
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-[hsl(var(--v3-dim-white))] to-transparent"
        />
      </div>
    </nav>
  );
}
