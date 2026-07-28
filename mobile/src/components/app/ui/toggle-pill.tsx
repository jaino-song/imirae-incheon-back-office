"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

const SOURCE_COMPONENT = "TogglePill";

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
  "data-component": dataComponent = "toggle-pill",
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
    "relative z-10 inline-flex min-w-0 items-center justify-center rounded-full border-0 bg-transparent px-5 text-[0.78rem] font-extrabold leading-none tracking-[-0.025em] outline-none transition-colors duration-200 focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-v3-primary/25 disabled:cursor-not-allowed disabled:opacity-55";

  return (
    <div
      data-component={dataComponent}
      data-source-component={SOURCE_COMPONENT}
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        "relative isolate inline-grid h-[42px] min-h-[42px] w-fit grid-cols-2 overflow-hidden rounded-full bg-v3-primary/10",
        className,
      )}
      {...props}
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
