"use client";

import { useState, type ComponentProps } from "react";

import { ClientAutocomplete } from "@/components/app/clients/ClientAutocomplete";
import { TwoButtonModal } from "@/components/app/ui/TwoButtonModal";
import type { Client, DocumentStatus } from "@/lib/client/types";

type ContractClientSelectorProps = Omit<
  ComponentProps<typeof ClientAutocomplete>,
  "onChange"
> & {
  onChange: (clientId: number | null, client: Client | null) => void;
};

interface PendingClientSelection {
  clientId: number;
  client: Client;
}

export function hasExistingContractDocument(client: Client): boolean {
  return Boolean(client.eDocId || client.documentStatus);
}

const ACTIVE_DOCUMENT_STATUSES: readonly DocumentStatus[] = ["created", "requested", "opened", "completed"];

// 반려/취소/삭제된 문서는 새 계약서 생성을 막지 않는다. documentStatus 없이
// eDocId만 남은 레거시 문서는 살아 있을 수 있으므로 보수적으로 막는다.
export function canCreateNewContractDocument(client: Client): boolean {
  if (client.documentStatus) return !ACTIVE_DOCUMENT_STATUSES.includes(client.documentStatus);
  return !client.eDocId;
}

export function ContractClientSelector({
  onChange,
  ...autocompleteProps
}: ContractClientSelectorProps) {
  const [pendingSelection, setPendingSelection] =
    useState<PendingClientSelection | null>(null);

  const handleChange = (clientId: number | null, client: Client | null) => {
    if (clientId !== null && client && hasExistingContractDocument(client)) {
      setPendingSelection({ clientId, client });
      return;
    }

    onChange(clientId, client);
  };

  const handleContinue = () => {
    if (!pendingSelection) return;

    const selection = pendingSelection;
    setPendingSelection(null);
    onChange(selection.clientId, selection.client);
  };

  return (
    <>
      <ClientAutocomplete {...autocompleteProps} onChange={handleChange} />

      <TwoButtonModal
        open={pendingSelection !== null}
        onOpenChange={(open) => {
          if (!open) setPendingSelection(null);
        }}
        dataComponent="desktop_contracts_existing-document-confirmation"
        titleAriaLabel="이미 계약서를 전송한 기록이 있습니다. 새로 생성하시겠어요?"
        title={(
          <>
            <span className="block">이미 계약서를 전송한 기록이 있습니다.</span>
            <span className="block">새로 생성하시겠어요?</span>
          </>
        )}
        description="계속하면 선택한 고객 정보로 새 계약서 작성을 진행합니다."
        approvalLabel="계속"
        onApprove={handleContinue}
      />
    </>
  );
}
