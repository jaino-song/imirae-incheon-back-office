"use client";

import { useEffect, useRef, useState } from "react";

import { ClientAutocomplete } from "@/components/app/clients/ClientAutocomplete";
import { EmployeeAutocomplete } from "@/components/app/clients/EmployeeAutocomplete";
import { serviceRecordsApi } from "@/features/service-records/api/service-records.api";
import { useSystemTemplate } from "@/features/system-templates/hooks";
import type { Employee } from "@/hooks/useEmployees";
import { t } from "@/lib/i18n/translations";
import type { Client } from "@/lib/client/types";
import {
  isValidKoreanPhoneNumber,
  normalizeKoreanPhoneLookupKey,
} from "@/lib/phone";
import { useLocale } from "@/providers/LocaleProvider";
import { renderTemplate } from "@/lib/template-utils";
import { useFormStore } from "@/stores/form-store";
import { AutoFillMsgCard } from "../templates/AutoFillMsgCard";
import { ContactInput } from "./form-components/ContactInput";
import { TemplateFieldGridItem } from "./form-components/TemplateFieldGrid";
import {
  TemplateMessageFormFrame,
  type TemplateMessageFormLayout,
  type ServiceRecordLinkPreparation,
} from "./form-components/TemplateMessageFormLayout";

interface ServiceRecordLinkMessageFormProps {
  onPreviewMessageChange?: (message: string) => void;
  renderLayout?: TemplateMessageFormLayout;
  showMessageSide?: boolean;
}

const ALIGNED_AUTOCOMPLETE_CLASS_NAME =
  "grid gap-[calc(7px*var(--glint-ui-scale,1))] space-y-0";

interface PreparedServiceRecordLink extends ServiceRecordLinkPreparation {
  selectionKey: string;
}

export const ServiceRecordLinkMessageForm = ({
  onPreviewMessageChange,
  renderLayout,
  showMessageSide = true,
}: ServiceRecordLinkMessageFormProps) => {
  const locale = useLocale();
  const {
    clientId,
    name: clientName,
    employeeId,
    employeeName,
    employeePhone,
    setClientId,
    setName: setClientName,
    setEmployeeSelection,
    setIsEmployeeManualEntry,
    setEmployeePhone,
    resetEmployeeFields,
  } = useFormStore();
  const { data: systemTemplate } = useSystemTemplate("SERVICE_RECORD_LINK");
  const [preparedServiceRecordLink, setPreparedServiceRecordLink] = useState<PreparedServiceRecordLink | null>(null);
  const [preparationErrorKey, setPreparationErrorKey] = useState<string | null>(null);
  const inFlightPreparationRef = useRef<{
    selectionKey: string;
    promise: Promise<PreparedServiceRecordLink>;
  } | null>(null);

  const normalizedEmployeePhone = normalizeKoreanPhoneLookupKey(employeePhone);
  const canPrepareServiceRecordLink = clientId !== null
    && Boolean(clientName.trim())
    && employeeId !== null
    && Boolean(employeeName.trim())
    && isValidKoreanPhoneNumber(normalizedEmployeePhone);
  const selectionKey = canPrepareServiceRecordLink
    ? `${clientId}:${employeeId}:${normalizedEmployeePhone}`
    : null;
  const currentPreparation = preparedServiceRecordLink?.selectionKey === selectionKey
    ? preparedServiceRecordLink
    : null;

  useEffect(() => {
    if (selectionKey === null || clientId === null || employeeId === null) {
      return;
    }
    if (preparedServiceRecordLink?.selectionKey === selectionKey) {
      return;
    }

    let cancelled = false;

    const existingRequest = inFlightPreparationRef.current;
    const promise = existingRequest?.selectionKey === selectionKey
      ? existingRequest.promise
      : (async (): Promise<PreparedServiceRecordLink> => {
          const overviewResponse = await serviceRecordsApi.getClientOverview(clientId);
          const assignment = overviewResponse.data.assignments.find(
            (item) => !item.replaced && item.employee.id === employeeId,
          );
          if (!assignment) {
            throw new Error("Assignment not found");
          }

          const preparedResponse = await serviceRecordsApi.prepareLink(assignment.scheduleId, {
            recipientPhone: normalizedEmployeePhone,
          });
          return {
            scheduleId: assignment.scheduleId,
            ...preparedResponse.data,
            recipientPhone: normalizedEmployeePhone,
            selectionKey,
          };
        })();

    inFlightPreparationRef.current = { selectionKey, promise };
    void promise
      .then((prepared) => {
        if (!cancelled) {
          setPreparedServiceRecordLink(prepared);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPreparationErrorKey(selectionKey);
        }
      })
      .finally(() => {
        if (inFlightPreparationRef.current?.promise === promise) {
          inFlightPreparationRef.current = null;
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    clientId,
    employeeId,
    normalizedEmployeePhone,
    preparedServiceRecordLink?.selectionKey,
    selectionKey,
  ]);

  const resolvedEmployeeName = employeeName.trim() || "{{employeeName}}";
  const resolvedClientName = clientName.trim() || "{{clientName}}";
  const resolvedServiceRecordUrl = currentPreparation?.serviceRecordUrl ?? "{{serviceRecordUrl}}";
  const serviceRecordLinkDisplayValue = currentPreparation?.serviceRecordUrl
    ?? (selectionKey === null
      ? "필수 정보 입력 후 생성"
      : preparationErrorKey === selectionKey
        ? "배정 정보를 확인해 주세요."
        : "링크 준비 중…");
  const templateMessage = systemTemplate?.content
    ? renderTemplate(systemTemplate.content, {
        employeeName: resolvedEmployeeName,
        clientName: resolvedClientName,
        serviceRecordUrl: resolvedServiceRecordUrl,
      })
    : `[사회서비스 제공자 품질평가 A등급]
안녕하세요, 인천 아이미래로 입니다 :)

${resolvedEmployeeName} 관리사님, ${resolvedClientName} 산모님의 서비스 제공기록지 작성 링크입니다.
매일 서비스 제공 완료 직전에 서비스 세부사항 기록 후에, 산모님께 승인을 받으시면 됩니다.

최초 접속 시에 관리사님의 전화번호 인증이 필요합니다. 링크 접속 후 휴대폰 번호로 본인확인하고, 방문일마다 기록을 남겨주세요.

감사합니다.

제공기록지 링크
${resolvedServiceRecordUrl}`;
  const generatedMessage = templateMessage;

  useEffect(() => {
    onPreviewMessageChange?.(generatedMessage);
  }, [generatedMessage, onPreviewMessageChange]);

  const handleCopy = () => {
    return navigator.clipboard.writeText(generatedMessage);
  };

  const invalidatePreparedServiceRecordLink = () => {
    setPreparedServiceRecordLink(null);
    setPreparationErrorKey(null);
  };

  const handleEmployeeChange = (
    nextEmployeeId: number | null,
    employee: Employee | null,
  ) => {
    invalidatePreparedServiceRecordLink();
    if (!employee || nextEmployeeId === null) {
      resetEmployeeFields();
      return;
    }

    setEmployeeSelection(nextEmployeeId, employee.name, employee.phone);
    setIsEmployeeManualEntry(false);
  };

  const handleEmployeeManualNameChange = (value: string) => {
    invalidatePreparedServiceRecordLink();
    const nextName = value.trimStart();
    if (!nextName.trim()) {
      resetEmployeeFields();
      return;
    }

    setEmployeeSelection(null, nextName, employeePhone);
    setIsEmployeeManualEntry(true);
  };

  const handleClientChange = (
    nextClientId: number | null,
    client: Client | null,
  ) => {
    invalidatePreparedServiceRecordLink();
    if (!client || nextClientId === null) {
      setClientId(null);
      return;
    }

    setClientId(nextClientId);
    setClientName(client.name);
  };

  const handleClientManualNameChange = (value: string) => {
    invalidatePreparedServiceRecordLink();
    setClientId(null);
    setClientName(value);
  };

  const handleEmployeePhoneChange = (value: string) => {
    invalidatePreparedServiceRecordLink();
    setEmployeePhone(value);
  };

  const fields = (
    <>
      <TemplateFieldGridItem dataComponent="desktop_messages_sections_service-feedback-link-employee-name-field">
        <EmployeeAutocomplete
          data-component="desktop_messages_sections_service-feedback-link-employee-name-field_autocomplete"
          containerClassName={ALIGNED_AUTOCOMPLETE_CLASS_NAME}
          value={employeeId}
          onChange={handleEmployeeChange}
          label="관리사님 성함"
          placeholder="새로 입력 또는 기존 직원 선택"
          allowManualInput
          manualValue={employeeName}
          onManualInputChange={handleEmployeeManualNameChange}
          required
        />
      </TemplateFieldGridItem>
      <TemplateFieldGridItem dataComponent="desktop_messages_sections_service-feedback-link-employee-phone-field">
        <ContactInput
          phone={employeePhone}
          setPhone={handleEmployeePhoneChange}
          label="관리사님 전화번호"
          placeholder="010-0000-0000"
          required
          dataComponent="desktop_messages_sections_service-feedback-link-employee-phone-input"
        />
      </TemplateFieldGridItem>
      <TemplateFieldGridItem dataComponent="desktop_messages_sections_service-feedback-link-client-name-field">
        <ClientAutocomplete
          data-component="desktop_messages_sections_service-feedback-link-client-name-field_autocomplete"
          containerClassName={ALIGNED_AUTOCOMPLETE_CLASS_NAME}
          value={clientId}
          onChange={handleClientChange}
          label="산모님 성함"
          placeholder="새로 입력 또는 기존 고객 선택"
          manualValue={clientName}
          onManualValueChange={handleClientManualNameChange}
          required
        />
      </TemplateFieldGridItem>
    </>
  );

  const messageCard = (
    <AutoFillMsgCard
      title={t(locale, "common.generated-message-title")}
      copyButtonText={t(locale, "common.copy-button")}
      copySuccessMessage={t(locale, "common.copy-success-message")}
      message={generatedMessage}
      bodyDescription={systemTemplate?.description || "제공기록지 작성 링크 문구를 수정할 수 있어요."}
      metaItems={[
        { label: "템플릿 유형", value: "제공기록지 작성 링크" },
        { label: "관리사님 성함", value: employeeName.trim() || "-" },
        { label: "관리사님 전화번호", value: employeePhone.trim() || "-" },
        { label: "산모님 성함", value: clientName.trim() || "-" },
        { label: "제공기록지 링크", value: serviceRecordLinkDisplayValue },
      ]}
      variableItems={[
        { token: "{{employeeName}}", label: "관리사님 성함", value: employeeName.trim() || "-" },
        { token: "{{clientName}}", label: "산모님 성함", value: clientName.trim() || "-" },
        { token: "{{serviceRecordUrl}}", label: "제공기록지 링크", value: serviceRecordLinkDisplayValue },
      ]}
      handleCopy={handleCopy}
      showSide={showMessageSide}
    />
  );

  return (
    <TemplateMessageFormFrame
      dataComponent="desktop_messages_sections_service-feedback-link-form"
      fields={fields}
      fieldsLayout="stack"
      messageCard={messageCard}
      deliveryMode="service-feedback-link"
      serviceRecordLinkPreparation={currentPreparation}
      renderLayout={renderLayout}
    />
  );
};
