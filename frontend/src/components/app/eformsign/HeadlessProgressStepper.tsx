"use client";
import { Check, LoaderCircle, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  HeadlessProgressState,
  HeadlessProgressStep,
  HeadlessProgressStepKey,
} from "@babyjamjam/shared/types/eformsign";

export type {
  HeadlessProgressEvent,
  HeadlessProgressState,
  HeadlessProgressStep,
  HeadlessProgressStepKey,
} from "@babyjamjam/shared/types/eformsign";

interface HeadlessProgressStepperBaseProps {
  steps: readonly HeadlessProgressStep[];
  progress: HeadlessProgressState;
  ariaLabel: string;
  testIdPrefix: string;
  className?: string;
  errorHint?: string;
  spinnerClassName?: string;
}

type HeadlessProgressStepperProps = HeadlessProgressStepperBaseProps & (
  | {
      "data-component": string;
      dataComponentPrefix?: never;
    }
  | {
      "data-component"?: never;
      dataComponentPrefix: string;
    }
);

function getProgressIndex(
  steps: readonly HeadlessProgressStep[],
  step: HeadlessProgressStepKey | null,
): number {
  if (!step) return -1;
  return steps.findIndex((item) => item.key === step);
}

export function HeadlessProgressStepper({
  steps,
  progress,
  ariaLabel,
  "data-component": canonicalDataComponent,
  dataComponentPrefix: legacyDataComponent,
  testIdPrefix,
  className,
  errorHint,
  spinnerClassName = "animate-spin",
}: HeadlessProgressStepperProps) {
  const dataComponent = canonicalDataComponent ?? legacyDataComponent;
  const sub = (suffix: string) =>
    canonicalDataComponent
      ? `${dataComponent}_${suffix}`
      : `${dataComponent}-${suffix}`;
  const currentIndex = getProgressIndex(steps, progress.step);

  if (currentIndex < 0) {
    return null;
  }

  return (
    <ol
      data-component={sub("stepper")}
      data-testid={`${testIdPrefix}-stepper`}
      className={cn("flex flex-col", className)}
      aria-label={ariaLabel}
    >
      {steps.map((item, idx) => {
        const isDone = progress.completed ? idx <= currentIndex : idx < currentIndex;
        const isActive = idx === currentIndex && !progress.completed && !progress.failed;
        const isFailed = idx === currentIndex && progress.failed;
        const state = isFailed ? "error" : isActive ? "active" : isDone ? "done" : "pending";

        return (
          <li
            key={item.key}
            data-component={sub("step")}
            data-testid={`${testIdPrefix}-step-${item.key}`}
            data-state={state}
            className="relative flex gap-3 pb-4 last:pb-0"
          >
            {idx < steps.length - 1 && (
              <span
                data-component={sub("connector")}
                className={cn(
                  "absolute left-[15px] top-8 h-[calc(100%-2rem)] w-0.5 rounded-full",
                  idx < currentIndex ? "bg-v3-primary" : "bg-v3-border",
                )}
                aria-hidden="true"
              />
            )}
            <span
              data-component={sub("circle")}
              className={cn(
                "relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[0.7rem] font-bold transition-colors",
                state === "done" && "bg-v3-primary text-white",
                state === "active" && "bg-v3-primary text-white ring-2 ring-v3-primary/25 ring-offset-2",
                state === "error" && "bg-destructive text-destructive-foreground",
                state === "pending" && "border border-v3-border bg-v3-dim-white text-v3-text-muted",
              )}
            >
              {state === "done" ? (
                <Check className="h-4 w-4" strokeWidth={3} />
              ) : state === "active" ? (
                <LoaderCircle
                  data-testid={`${testIdPrefix}-spinner-${item.key}`}
                  className={cn("h-4 w-4", spinnerClassName)}
                  strokeWidth={2.4}
                />
              ) : state === "error" ? (
                <X
                  data-testid={`${testIdPrefix}-error-${item.key}`}
                  className="h-4 w-4"
                  strokeWidth={3}
                />
              ) : (
                idx + 1
              )}
            </span>
            <span className="flex min-w-0 flex-col pt-1">
              <span
                data-component={sub("label")}
                className={cn(
                  "text-sm font-semibold leading-5",
                  (state === "done" || state === "active") && "text-v3-dark",
                  state === "pending" && "text-v3-text-muted",
                  state === "error" && "text-destructive",
                )}
              >
                {state === "error" ? item.errorLabel : item.label}
              </span>
              {state === "active" && (
                <span className="text-xs font-medium text-v3-text-muted">처리 중</span>
              )}
              {state === "error" && errorHint && (
                <span className="text-xs font-medium text-v3-text-muted">{errorHint}</span>
              )}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
