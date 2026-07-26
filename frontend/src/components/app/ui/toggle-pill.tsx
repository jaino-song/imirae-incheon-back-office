"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

const SOURCE_COMPONENT = "TogglePill";
// TODO(data-component): Remove the legacy fallback after all callers migrate.
const LEGACY_DATA_COMPONENT = "toggle-pill";

export interface TogglePillProps extends React.HTMLAttributes<HTMLDivElement> {
  value: boolean;
  onValueChange: (value: boolean) => void;
  leftLabel: string;
  rightLabel: string;
  ariaLabel: string;
  disabled?: boolean;
  indicatorDataComponent?: string;
  leftButtonDataComponent?: string;
  rightButtonDataComponent?: string;
  "data-component"?: string;
}

function TogglePill({
  value,
  onValueChange,
  leftLabel,
  rightLabel,
  ariaLabel,
  disabled = false,
  indicatorDataComponent,
  leftButtonDataComponent,
  rightButtonDataComponent,
  className,
  "data-component": dataComponent = LEGACY_DATA_COMPONENT,
  ...props
}: TogglePillProps) {
  const leftButtonRef = React.useRef<HTMLButtonElement>(null);
  const rightButtonRef = React.useRef<HTMLButtonElement>(null);

  const handleKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    currentValue: boolean,
  ) => {
    let nextValue: boolean | null = null;

    if (event.key === "ArrowLeft" || event.key === "ArrowRight") nextValue = !currentValue;
    if (event.key === "Home") nextValue = true;
    if (event.key === "End") nextValue = false;
    if (nextValue === null) return;

    event.preventDefault();
    onValueChange(nextValue);
    (nextValue ? leftButtonRef : rightButtonRef).current?.focus();
  };

  const buttonClassName =
    "relative z-10 inline-flex min-w-0 items-center justify-center rounded-full border-0 bg-transparent px-[calc(20px*var(--glint-ui-scale,1))] text-[calc(13px*var(--glint-ui-scale,1))] font-extrabold leading-none tracking-[-0.025em] outline-none transition-colors duration-200 focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-v3-primary/25 disabled:cursor-not-allowed disabled:opacity-55";

  return (
    <div
      {...props}
      data-component={dataComponent}
      data-source-component={SOURCE_COMPONENT}
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        "relative isolate inline-grid h-[calc(38px*var(--glint-ui-scale,1))] min-h-[calc(38px*var(--glint-ui-scale,1))] w-fit grid-cols-2 overflow-hidden rounded-full bg-v3-primary/10",
        className,
      )}
    >
      <span
        aria-hidden="true"
        data-component={indicatorDataComponent ?? `${dataComponent}-indicator`}
        className="pointer-events-none absolute inset-y-0 left-0 z-0 w-1/2 rounded-full bg-v3-primary shadow-[0_6px_18px_hsla(214,100%,34%,0.2)] transition-transform duration-300 ease-out motion-reduce:transition-none"
        style={{ transform: value ? "translateX(0)" : "translateX(100%)" }}
      />
      <button
        ref={leftButtonRef}
        type="button"
        role="tab"
        aria-selected={value}
        tabIndex={value ? 0 : -1}
        disabled={disabled}
        data-component={leftButtonDataComponent ?? `${dataComponent}-button-left`}
        className={cn(buttonClassName, value ? "text-white" : "text-v3-text-muted hover:text-v3-primary")}
        onClick={() => onValueChange(true)}
        onKeyDown={(event) => handleKeyDown(event, true)}
      >
        {leftLabel}
      </button>
      <button
        ref={rightButtonRef}
        type="button"
        role="tab"
        aria-selected={!value}
        tabIndex={value ? -1 : 0}
        disabled={disabled}
        data-component={rightButtonDataComponent ?? `${dataComponent}-button-right`}
        className={cn(buttonClassName, value ? "text-v3-text-muted hover:text-v3-primary" : "text-white")}
        onClick={() => onValueChange(false)}
        onKeyDown={(event) => handleKeyDown(event, false)}
      >
        {rightLabel}
      </button>
    </div>
  );
}

export { TogglePill };
