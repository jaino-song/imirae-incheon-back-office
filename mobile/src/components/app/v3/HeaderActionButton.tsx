"use client";

import React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

const baseStyles =
  "flex items-center gap-1 px-2.5 py-1.5 rounded-2xl text-[0.75rem] font-semibold transition-colors";

const variantStyles = {
  primary: "text-v3-primary hover:bg-v3-primary-light",
  muted: "text-v3-text-muted hover:bg-v3-dim-white",
} as const;

const SOURCE_COMPONENT = "HeaderActionButton";

export interface HeaderActionButtonProps {
  icon?: React.ComponentType<{ className?: string }>;
  label: string;
  href?: string;
  onClick?: () => void;
  variant?: keyof typeof variantStyles;
  "data-component"?: string;
  "data-testid"?: string;
  className?: string;
}

export function HeaderActionButton({
  icon: Icon,
  label,
  href,
  onClick,
  variant = "primary",
  "data-component": dataComponent,
  "data-testid": dataTestId,
  className,
}: HeaderActionButtonProps) {
  const classes = cn(baseStyles, variantStyles[variant], className);

  const content = (
    <>
      {Icon && <Icon className="w-3.5 h-3.5" />}
      {label}
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        data-component={dataComponent}
        data-source-component={SOURCE_COMPONENT}
        data-testid={dataTestId}
        className={classes}
      >
        {content}
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      data-component={dataComponent}
      data-source-component={SOURCE_COMPONENT}
      data-testid={dataTestId}
      className={classes}
    >
      {content}
    </button>
  );
}
