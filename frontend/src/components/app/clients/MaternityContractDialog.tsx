"use client";

import { useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  APP_DIALOG_BODY_CLASS_NAME,
  APP_DIALOG_CLOSE_ICON_CLASS_NAME,
  APP_DIALOG_FLUSH_CONTENT_CLASS_NAME,
  APP_DIALOG_FOOTER_CLASS_NAME,
  APP_DIALOG_HEADER_CLASS_NAME,
  APP_DIALOG_HEADER_ROW_CLASS_NAME,
  APP_DIALOG_INLINE_CLOSE_BUTTON_CLASS_NAME,
  APP_DIALOG_TITLE_CLASS_NAME,
  APP_FORM_DIALOG_CONTENT_CLASS_NAME,
} from "@/components/ui/app-surface";
import { cn } from "@/lib/utils";
import {
  ContractCreationForm,
  CONTRACT_CREATION_STEPPER_STEPS,
} from "@/components/app/contracts/ContractCreationForm";
import { SteppedWizardStepper } from "@/components/app/v3/SteppedWizardStepper";
import { useFormStore } from "@/stores/form-store";
import type { Client } from "@/features/clients/types";

const SOURCE_COMPONENT = "MaternityContractDialog";
const BASE_DATA_COMPONENT = "desktop_clients_maternity-contract-dialog";

export interface MaternityContractDialogProps {
  open: boolean;
  onClose: () => void;
  client: Client;
  onSuccess?: () => void;
}

export function MaternityContractDialog({
  open,
  onClose,
  client,
  onSuccess,
}: MaternityContractDialogProps) {
  const [activeStep, setActiveStep] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasCreationSession, setHasCreationSession] = useState(false);
  const [processingFailed, setProcessingFailed] = useState(false);
  const isBusy = isSubmitting || (hasCreationSession && !processingFailed);

  // The wizard's own required-field/session state is meaningless once the dialog
  // is closed; reset the step so the next open (potentially for a different
  // client) always starts from step 0 rather than wherever this client left off.
  useEffect(() => {
    if (!open) {
      queueMicrotask(() => setActiveStep(0));
    }
  }, [open]);

  // The dialog is conditionally mounted by the clients page, so unmount always
  // means "closed" — clear the singleton form store so a stale client's data
  // can't leak into the next contract-creation flow.
  useEffect(() => {
    return () => {
      useFormStore.getState().resetAll();
    };
  }, []);

  const requestClose = useCallback(() => {
    if (isBusy) return;
    onClose();
  }, [isBusy, onClose]);

  const handleWizardSuccess = useCallback(() => {
    // A completed submission is the definitive "done" signal regardless of the
    // wizard's own lingering session/submitting state, so this always closes.
    onSuccess?.();
    onClose();
  }, [onSuccess, onClose]);

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) requestClose();
      }}
    >
      <DialogContent
        data-component={BASE_DATA_COMPONENT}
        data-source-component={SOURCE_COMPONENT}
        showCloseButton={false}
        onEscapeKeyDown={(event) => {
          if (isBusy) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (isBusy) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (isBusy) event.preventDefault();
        }}
        className={cn(APP_DIALOG_FLUSH_CONTENT_CLASS_NAME, APP_FORM_DIALOG_CONTENT_CLASS_NAME)}
      >
        <DialogHeader className={APP_DIALOG_HEADER_CLASS_NAME}>
          <div className={APP_DIALOG_HEADER_ROW_CLASS_NAME}>
            <DialogTitle className={APP_DIALOG_TITLE_CLASS_NAME}>
              산모 계약서 생성
            </DialogTitle>

            <DialogClose asChild>
              <button
                type="button"
                disabled={isBusy}
                data-component={`${BASE_DATA_COMPONENT}_close`}
                className={cn(
                  APP_DIALOG_INLINE_CLOSE_BUTTON_CLASS_NAME,
                  isBusy && "cursor-not-allowed opacity-50",
                )}
              >
                <X className={APP_DIALOG_CLOSE_ICON_CLASS_NAME} />
                <span className="sr-only">Close</span>
              </button>
            </DialogClose>
          </div>
          <DialogDescription className="sr-only">
            {client.name}님의 산모 계약서를 작성합니다.
          </DialogDescription>
        </DialogHeader>

        <ContractCreationForm
          key={`${client.id}-${open}`}
          initialClient={client}
          activeStep={activeStep}
          onActiveStepChange={setActiveStep}
          onClose={requestClose}
          onSuccess={handleWizardSuccess}
          onSubmissionStateChange={setIsSubmitting}
          onSessionStateChange={setHasCreationSession}
          onProcessingFailureChange={setProcessingFailed}
          contentClassName="h-auto flex-1"
          renderLayout={({ content, footer }) => (
            <>
              <div
                data-component={`${BASE_DATA_COMPONENT}_content`}
                className={cn(APP_DIALOG_BODY_CLASS_NAME, "flex flex-col gap-5 space-y-0")}
              >
                <SteppedWizardStepper
                  steps={CONTRACT_CREATION_STEPPER_STEPS}
                  currentStep={activeStep}
                  className="shrink-0"
                />
                {content}
              </div>

              <DialogFooter
                data-component={`${BASE_DATA_COMPONENT}_actions`}
                className={APP_DIALOG_FOOTER_CLASS_NAME}
              >
                {footer}
              </DialogFooter>
            </>
          )}
        />
      </DialogContent>
    </Dialog>
  );
}
