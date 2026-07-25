"use client";

import { X } from "lucide-react";

import { Block, HeaderActionButton } from "@/components/app/v3";

interface ContractCreationSigningModalProps {
  open: boolean;
  onClose: () => void;
}

export function ContractCreationSigningModal({ open, onClose }: ContractCreationSigningModalProps) {
  if (!open) return null;

  return (
    <Block
      name="mobile_contracts-new_signing_modal"
      className="fixed inset-0 z-[200] flex flex-col bg-v3-dim-white"
    >
      <Block
        name="mobile_contracts-new_signing_header"
        className="flex h-14 items-center justify-between border-b border-v3-border bg-white px-3.5"
      >
        <span className="text-base font-bold text-v3-dark">계약서 서명</span>
        <HeaderActionButton
          icon={X}
          label="닫기"
          onClick={onClose}
          variant="muted"
          data-component="mobile_contracts-new_signing_close-button"
        />
      </Block>
      <iframe
        id="eformsign_iframe"
        data-component="mobile_contracts-new_signing_iframe"
        className="min-h-0 flex-1 border-0 bg-white"
        title="eformsign"
      />
    </Block>
  );
}
