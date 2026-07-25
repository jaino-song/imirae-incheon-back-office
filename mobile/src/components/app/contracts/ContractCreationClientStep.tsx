"use client";

import { FileCheck, UserPlus } from "lucide-react";

import { Autocomplete } from "@/components/app/ui/Autocomplete";
import { FormSection } from "@/components/app/ui/form-section";
import { StatusBadge } from "@/components/app/ui/status-badge";
import { Block, InputField } from "@/components/app/v3";
import type { ContractCreationFlow, ContractCreationOption } from "@/hooks/contracts/useContractCreationFlow";
import type { Client } from "@/lib/client/types";
import { matchesKoreanSearch } from "@/lib/search/korean-search";

interface ContractCreationClientStepProps {
  flow: ContractCreationFlow;
}

export function ContractCreationClientStep({ flow }: ContractCreationClientStepProps) {
  const { form, actions } = flow;

  return (
    <Block name="mobile_contracts-new_client_step" className="space-y-4">
      <FormSection
        title="이용자 정보"
        badge={<StatusBadge variant="neutral">기존 고객 또는 직접 입력</StatusBadge>}
        data-component="mobile_contracts-new_client_details-section"
      >
        <Autocomplete<Client>
          name="contracts-new-client"
          data-component="mobile_contracts-new_client_autocomplete"
          inputId="contracts-new-client-name"
          value={flow.selectedClient}
          onChange={(client) => actions.selectClient(client?.id ?? null, client)}
          inputValue={form.name}
          onInputValueChange={actions.changeClientName}
          items={flow.clients}
          getItemKey={(client) => client.id}
          getItemLabel={(client) => client.name}
          getItemMeta={(client) => `${client.phone || "-"}${client.address ? ` · ${client.address}` : ""}`}
          getItemHeaderExtra={(client) =>
            client.hasSigned ? (
              <StatusBadge variant="doc_completed" size="sm">
                <FileCheck className="h-3 w-3" />
                서명완료
              </StatusBadge>
            ) : null
          }
          filter={(client, query) =>
            matchesKoreanSearch(client.name, query) ||
            (client.phone ? client.phone.includes(query) : false) ||
            (client.address ? client.address.toLowerCase().includes(query.toLowerCase()) : false)
          }
          placeholder="고객 이름 검색"
          label="이름"
          required
          emptyMessage="검색 결과가 없습니다."
          manualEntry={{
            label: "직접 입력으로 진행",
            description: "입력한 이름으로 새 계약을 작성합니다",
            icon: <UserPlus className="h-4 w-4" />,
            onSelect: actions.useManualClient,
          }}
        />
        <InputField
          title="연락처"
          inputProps={{
            id: "contracts-new-client-phone",
            value: form.phone,
            onChange: (event) => actions.changePhone(event.target.value),
            type: "tel",
            inputMode: "numeric",
            maxLength: 13,
            placeholder: "010-1234-5678",
            required: true,
          }}
        />
        <Block name="mobile_contracts-new_client_date-grid" className="grid grid-cols-2 gap-2.5">
          <InputField
            title="생년월일"
            inputProps={{
              id: "contracts-new-client-birthday",
              value: form.birthday,
              onChange: (event) => actions.changeBirthday(event.target.value),
              inputMode: "numeric",
              maxLength: 6,
              placeholder: "YYMMDD",
            }}
          />
          <InputField
            title="서비스 시작일"
            inputProps={{
              id: "contracts-new-client-start-date",
              value: form.startDateInput,
              onChange: (event) => actions.changeStartDate(event.target.value),
              inputMode: "numeric",
              maxLength: 6,
              placeholder: "YYMMDD",
            }}
          />
        </Block>
        <InputField
          title="주소"
          inputProps={{
            id: "contracts-new-client-address",
            value: form.address,
            onChange: (event) => actions.changeAddress(event.target.value),
            placeholder: "서울시 강남구...",
          }}
        />
      </FormSection>

      <FormSection title="계약서 유형" data-component="mobile_contracts-new_client_area-section">
        <Autocomplete<ContractCreationOption>
          name="contracts-new-area"
          data-component="mobile_contracts-new_client_area-autocomplete"
          inputId="contracts-new-area"
          value={flow.selectedAreaOption}
          onChange={actions.changeArea}
          items={flow.areaOptions}
          getItemKey={(option) => option.value}
          getItemLabel={(option) => option.label}
          placeholder="계약서 유형 선택"
          label="계약서 유형"
          required
          emptyMessage="선택 가능한 계약서가 없습니다."
        />
      </FormSection>
    </Block>
  );
}
