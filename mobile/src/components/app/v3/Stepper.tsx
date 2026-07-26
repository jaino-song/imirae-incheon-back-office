import React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface StepperStep {
  /** Display label below the circle. */
  label: string;
  /**
   * Whether this step is complete.
   * Ignored when `activeStep` is provided on the parent.
   */
  done?: boolean;
  /** Optional icon rendered inside the circle instead of the step number. */
  icon?: React.ReactNode;
}

type StepperSize = "sm" | "md" | "lg";

type StepState = "done" | "active" | "pending";

export interface StepperProps {
  /** Caller-context canonical base, e.g. `mobile_chat_page_wizard-registration_stepper`. */
  "data-component"?: string;
  /** Step definitions — length determines how many steps are shown. */
  steps: StepperStep[];
  /**
   * When set, step state is derived automatically:
   *  - index < activeStep  → done
   *  - index === activeStep → active (current)
   *  - index > activeStep  → pending
   *
   * Overrides individual `step.done` values.
   */
  activeStep?: number;
  /** Visual size. @default "md" */
  size?: StepperSize;
  /** Show a check icon for completed steps instead of the step number. @default false */
  showCheckOnDone?: boolean;
  /** Additional class names on the root wrapper. */
  className?: string;
}

const SIZE_MAP: Record<StepperSize, { circle: string; font: string; label: string; connector: string }> = {
  sm: { circle: "w-6 h-6", font: "text-[0.55rem]", label: "text-[0.5rem]", connector: "mt-[-10px] px-1.5 text-xs" },
  md: { circle: "w-8 h-8", font: "text-[0.65rem]", label: "text-[0.6rem]", connector: "mt-[-12px] px-2 text-sm" },
  lg: { circle: "w-10 h-10", font: "text-xs", label: "text-[0.7rem]", connector: "mt-[-14px] px-2.5 text-base" },
};

function resolveState(step: StepperStep, index: number, activeStep?: number): StepState {
  if (activeStep !== undefined) {
    if (index < activeStep) return "done";
    if (index === activeStep) return "active";
    return "pending";
  }
  return step.done ? "done" : "pending";
}

const STATE_CIRCLE: Record<StepState, string> = {
  done:    "bg-v3-primary text-white",
  active:  "bg-v3-primary text-white ring-2 ring-v3-primary/30 ring-offset-1",
  pending: "bg-v3-dim-white text-v3-text-muted",
};

export function Stepper({
  "data-component": dataComponent,
  steps,
  activeStep,
  size = "md",
  showCheckOnDone = false,
  className,
}: StepperProps) {
  const tokens = SIZE_MAP[size];
  const sub = (suffix: string) => (dataComponent ? `${dataComponent}_${suffix}` : undefined);

  return (
    <div data-component={dataComponent} data-slot="stepper" className={cn("flex items-center", className)}>
      {steps.map((step, idx) => {
        const state = resolveState(step, idx, activeStep);
        const nextState = idx < steps.length - 1 ? resolveState(steps[idx + 1], idx + 1, activeStep) : null;

        let indicator: React.ReactNode;
        if (step.icon) {
          indicator = step.icon;
        } else if (showCheckOnDone && state === "done") {
          indicator = <Check className={size === "sm" ? "w-3 h-3" : size === "lg" ? "w-5 h-5" : "w-3.5 h-3.5"} />;
        } else {
          indicator = idx + 1;
        }

        return (
          <React.Fragment key={step.label}>
            <div data-component={sub("step")} className="flex flex-1 flex-col items-center">
              <div
                data-component={sub("step_circle")}
                className={cn(
                  "rounded-full flex items-center justify-center font-bold",
                  tokens.circle,
                  tokens.font,
                  STATE_CIRCLE[state],
                )}
              >
                {indicator}
              </div>
              <span
                data-component={sub("step_label")}
                className={cn(
                  "mt-1 whitespace-nowrap",
                  tokens.label,
                  state === "done" ? "text-v3-primary" : "text-v3-text-muted",
                )}
              >
                {step.label}
              </span>
            </div>

            {idx < steps.length - 1 && (
              <div
                data-component={sub("connector")}
                className={cn(
                  "shrink-0 select-none font-semibold leading-none",
                  tokens.connector,
                  nextState === "done" || nextState === "active" ? "text-v3-primary" : "text-v3-border",
                )}
              >
                -
              </div>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}
