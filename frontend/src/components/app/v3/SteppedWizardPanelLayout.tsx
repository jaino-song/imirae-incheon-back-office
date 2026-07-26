"use client";

import React from "react";
import { cn } from "@/lib/utils";

interface SteppedWizardPanelContentProps {
  children: React.ReactNode;
  feedback?: React.ReactNode;
  dataComponent?: string;
  stepContentDataComponent?: string;
  flattenStepContent?: boolean;
  className?: string;
  stepContentClassName?: string;
}

export const STEPPED_WIZARD_PANEL_CONTENT_CLASS_NAME =
  "h-full min-h-0 flex flex-col gap-[calc(24px*var(--glint-ui-scale,1))]";
export const STEPPED_WIZARD_PANEL_STEP_CONTENT_CLASS_NAME = "min-h-0 p-0";

export const SteppedWizardPanelContent = React.forwardRef<
  HTMLDivElement,
  SteppedWizardPanelContentProps
>(function SteppedWizardPanelContent(
  {
    children,
    feedback,
    dataComponent = "desktop_v3_stepped-wizard_panel-content",
    stepContentDataComponent = "desktop_v3_stepped-wizard_step-content",
    flattenStepContent = false,
    className,
    stepContentClassName,
  },
  ref,
) {
  if (flattenStepContent) {
    return (
      <div
        ref={ref}
        data-component={dataComponent}
        className={cn(
          STEPPED_WIZARD_PANEL_CONTENT_CLASS_NAME,
          "flex-1",
          className,
          stepContentClassName,
        )}
      >
        {children}
        {feedback}
      </div>
    );
  }

  return (
    <div
      ref={ref}
      data-component={dataComponent}
      className={cn(STEPPED_WIZARD_PANEL_CONTENT_CLASS_NAME, className)}
    >
      <div
        data-component={stepContentDataComponent}
        className={cn(STEPPED_WIZARD_PANEL_STEP_CONTENT_CLASS_NAME, stepContentClassName)}
      >
        {children}
      </div>
      {feedback}
    </div>
  );
});
