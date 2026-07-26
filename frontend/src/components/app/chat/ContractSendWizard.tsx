"use client";

import { useState } from "react";
import {
  CONTRACT_CREATION_STEPPER_STEPS,
  ContractCreationForm,
} from "@/components/app/contracts/ContractCreationForm";
import { SteppedWizardStepper } from "@/components/app/v3";

interface ContractSendWizardProps {
  onComplete?: () => void;
}

export default function ContractSendWizard({ onComplete }: ContractSendWizardProps) {
  const [activeStep, setActiveStep] = useState(0);

  return (
    <div data-component="desktop_chat_page_wizard-contract-send" className="flex min-h-[560px] flex-col">
      <div className="mb-4">
        <h3 className="mb-1 text-base font-bold">
          계약서 전송
        </h3>
        <p className="text-sm text-muted-foreground">
          계약서를 보낼 산모와 계약 정보를 입력해주세요.
        </p>
      </div>

      <div data-component="desktop_chat_page_wizard-contract-send_body" className="flex min-h-0 flex-1 flex-col">
        <ContractCreationForm
          activeStep={activeStep}
          onActiveStepChange={setActiveStep}
          onClose={() => setActiveStep(0)}
          onSuccess={onComplete}
          contentClassName="h-auto flex-1 px-0 py-0"
          stepContentClassName="p-0"
          footerClassName="border-t-0 px-0 pb-0 pt-4"
          renderLayout={({ content, footer }) => (
            <div className="flex min-h-0 flex-1 flex-col gap-4">
              <SteppedWizardStepper
                steps={CONTRACT_CREATION_STEPPER_STEPS}
                currentStep={activeStep}
                className="shrink-0"
              />
              {content}
              {footer}
            </div>
          )}
        />
      </div>
    </div>
  );
}
