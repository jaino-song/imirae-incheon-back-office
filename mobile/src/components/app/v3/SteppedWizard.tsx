"use client";

import React from "react";
import { ChevronLeft, ChevronRight, Check } from "lucide-react";
import { useIsMobile } from "@/hooks/useIsMobile";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const SOURCE_COMPONENT = "SteppedWizard";
/**
 * TODO(data-component): Remove these legacy fallbacks after caller migration.
 * data-component="stepped-wizard-root"
 * data-component="stepped-wizard-back-button"
 * data-component="stepped-wizard"
 * data-component="stepped-wizard-header"
 * data-component="stepped-wizard-title"
 * data-component="stepped-wizard-subtitle"
 * data-component="stepped-wizard-stepper-desktop"
 * data-component="stepped-wizard-stepper-desktop-item"
 * data-component="stepped-wizard-stepper-desktop-index"
 * data-component="stepped-wizard-stepper-desktop-label"
 * data-component="stepped-wizard-stepper-desktop-connector"
 * data-component="stepped-wizard-stepper-mobile"
 * data-component="stepped-wizard-stepper-mobile-header"
 * data-component="stepped-wizard-stepper-mobile-current-label"
 * data-component="stepped-wizard-stepper-mobile-progress-label"
 * data-component="stepped-wizard-stepper-mobile-progress-track"
 * data-component="stepped-wizard-stepper-mobile-progress-bar"
 * data-component="stepped-wizard-content"
 * data-component="stepped-wizard-children"
 * data-component="stepped-wizard-completed-summary"
 * data-component="stepped-wizard-completed-summary-title"
 * data-component="stepped-wizard-completed-summary-content"
 * data-component="stepped-wizard-step-content"
 * data-component="stepped-wizard-footer"
 * data-component="stepped-wizard-prev-button"
 * data-component="stepped-wizard-footer-progress"
 * data-component="stepped-wizard-next-button"
 * data-component="stepped-wizard-next-spinner"
 */

export interface WizardStep {
  label: string;
  content: React.ReactNode;
  summary?: React.ReactNode;
}

export interface SteppedWizardProps {
  "data-component"?: string;
  title: string;
  subtitle?: string;
  steps: WizardStep[];
  children?: React.ReactNode;
  currentStep: number;
  onStepChange: (step: number) => void;
  onComplete: () => void;
  onBack?: () => void;
  backLabel?: string;
  nextLabel?: string;
  prevLabel?: string;
  completeLabel?: string;
  isSubmitting?: boolean;
  isNextDisabled?: boolean;
  stepperProps?: {
    showDesktop?: boolean;
    showMobile?: boolean;
    desktopClassName?: string;
    mobileClassName?: string;
  };
  className?: string;
}

function DesktopStepIndicator({
  dataComponent,
  steps,
  currentStep,
  className,
}: {
  dataComponent?: string;
  steps: WizardStep[];
  currentStep: number;
  className?: string;
}) {
  const sub = (suffix: string, legacyValue: string) =>
    dataComponent ? `${dataComponent}_${suffix}` : legacyValue;

  return (
    <div
      data-component={dataComponent ?? "stepped-wizard-stepper-desktop"}
      className={cn("hidden md:flex items-center justify-center gap-0 pb-7", className)}
    >
      {steps.map((step, idx) => {
        const isCompleted = idx < currentStep;
        const isCurrent = idx === currentStep;

        return (
          <React.Fragment key={idx}>
            <div
              data-component={sub(`item-${idx + 1}`, "stepped-wizard-stepper-desktop-item")}
              className={cn(
                "flex items-center gap-2",
                isCurrent && "text-v3-primary",
                isCompleted && "text-v3-dark"
              )}
            >
              <div
                data-component={sub(`item-${idx + 1}_index`, "stepped-wizard-stepper-desktop-index")}
                className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-300",
                  isCompleted &&
                  "bg-v3-primary text-white shadow-[0_2px_8px_hsla(214,100%,34%,0.2)]",
                  isCurrent &&
                  "bg-v3-primary text-white shadow-[0_2px_12px_hsla(214,100%,34%,0.3)] scale-110",
                  !isCompleted &&
                  !isCurrent &&
                  "bg-v3-dim-white text-v3-text-muted border-2 border-v3-border"
                )}
              >
                {isCompleted ? (
                  <Check className="w-3.5 h-3.5" strokeWidth={3} />
                ) : (
                  idx + 1
                )}
              </div>
              <span
                data-component={sub(`item-${idx + 1}_label`, "stepped-wizard-stepper-desktop-label")}
                className={cn(
                  "text-xs font-semibold",
                  isCurrent && "text-v3-primary font-bold",
                  isCompleted && "text-v3-dark",
                  !isCompleted && !isCurrent && "text-v3-text-muted"
                )}
              >
                {step.label}
              </span>
            </div>

            {idx < steps.length - 1 && (
              <div
                data-component={sub(`connector-${idx + 1}`, "stepped-wizard-stepper-desktop-connector")}
                className={cn(
                  "w-12 h-0.5 mx-2 rounded-full",
                  idx < currentStep ? "bg-v3-primary" : "bg-v3-border"
                )}
              />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function MobileStepIndicator({
  dataComponent,
  steps,
  currentStep,
  className,
}: {
  dataComponent?: string;
  steps: WizardStep[];
  currentStep: number;
  className?: string;
}) {
  const progress = ((currentStep + 1) / steps.length) * 100;
  const sub = (suffix: string, legacyValue: string) =>
    dataComponent ? `${dataComponent}_${suffix}` : legacyValue;

  return (
    <div data-component={dataComponent ?? "stepped-wizard-stepper-mobile"} className={cn("md:hidden pb-5", className)}>
      <div data-component={sub("header", "stepped-wizard-stepper-mobile-header")} className="flex items-center justify-between mb-2.5">
        <span data-component={sub("current-label", "stepped-wizard-stepper-mobile-current-label")} className="text-xs font-bold text-v3-primary">
          {steps[currentStep]?.label}
        </span>
        <span data-component={sub("progress-label", "stepped-wizard-stepper-mobile-progress-label")} className="text-[0.7rem] font-semibold text-v3-text-muted">
          {currentStep + 1} / {steps.length} 단계
        </span>
      </div>
      <div data-component={sub("progress-track", "stepped-wizard-stepper-mobile-progress-track")} className="w-full h-1.5 rounded-full bg-v3-border overflow-hidden">
        <div
          data-component={sub("progress-track_bar", "stepped-wizard-stepper-mobile-progress-bar")}
          className="h-full rounded-full bg-gradient-to-r from-v3-primary to-blue-500 transition-all duration-400"
          style={{
            width: `${progress}%`,
            transitionTimingFunction: "cubic-bezier(0.34, 1.56, 0.64, 1)",
          }}
        />
      </div>
    </div>
  );
}

function CompletedStepSummary({
  dataComponent,
  step,
  stepIndex,
}: {
  dataComponent?: string;
  step: WizardStep;
  stepIndex: number;
}) {
  if (!step.summary) return null;
  const sub = (suffix: string, legacyValue: string) =>
    dataComponent ? `${dataComponent}_${suffix}` : legacyValue;

  return (
    <>
      <div data-component={dataComponent ?? "stepped-wizard-completed-summary"} className="hidden md:block bg-v3-green-light rounded-2xl p-4 mb-6">
        <div data-component={sub("title", "stepped-wizard-completed-summary-title")} className="text-[0.7rem] uppercase tracking-[0.1em] text-v3-green font-semibold mb-3">
          ✓ {stepIndex + 1}단계 완료 — {step.label}
        </div>
        <div data-component={sub("content", "stepped-wizard-completed-summary-content")}>{step.summary}</div>
      </div>
    </>
  );
}

export function SteppedWizard({
  "data-component": dataComponent,
  title,
  subtitle,
  steps,
  children,
  currentStep,
  onStepChange,
  onComplete,
  onBack,
  backLabel,
  nextLabel = "다음",
  prevLabel = "이전",
  completeLabel = "완료",
  isSubmitting = false,
  isNextDisabled = false,
  stepperProps,
  className,
}: SteppedWizardProps) {
  const isMobile = useIsMobile();
  const isFirstStep = currentStep === 0;
  const isLastStep = currentStep === steps.length - 1;
  const isNextButtonDisabled = isSubmitting || isNextDisabled;
  const currentStepData = steps[currentStep];
  const showDesktopStepper = stepperProps?.showDesktop ?? true;
  const showMobileStepper = stepperProps?.showMobile ?? true;
  const sub = (suffix: string, legacyValue: string) =>
    dataComponent ? `${dataComponent}_${suffix}` : legacyValue;

  const handleNext = () => {
    if (isLastStep) {
      onComplete();
    } else {
      onStepChange(currentStep + 1);
    }
  };

  const handlePrev = () => {
    if (!isFirstStep) {
      onStepChange(currentStep - 1);
    }
  };

  return (
    <div
      // TODO(data-component): Remove the legacy fallbacks after caller migration.
      data-component={dataComponent ?? "stepped-wizard-root"}
      data-source-component={SOURCE_COMPONENT}
      className={cn(
        "flex w-full flex-col",
        isMobile && "h-full min-h-0 overflow-hidden",
        className
      )}
    >
      {onBack && backLabel && (
        <button
          data-component={sub("back-button", "stepped-wizard-back-button")}
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-[0.85rem] md:text-[0.85rem] text-[0.8rem] font-semibold text-v3-text-muted hover:text-v3-primary transition-colors mb-4 md:mb-6 self-start"
        >
          <ChevronLeft className="w-5 h-5 md:w-5 md:h-5 w-[18px] h-[18px]" />
          {backLabel}
        </button>
      )}

      <div
        data-component={sub("panel", "stepped-wizard")}
        className={cn(
          "bg-white rounded-2xl shadow-v3 flex flex-col overflow-hidden p-6",
          isMobile && "max-h-full min-h-0 h-full"
        )}
      >
        <div data-component={sub("panel_header", "stepped-wizard-header")} className="text-center">
          <h2 data-component={sub("panel_header_title", "stepped-wizard-title")} className="text-lg md:text-xl font-extrabold text-v3-dark mb-1">
            {title}
          </h2>
          {subtitle && (
            <p data-component={sub("panel_header_subtitle", "stepped-wizard-subtitle")} className="text-xs md:text-[0.8rem] text-v3-text-muted mb-4 md:mb-7">
              {subtitle}
            </p>
          )}
        </div>

        {showDesktopStepper && (
          <DesktopStepIndicator
            dataComponent={dataComponent ? `${dataComponent}_panel_stepper-desktop` : undefined}
            steps={steps}
            currentStep={currentStep}
            className={stepperProps?.desktopClassName}
          />
        )}
        {showMobileStepper && (
          <MobileStepIndicator
            dataComponent={dataComponent ? `${dataComponent}_panel_stepper-mobile` : undefined}
            steps={steps}
            currentStep={currentStep}
            className={stepperProps?.mobileClassName}
          />
        )}

        <div data-component={sub("panel_content", "stepped-wizard-content")} className="min-h-0 overflow-y-auto h-full">
          {children ? <div data-component={sub("panel_content_children", "stepped-wizard-children")}>{children}</div> : null}
          {steps.map(
            (step, idx) =>
              idx < currentStep && (
                <CompletedStepSummary
                  dataComponent={
                    dataComponent
                      ? `${dataComponent}_panel_content_completed-${idx + 1}`
                      : undefined
                  }
                  key={idx}
                  step={step}
                  stepIndex={idx}
                />
              )
          )}

          {currentStepData && (
            <div data-component={sub("panel_content_step", "stepped-wizard-step-content")}>
              {currentStepData.content}
            </div>
          )}
        </div>

        <div
          data-component={sub("panel_footer", "stepped-wizard-footer")}
          className={cn(
            "flex items-center justify-between",
            "pt-4 md:pt-5",
            isMobile &&
            "sticky bottom-0 bg-white"
          )}
        >
          <button
            data-component={sub("panel_footer_prev-button", "stepped-wizard-prev-button")}
            type="button"
            onClick={handlePrev}
            disabled={isFirstStep}
            className={cn(
              "inline-flex items-center gap-1.5 px-4 md:px-5 py-2.5 md:py-2.5 rounded-2xl border-[1.5px] border-v3-border",
              "bg-white text-[0.8rem] md:text-[0.85rem] font-semibold text-v3-text-muted transition-all",
              "hover:border-v3-text-muted",
              isFirstStep && "opacity-0 pointer-events-none"
            )}
          >
            <ChevronLeft className="w-4 h-4" />
            {prevLabel}
          </button>

          <span data-component={sub("panel_footer_progress", "stepped-wizard-footer-progress")} className="hidden md:block text-xs text-v3-text-muted font-semibold">
            {currentStep + 1} / {steps.length} 단계
          </span>

          <Button
            data-component={sub("panel_footer_next-button", "stepped-wizard-next-button")}
            type="button"
            onClick={handleNext}
            disabled={isNextButtonDisabled}
            size="md"
            width="md"
            className={cn(
              "gap-1.5 rounded-2xl border-none",
              "bg-v3-primary text-[0.8rem] md:text-[0.85rem] font-bold text-white",
              "shadow-[0_2px_8px_hsla(214,100%,34%,0.2)]",
              "hover:bg-v3-primary-hover hover:-translate-y-px",
              "disabled:opacity-60",
              isMobile ? "" : "px-7"
            )}
          >
            {isSubmitting ? (
              <div data-component={sub("panel_footer_next-button_spinner", "stepped-wizard-next-spinner")} className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <>
                {isLastStep ? completeLabel : nextLabel}
                {!isLastStep && (
                  <ChevronRight className="w-4 h-4" />
                )}
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
