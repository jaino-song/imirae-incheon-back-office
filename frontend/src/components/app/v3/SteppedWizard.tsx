"use client";

import React from "react";
import { Check } from "lucide-react";
import { useIsMobile } from "@/hooks/useIsMobile";
import { SurfaceCard } from "@/components/ui/surface-card";
import { Spinner } from "@/components/ui/spinner";
import { SurfaceFrame } from "@/components/ui/surface-frame";
import { FooterNavigation } from "@/components/ui/footer-navigation";
import { cn } from "@/lib/utils";
import { SteppedWizardStepper } from "./SteppedWizardStepper";

export interface WizardStep {
  label: string;
  content: React.ReactNode;
  summary?: React.ReactNode;
  summaryTitle?: React.ReactNode;
}

export interface SteppedWizardProps {
  title: string;
  subtitle?: string;
  steps: WizardStep[];
  currentStep: number;
  showStepper?: boolean;
  onStepChange: (step: number) => void;
  onComplete: () => void;
  onBack?: () => void;
  backLabel?: string;
  nextLabel?: string;
  prevLabel?: string;
  completeLabel?: string;
  isSubmitting?: boolean;
  isNextDisabled?: boolean;
  className?: string;
}

const STEPPED_WIZARD_CARD_CLASS_NAME =
  "gap-5 !p-5 sm:!p-6 [&_[data-component='stepped-wizard-title']]:!text-[1.72rem] md:[&_[data-component='stepped-wizard-title']]:!text-[1.5rem] [&_[data-component='stepped-wizard-subtitle']]:!max-w-[30ch] [&_[data-component='stepped-wizard-subtitle']]:!text-[0.82rem] md:[&_[data-component='stepped-wizard-subtitle']]:!text-[0.76rem]";

function DesktopStepIndicator({
  steps,
  currentStep,
}: {
  steps: WizardStep[];
  currentStep: number;
}) {
  return (
    <SteppedWizardStepper
      steps={steps}
      currentStep={currentStep}
      showLabels={false}
      className="hidden md:flex"
    />
  );
}

function MobileStepIndicator({
  steps,
  currentStep,
}: {
  steps: WizardStep[];
  currentStep: number;
}) {
  const progress = ((currentStep + 1) / steps.length) * 100;

  return (
    <div data-component="desktop_v3_stepped-wizard_stepper-mobile" className="md:hidden">
      <div data-component="desktop_v3_stepped-wizard_stepper-mobile_header" className="mb-2 flex items-center justify-end">
        <span className="text-[0.7rem] font-semibold text-v3-text-muted">
          {currentStep + 1} / {steps.length} 단계
        </span>
      </div>
      <div data-component="desktop_v3_stepped-wizard_stepper-mobile_track" className="h-1.5 w-full overflow-hidden rounded-full bg-v3-border">
        <div
          data-component="desktop_v3_stepped-wizard_stepper-mobile_track_progress"
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
  step,
  stepIndex,
  onEdit,
}: {
  step: WizardStep;
  stepIndex: number;
  onEdit: () => void;
}) {
  if (!step.summary && !step.summaryTitle) return null;

  return (
    <>
      <div className="hidden md:block bg-v3-green-light rounded-[18px] p-4 mb-6">
        <div
          className={cn(
            "text-[0.7rem] uppercase tracking-[0.1em] text-v3-green font-semibold",
            step.summary ? "mb-3" : undefined,
          )}
        >
          ✓ {step.summaryTitle ?? `${stepIndex + 1}단계 완료 — ${step.label}`}
        </div>
        {step.summary}
      </div>

      <div className="md:hidden mb-5">
        <button
          type="button"
          onClick={onEdit}
          className="w-full bg-v3-green-light rounded-2xl p-3.5 flex items-center justify-between border-[1.5px] border-transparent hover:border-[hsl(137,40%,80%)] active:border-[hsl(137,40%,80%)] transition-all"
        >
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-full bg-v3-green flex items-center justify-center shrink-0">
              <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />
            </div>
            <div className="text-left">
              <div className="text-[0.8rem] font-bold text-v3-dark">
                {stepIndex + 1}단계: {step.label}
              </div>
            </div>
          </div>
          <span className="text-[0.7rem] font-semibold text-v3-primary px-3 py-1.5 rounded-[10px] bg-v3-primary-light shrink-0">
            수정
          </span>
        </button>
      </div>
    </>
  );
}

export function SteppedWizard({
  title,
  subtitle,
  steps,
  currentStep,
  showStepper = true,
  onStepChange,
  onComplete,
  onBack,
  backLabel,
  nextLabel = "다음",
  prevLabel = "이전",
  completeLabel = "완료",
  isSubmitting = false,
  isNextDisabled = false,
  className,
}: SteppedWizardProps) {
  const isMobile = useIsMobile();
  const isFirstStep = currentStep === 0;
  const isLastStep = currentStep === steps.length - 1;
  const isNextButtonDisabled = isSubmitting || isNextDisabled;
  const currentStepData = steps[currentStep];

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
    <div className={cn("flex w-full flex-col", className)}>
      {onBack && backLabel && (
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-[0.85rem] md:text-[0.85rem] text-[0.8rem] font-semibold text-v3-text-muted hover:text-v3-primary transition-colors mb-4 md:mb-6 self-start"
        >
          {backLabel}
        </button>
      )}

      <SurfaceFrame
        data-component="desktop_v3_stepped-wizard_frame"
        dataComponents={{
          container: "desktop_v3_stepped-wizard_frame",
          glow: "desktop_v3_stepped-wizard_frame-glow",
          inner: "desktop_v3_stepped-wizard_frame-inner",
        }}
        className={cn(
          "!h-full min-h-0 items-center !overflow-visible py-0 md:py-0",
          isMobile && "flex-1",
        )}
      >
        <SurfaceCard
          data-component="desktop_v3_stepped-wizard"
          dataComponents={{
            card: "desktop_v3_stepped-wizard",
            header: "desktop_v3_stepped-wizard_header",
            title: "desktop_v3_stepped-wizard_title",
            subtitle: "desktop_v3_stepped-wizard_subtitle",
            content: "desktop_v3_stepped-wizard_content",
          }}
          className={cn("h-full min-h-[70vh] max-h-[85%]", STEPPED_WIZARD_CARD_CLASS_NAME)}
          contentClassName="flex flex-1 min-h-0 overflow-hidden gap-0"
          title={title}
          subtitle={subtitle}
        >
        <div data-component="desktop_v3_stepped-wizard_body" className="flex min-h-0 flex-1 flex-col gap-[18px]">
          {showStepper ? (
            <>
              <DesktopStepIndicator steps={steps} currentStep={currentStep} />
              <MobileStepIndicator steps={steps} currentStep={currentStep} />
            </>
          ) : null}

          <div className="flex-1 min-h-0 overflow-y-auto">
            {steps.map(
              (step, idx) =>
                idx < currentStep && (
                  <CompletedStepSummary
                    key={idx}
                    step={step}
                    stepIndex={idx}
                    onEdit={() => onStepChange(idx)}
                  />
                )
            )}

            {currentStepData && (
              <div data-component="desktop_v3_stepped-wizard_body_step-content">
                {currentStepData.content}
              </div>
            )}
          </div>

          <FooterNavigation
            dataComponent="desktop_v3_stepped-wizard_body_actions"
            prevDataComponent="desktop_v3_stepped-wizard_body_prev-btn"
            nextDataComponent={isLastStep ? "desktop_v3_stepped-wizard_body_complete-btn" : "desktop_v3_stepped-wizard_body_next-btn"}
            prevVariant="neutral"
            nextVariant="positive"
            prevSize="sm"
            nextSize="sm"
            prevWidth="sm"
            nextWidth="sm"
            prevLabel={prevLabel}
            nextLabel={isSubmitting ? "" : isLastStep ? completeLabel : nextLabel}
            prevDisabled={isFirstStep}
            nextDisabled={isNextButtonDisabled}
            prevHidden={isFirstStep}
            onPrev={handlePrev}
            onNext={handleNext}
            nextContent={
              isSubmitting ? (
                <Spinner size="sm" />
              ) : (
                isLastStep ? completeLabel : nextLabel
              )
            }
            stickyOnMobile={isMobile}
            className="mt-1 gap-0"
          />
        </div>
      </SurfaceCard>
      </SurfaceFrame>
    </div>
  );
}
