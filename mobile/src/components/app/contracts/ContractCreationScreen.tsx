"use client";

import { useMemo } from "react";

import { MobileTwoButtonModal } from "@/components/app/ui/MobileTwoButtonModal";
import { Block, SteppedWizard, type WizardStep } from "@/components/app/v3";
import { HeadlessProgressModal } from "@/components/app/eformsign/HeadlessProgressModal";
import { CONTRACT_CREATION_PROGRESS_STEPS } from "@/lib/eformsign/headless-progress";
import type { ContractCreationFlow } from "@/hooks/contracts/useContractCreationFlow";
import { ContractCreationClientStep } from "./ContractCreationClientStep";
import { ContractCreationEmployeeStep } from "./ContractCreationEmployeeStep";
import { ContractCreationReviewStep } from "./ContractCreationReviewStep";
import { ContractCreationSigningModal } from "./ContractCreationSigningModal";
import { ContractCreationVoucherStep } from "./ContractCreationVoucherStep";

interface ContractCreationScreenProps {
  flow: ContractCreationFlow;
}

export function ContractCreationScreen({ flow }: ContractCreationScreenProps) {
  const steps = useMemo<WizardStep[]>(
    () => [
      { label: flow.steps[0].title, content: <ContractCreationClientStep flow={flow} /> },
      { label: flow.steps[1].title, content: <ContractCreationEmployeeStep flow={flow} /> },
      { label: flow.steps[2].title, content: <ContractCreationVoucherStep flow={flow} /> },
      { label: flow.steps[3].title, content: <ContractCreationReviewStep flow={flow} /> },
    ],
    [flow],
  );

  return (
    <Block name="mobile_contracts-new_screen_root" className="h-full min-h-0 overflow-hidden">
      <SteppedWizard
        title="계약서 생성"
        subtitle={flow.activeStepMeta.desc}
        steps={steps}
        currentStep={flow.activeStep}
        onStepChange={flow.actions.setActiveStep}
        onComplete={flow.actions.completeStep}
        onBack={flow.actions.goBack}
        backLabel="계약 목록"
        completeLabel={flow.state.isSubmitting ? "생성 중..." : "계약서 생성"}
        isSubmitting={flow.state.isSubmitting}
        isNextDisabled={!flow.state.isCurrentStepValid}
        className="h-full min-h-0"
        stepperProps={{ showDesktop: false }}
      />

      <HeadlessProgressModal
        open={flow.state.isProgressModalOpen}
        title="전자문서 생성 중"
        steps={CONTRACT_CREATION_PROGRESS_STEPS}
        progress={flow.state.creationProgress}
        errorHint={flow.state.progressErrorHint}
        dataComponentPrefix="mobile_contracts-new_progress_modal"
      />

      <MobileTwoButtonModal
        data-component="mobile_contracts-new_confirmation_modal"
        open={flow.state.isExistingContractConfirmOpen}
        title="계약서 재생성 확인"
        description="이전에 전송된 계약서가 있습니다. 그래도 새로 생성하시겠어요?"
        cancelLabel="취소"
        confirmLabel="생성"
        confirmVariant="default"
        actionOrder="cancel-confirm"
        loading={flow.state.isSubmitting}
        onOpenChange={flow.actions.setExistingContractConfirmOpen}
        onCancel={flow.actions.cancelExistingContractConfirm}
        onConfirm={flow.actions.confirmExistingContractSubmit}
      />

      <ContractCreationSigningModal
        open={flow.state.isEformsignModalOpen}
        onClose={flow.actions.closeSigningModal}
      />
    </Block>
  );
}
