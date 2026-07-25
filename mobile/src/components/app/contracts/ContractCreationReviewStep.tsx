"use client";

import { FormSection } from "@/components/app/ui/form-section";
import { ToggleRow } from "@/components/app/ui/toggle-row";
import { Block, InfoCard, InfoRow, InputField } from "@/components/app/v3";
import type { ContractCreationFlow } from "@/hooks/contracts/useContractCreationFlow";

interface ContractCreationReviewStepProps {
  flow: ContractCreationFlow;
}

export function ContractCreationReviewStep({ flow }: ContractCreationReviewStepProps) {
  const { form, state, summary, actions } = flow;

  return (
    <Block name="mobile_contracts-new_review_step" className="space-y-4">
      <FormSection title="서비스 기간" data-component="mobile_contracts-new_review_period-section">
        <Block name="mobile_contracts-new_review_period-grid" className="grid grid-cols-2 gap-2.5">
          <InputField
            title="시작일"
            inputProps={{
              id: "contracts-new-review-start-date",
              value: form.startDateInput,
              onChange: (event) => actions.changeStartDate(event.target.value),
              inputMode: "numeric",
              maxLength: 6,
              placeholder: "YYMMDD",
              required: true,
            }}
          />
          <InputField
            title="종료일"
            inputProps={{
              id: "contracts-new-review-end-date",
              value: form.endDateInput,
              onChange: (event) => actions.changeEndDate(event.target.value),
              inputMode: "numeric",
              maxLength: 6,
              placeholder: "YYMMDD",
              required: true,
            }}
          />
        </Block>
        <InputField
          title="본인부담금 수령 날짜"
          message="시작일 + 바우처 기간으로 종료일이 자동 계산됩니다 (주말·공휴일 제외)."
          inputProps={{
            id: "contracts-new-review-payment-date",
            value: form.effectivePaymentDateInput,
            onChange: (event) => actions.changePaymentDate(event.target.value),
            inputMode: "numeric",
            maxLength: 6,
            placeholder: "YYMMDD",
            required: true,
          }}
        />
      </FormSection>

      <InfoCard data-component="mobile_contracts_detail-panel_info-card" title="최종 확인">
        <InfoRow label="고객" value={summary.clientName} />
        <InfoRow label="제공인력" value={summary.employeeName} />
        <InfoRow label="바우처" value={summary.voucherLabel} />
        <InfoRow label="기간" value={summary.periodLabel} />
        <InfoRow label="본인부담금" value={summary.actualPriceLabel} />
      </InfoCard>

      {state.shouldShowClientRegistrationToggle ? (
        <ToggleRow
          title="고객 정보 등록"
          description="새로운 고객으로 등록합니다."
          checked={state.shouldRegisterMissingClient}
          onClick={actions.toggleClientRegistration}
          data-component="mobile_contracts-new_review_client-registration-toggle"
        />
      ) : null}
    </Block>
  );
}
