"use client";

import React from "react";
import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

export interface SteppedWizardStepperStep {
  label: React.ReactNode;
}

export interface SteppedWizardStepperProps {
  steps: readonly SteppedWizardStepperStep[];
  currentStep: number;
  showLabels?: boolean;
  className?: string;
}

export function SteppedWizardStepper({
  steps,
  currentStep,
  showLabels = true,
  className,
}: SteppedWizardStepperProps) {
  return (
    <div
      data-component="desktop_v3_stepped-wizard_stepper-desktop"
      className={cn(
        "shrink-0 flex items-start justify-center gap-0 overflow-visible py-[0.225rem]",
        showLabels ? "min-h-[2.6rem]" : "min-h-[2.16rem]",
        className,
      )}
    >
      {steps.map((step, idx) => {
        const isCompleted = idx < currentStep;
        const isCurrent = idx === currentStep;

        return (
          <React.Fragment key={idx}>
            <div
              data-component="desktop_v3_stepped-wizard_stepper-desktop_item"
              className={cn(
                "flex shrink-0 flex-col items-center overflow-visible text-center",
                showLabels ? "w-[3.65rem] gap-2" : "w-[1.575rem]",
              )}
            >
              <div data-component="desktop_v3_stepped-wizard_stepper-desktop_item_step" className="flex h-[1.575rem] items-center justify-center overflow-visible">
                <div
                  data-component="desktop_v3_stepped-wizard_stepper-desktop_item_step_circle"
                  className={cn(
                    "flex h-[1.575rem] w-[1.575rem] items-center justify-center rounded-full text-[0.612rem] font-bold transition-all duration-300 will-change-transform",
                    isCompleted && "bg-v3-primary text-white shadow-[0_2px_8px_hsla(214,100%,34%,0.2)]",
                    isCurrent && "scale-110 bg-v3-primary text-white shadow-[0_2px_12px_hsla(214,100%,34%,0.3)]",
                    !isCompleted && !isCurrent && "border-2 border-v3-border bg-v3-dim-white text-v3-text-muted",
                  )}
                >
                  {isCompleted ? <Check className="h-[0.7875rem] w-[0.7875rem]" strokeWidth={3} /> : idx + 1}
                </div>
              </div>
              {showLabels && (
                <span
                  data-component="desktop_v3_stepped-wizard_stepper-desktop_item_label"
                  className={cn(
                    "block w-full text-center text-[0.535rem] font-semibold leading-none whitespace-nowrap transition-colors",
                    (isCompleted || isCurrent) ? "text-v3-primary" : "text-v3-text-muted",
                  )}
                >
                  {step.label}
                </span>
              )}
            </div>
            {idx < steps.length - 1 && (
              <div
                data-component="desktop_v3_stepped-wizard_stepper-desktop_connector"
                className={cn(
                  "mt-[0.73125rem] h-[0.1125rem] w-[1.45rem] shrink-0 rounded-full",
                  idx < currentStep ? "bg-v3-primary" : "bg-v3-border",
                )}
              />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}
