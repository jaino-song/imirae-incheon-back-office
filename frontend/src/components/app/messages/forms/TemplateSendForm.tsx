"use client";

import { isAxiosError } from "axios";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Calendar, Loader2, Send, X } from "lucide-react";

import { ClientAutocomplete } from "@/components/app/clients/ClientAutocomplete";
import { TwoButtonModal } from "@/components/app/ui/TwoButtonModal";
import { StatusBadge } from "@/components/app/ui/status-badge";
import { Button } from "@/components/ui/button";
import { filterHistoryRecordsByChannel } from "@/features/message-triggers/channel";
import { messageTriggerKeys } from "@/features/message-triggers/hooks/keys";
import { useMessageHistory } from "@/features/message-triggers/hooks/use-message-triggers";
import type { MessageLogRecord } from "@/features/message-triggers/types";
import { serviceRecordsApi } from "@/features/service-records/api/service-records.api";
import { useToast } from "@/hooks/use-toast";
import { messageDeliveryApi } from "@/services/api";
import type { Client } from "@/lib/client/types";
import {
  formatKoreanPhoneNumber,
  isValidKoreanPhoneNumber,
  normalizeKoreanPhoneLookupKey,
} from "@/lib/phone";
import { cn } from "@/lib/utils";
import { useFormStore } from "@/stores/form-store";
import { ContactInput } from "./form-components/ContactInput";
import { TemplateFieldGrid, TemplateFieldGridItem } from "./form-components/TemplateFieldGrid";
import type {
  ServiceRecordLinkPreparation,
  TemplateMessageDeliveryMode,
} from "./form-components/TemplateMessageFormLayout";

const SMS_BYTE_LIMIT = 90;
const MAX_LMS_TITLE_BYTES = 44;
const MAX_BODY_LENGTH = 2000;
const DEFAULT_LMS_TITLE = "안내";
const DUPLICATE_SEND_WINDOW_HOURS = 72;
const DUPLICATE_SEND_WINDOW_MS = DUPLICATE_SEND_WINDOW_HOURS * 60 * 60 * 1000;

type ServiceRecordLinkFailureStage = "assignment" | "send";

const SERVICE_RECORD_LINK_ERROR_MESSAGES: Record<string, string> = {
  "Assignment not found": "선택한 관리사님과 산모님의 배정 일정을 찾지 못해 제공기록지 링크를 발송하지 못했습니다.",
  "제공인력 전화번호가 없습니다": "선택한 관리사님의 전화번호가 없어 제공기록지 링크를 발송하지 못했습니다.",
  "준비된 제공기록지 링크가 만료되었거나 유효하지 않습니다": "제공기록지 링크가 만료되었습니다. 입력 정보를 다시 선택해 새 링크를 준비해 주세요.",
};

export interface TemplateSendFormSubmitState {
  formId: string;
  isSending: boolean;
  isSubmitDisabled: boolean;
}

interface RecipientQueueItem {
  id: string;
  clientId: number | null;
  name: string;
  phone: string;
  formattedPhone: string;
  message: string;
}

interface DuplicateSendMatch {
  recipient: RecipientQueueItem;
  record: MessageLogRecord;
}

interface TemplateSendFormProps {
  templateId: string;
  templateName: string;
  message: string;
  requiresRecipientName?: boolean;
  deliveryMode?: TemplateMessageDeliveryMode;
  children?: ReactNode;
  className?: string;
  formId?: string;
  showSubmitButton?: boolean;
  serviceRecordLinkPreparation?: ServiceRecordLinkPreparation | null;
  onSubmitStateChange?: (state: TemplateSendFormSubmitState | null) => void;
}

function getTextByteLength(text: string) {
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(text).length;
  }

  return Array.from(text).reduce((size, char) => {
    const codePoint = char.codePointAt(0) ?? 0;
    if (codePoint <= 0x7f) return size + 1;
    if (codePoint <= 0x7ff) return size + 2;
    if (codePoint <= 0xffff) return size + 3;
    return size + 4;
  }, 0);
}

function getLmsTitle(templateName: string) {
  return getTextByteLength(templateName) <= MAX_LMS_TITLE_BYTES ? templateName : DEFAULT_LMS_TITLE;
}

function getClientDurationInDays(client: Client) {
  if (client.duration == null) return "";
  return String(client.duration);
}

function usesInlinePhoneRecipientLayout(templateId: string) {
  return templateId === "builtin:greeting" || templateId === "builtin:info";
}

function normalizeDuplicateMessage(message: string) {
  return message.replace(/\r\n/g, "\n").trim();
}

function getServiceRecordLinkErrorMessage(
  error: unknown,
  failureStage: ServiceRecordLinkFailureStage,
): string {
  const stageFallback = failureStage === "assignment"
    ? "산모님의 배정 정보를 불러오지 못해 제공기록지 링크를 발송하지 못했습니다."
    : "서버가 제공기록지 링크 발송 요청을 처리하지 못했으니 잠시 후 다시 시도해 주세요.";

  if (!isAxiosError<{ message?: unknown; error?: unknown }>(error)) return stageFallback;
  if (!error.response) {
    return "서버에 연결하지 못해 제공기록지 링크를 발송하지 못했습니다.";
  }

  const payload = error.response.data;
  const apiMessage = payload && typeof payload === "object"
    ? payload.message ?? payload.error
    : null;
  if (typeof apiMessage === "string") {
    const knownMessage = SERVICE_RECORD_LINK_ERROR_MESSAGES[apiMessage.trim()];
    if (knownMessage) return knownMessage;
  }

  if (error.response.status === 401) {
    return "로그인이 만료되어 제공기록지 링크를 발송하지 못했습니다.";
  }
  if (error.response.status === 403) {
    return "선택한 배정 일정을 처리할 권한이 없어 제공기록지 링크를 발송하지 못했습니다.";
  }
  if (error.response.status === 404) {
    return "선택한 관리사님과 산모님의 배정 일정을 찾지 못해 제공기록지 링크를 발송하지 못했습니다.";
  }

  return stageFallback;
}

function getHistoryTimestamp(record: MessageLogRecord) {
  return record.lastAttemptAt ?? record.updatedAt ?? record.createdAt;
}

export function formatDuplicateSentAt(dateString: string) {
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return "-";

  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const period = date.getHours() < 12 ? "오전" : "오후";
  const hour = date.getHours() % 12 || 12;
  const minute = String(date.getMinutes()).padStart(2, "0");

  return `${month}. ${day} ${period} ${hour}:${minute}`;
}

export function findRecentDuplicateSend(
  history: MessageLogRecord[],
  params: {
    receiver: string;
    message: string;
    now?: Date;
  },
) {
  const receiver = normalizeKoreanPhoneLookupKey(params.receiver);
  const message = normalizeDuplicateMessage(params.message);
  if (!receiver || !message) return null;

  const now = params.now ?? new Date();
  const threshold = now.getTime() - DUPLICATE_SEND_WINDOW_MS;

  return history
    .filter((record) => {
      if (record.status !== "sent") return false;
      if (normalizeKoreanPhoneLookupKey(record.recipientPhone ?? record.receiver) !== receiver) return false;
      if (normalizeDuplicateMessage(record.messageBody) !== message) return false;

      const sentAt = new Date(getHistoryTimestamp(record));
      return !Number.isNaN(sentAt.getTime()) && sentAt.getTime() >= threshold;
    })
    .sort((left, right) => {
      return new Date(getHistoryTimestamp(right)).getTime() - new Date(getHistoryTimestamp(left)).getTime();
    })[0] ?? null;
}

export function TemplateSendForm({
  templateId,
  templateName,
  message,
  requiresRecipientName = false,
  deliveryMode = "sms",
  children,
  className,
  formId,
  showSubmitButton = true,
  serviceRecordLinkPreparation,
  onSubmitStateChange,
}: TemplateSendFormProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [selectedClientId, setSelectedClientId] = useState<number | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [isCheckingDuplicate, setIsCheckingDuplicate] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: "success" | "error"; message: string } | null>(null);
  const [duplicateSendCandidates, setDuplicateSendCandidates] = useState<DuplicateSendMatch[] | null>(null);
  const [recipientQueue, setRecipientQueue] = useState<RecipientQueueItem[]>([]);
  const { data: historyData = [], refetch: refetchHistory } = useMessageHistory();
  const {
    clientId,
    name,
    phone,
    employeeId,
    employeeName,
    employeePhone,
    voucherType,
    voucherDuration,
    voucherYear,
    area,
    setActualPrice,
    setAddress,
    setArea,
    setBirthday,
    setClientId,
    setDueDate,
    setEndDate,
    setFullPrice,
    setGrant,
    setName,
    setPhone,
    setStartDate,
    setVoucherDuration,
    setVoucherType,
    resetClientFields,
    resetEmployeeFields,
  } = useFormStore();

  const isServiceRecordLinkDelivery = deliveryMode === "service-feedback-link";
  const recipientPhone = useMemo(
    () => normalizeKoreanPhoneLookupKey(phone),
    [phone],
  );
  const smsHistoryData = useMemo(
    () => filterHistoryRecordsByChannel(historyData, "sms"),
    [historyData],
  );
  const formattedRecipientPhone = recipientPhone ? formatKoreanPhoneNumber(recipientPhone) : "";
  const normalizedEmployeePhone = normalizeKoreanPhoneLookupKey(employeePhone);
  const recipientName = name.trim();
  const trimmedMessage = message.trim();
  const isBodyTooLong = trimmedMessage.length > MAX_BODY_LENGTH;
  const isRecipientValid = recipientPhone ? isValidKoreanPhoneNumber(recipientPhone) : false;
  const shouldUseInlinePhoneRecipient = !requiresRecipientName && usesInlinePhoneRecipientLayout(templateId);
  const shouldShowRecipientNameInPill = requiresRecipientName || shouldUseInlinePhoneRecipient;
  const requiresPriceInfoFields = templateId === "builtin:price-info";
  const recipientValidationMessage = requiresRecipientName && !recipientName
    ? "산모님 성함을 입력하거나 기존 고객을 선택해 주세요."
    : !recipientPhone
      ? "휴대 전화번호를 입력해 주세요."
    : !isRecipientValid
      ? "휴대 전화번호 형식이 올바르지 않습니다."
      : null;
  const templateFieldValidationMessage = requiresPriceInfoFields && !voucherType
    ? "바우처 유형을 선택해 주세요."
    : requiresPriceInfoFields && !voucherDuration
      ? "서비스 기간을 선택해 주세요."
      : requiresPriceInfoFields && !area
        ? "지역을 선택해 주세요."
        : requiresPriceInfoFields && !voucherYear
          ? "바우처 연도를 선택해 주세요."
          : null;
  const serviceRecordValidationMessage = employeeId === null || !employeeName.trim()
    ? "관리사님을 선택해 주세요."
    : !normalizedEmployeePhone
      ? "관리사님 전화번호를 선택해 주세요."
      : !isValidKoreanPhoneNumber(normalizedEmployeePhone)
        ? "관리사님 전화번호 형식이 올바르지 않습니다."
        : clientId === null
          ? "산모님을 선택해 주세요."
          : null;
  const messageValidationMessage = !trimmedMessage
    ? "메시지 본문을 입력해 주세요."
    : isBodyTooLong
      ? `본문은 최대 ${MAX_BODY_LENGTH}자까지 입력할 수 있습니다.`
      : null;
  const currentQueueItem = useMemo<RecipientQueueItem | null>(() => {
    if (isServiceRecordLinkDelivery) return null;

    if (recipientValidationMessage || templateFieldValidationMessage || messageValidationMessage) {
      return null;
    }

    return {
      id: recipientPhone,
      clientId: selectedClientId,
      name: recipientName,
      phone: recipientPhone,
      formattedPhone: formattedRecipientPhone,
      message: trimmedMessage,
    };
  }, [
    formattedRecipientPhone,
    isServiceRecordLinkDelivery,
    messageValidationMessage,
    recipientName,
    recipientPhone,
    recipientValidationMessage,
    selectedClientId,
    templateFieldValidationMessage,
    trimmedMessage,
  ]);
  const hasQueuedRecipients = recipientQueue.length > 0;
  const validationMessage = isServiceRecordLinkDelivery
    ? serviceRecordValidationMessage
    : hasQueuedRecipients
      ? null
      : recipientValidationMessage ?? templateFieldValidationMessage ?? messageValidationMessage;
  const isSubmitDisabled = Boolean(validationMessage)
    || (isServiceRecordLinkDelivery && !serviceRecordLinkPreparation)
    || isSending
    || isCheckingDuplicate;
  const resolvedFormId = formId ?? `messages-template-send-form-${templateId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;

  useEffect(() => {
    if (!currentQueueItem) return;

    setRecipientQueue((currentQueue) => {
      const existingIndex = currentQueue.findIndex((item) => item.phone === currentQueueItem.phone);

      if (existingIndex === -1) {
        return [...currentQueue, currentQueueItem];
      }

      // For requiresRecipientName templates, update the queued entry in place so
      // a name correction always propagates (instead of being silently dropped).
      // For phone-only templates, the phone is the full identity — skip as before.
      if (requiresRecipientName) {
        const updated = [...currentQueue];
        updated[existingIndex] = currentQueueItem;
        return updated;
      }

      return currentQueue;
    });
  }, [currentQueueItem, requiresRecipientName]);

  useEffect(() => {
    onSubmitStateChange?.({
      formId: resolvedFormId,
      isSending,
      isSubmitDisabled,
    });
  }, [isSending, isSubmitDisabled, onSubmitStateChange, resolvedFormId]);

  const syncClientToTemplateForm = (client: Client) => {
    setClientId(client.id);
    setName(client.name);
    setPhone(client.phone ?? "");
    setBirthday(client.birthday ?? "");
    setDueDate(client.dueDate ?? "");
    setAddress(client.address ?? "");
    setStartDate(client.startDate ?? "");
    setEndDate(client.endDate ?? "");
    setFullPrice(client.fullPrice ?? "");
    setGrant(client.grant ?? "");
    setActualPrice(client.actualPrice ?? "");
    setVoucherType(client.type ?? "");
    setVoucherDuration(getClientDurationInDays(client));
    setArea(client.areaId ?? "");
  };

  const handleRecipientChange = (clientId: number | null, client: Client | null) => {
    setSelectedClientId(clientId);
    setFeedback(null);

    if (!client) {
      setClientId(null);
      return;
    }

    syncClientToTemplateForm(client);
  };

  const handleManualRecipientNameChange = (value: string) => {
    setSelectedClientId(null);
    setClientId(null);
    setName(value);
    setFeedback(null);
  };

  const handlePhoneChange = (value: string) => {
    setSelectedClientId(null);
    setClientId(null);
    setPhone(value);
    if (!requiresRecipientName) {
      setName("");
    }
    setFeedback(null);
  };

  const handleClearRecipient = ({ clearFeedback = true }: { clearFeedback?: boolean } = {}) => {
    setSelectedClientId(null);
    setClientId(null);
    setName("");
    setPhone("");
    if (clearFeedback) {
      setFeedback(null);
    }
  };

  const handleRemoveQueuedRecipient = (itemToRemove: RecipientQueueItem) => {
    setRecipientQueue((currentQueue) => currentQueue.filter((item) => item.id !== itemToRemove.id));

    if (itemToRemove.phone === recipientPhone) {
      handleClearRecipient();
    }
  };

  const recipientPills = recipientQueue.length > 0 ? (
    <div
      data-component="desktop_messages_sections_template-send-form-recipient-queue"
      className="flex flex-wrap gap-2"
    >
      {recipientQueue.map((item) => (
        <StatusBadge
          key={item.id}
          data-component="desktop_messages_sections_template-send-form-recipient"
          variant="primary"
          size="sm"
          className="w-fit max-w-none justify-start"
        >
          <span className="min-w-0 truncate">
            {shouldShowRecipientNameInPill && item.name
              ? `${item.name} · ${item.formattedPhone}`
              : item.formattedPhone}
          </span>
          <button
            type="button"
            className="flex h-[calc(12px*var(--glint-ui-scale,1))] w-[calc(12px*var(--glint-ui-scale,1))] shrink-0 items-center justify-center rounded-full text-v3-primary/70 transition-colors hover:text-v3-primary"
            aria-label="수신자 제거"
            onClick={() => handleRemoveQueuedRecipient(item)}
          >
            <X aria-hidden="true" />
          </button>
        </StatusBadge>
      ))}
    </div>
  ) : null;

  const phoneAutocompleteField = (
    <ClientAutocomplete
      value={selectedClientId}
      onChange={handleRecipientChange}
      label="휴대 전화번호"
      required
      placeholder="연락처 검색 또는 직접 입력"
      manualValue={phone}
      onManualValueChange={handlePhoneChange}
      displayValueMode="phone"
      searchMode="phone"
    />
  );

  const getRecipientsForSubmit = () => {
    if (recipientQueue.length > 0) {
      if (currentQueueItem && !recipientQueue.some((item) => item.phone === currentQueueItem.phone)) {
        return [...recipientQueue, currentQueueItem];
      }

      return recipientQueue;
    }

    if (currentQueueItem) return [currentQueueItem];

    return [];
  };

  const sendMessages = async (recipients: RecipientQueueItem[]) => {
    if (recipients.length === 0 || validationMessage) {
      setFeedback({ tone: "error", message: validationMessage ?? "발송할 수신자 정보를 입력해 주세요." });
      return;
    }

    setIsSending(true);
    setFeedback(null);
    setDuplicateSendCandidates(null);

    const settled = await Promise.allSettled(
      recipients.map((recipient) => (
        messageDeliveryApi.sendSms({
          receiver: recipient.formattedPhone,
          message: recipient.message,
          msgType: "AUTO",
          triggerType: "immediate",
          ...(recipient.clientId ? { clientId: recipient.clientId } : {}),
          ...(requiresRecipientName && recipient.name ? { recipientName: recipient.name } : {}),
          ...(getTextByteLength(recipient.message) > SMS_BYTE_LIMIT ? { title: getLmsTitle(templateName) } : {}),
        })
      )),
    );

    const succeededRecipients: RecipientQueueItem[] = [];
    const failedRecipients: RecipientQueueItem[] = [];

    settled.forEach((result, index) => {
      const recipient = recipients[index];
      if (
        result.status === "fulfilled" &&
        result.value.result.resultCode === 1 &&
        (result.value.result.errorCount ?? 0) === 0
      ) {
        succeededRecipients.push(recipient);
      } else {
        failedRecipients.push(recipient);
      }
    });

    setIsSending(false);

    if (failedRecipients.length === 0) {
      // All succeeded — existing happy path.
      setFeedback({ tone: "success", message: `${recipients.length}건의 메시지 발송 요청이 접수되었습니다.` });
      setRecipientQueue([]);
      handleClearRecipient({ clearFeedback: false });
    } else {
      // Remove only the successfully-sent recipients so a retry re-sends only failures.
      const succeededPhones = new Set(succeededRecipients.map((r) => r.phone));
      setRecipientQueue((currentQueue) =>
        currentQueue.filter((item) => !succeededPhones.has(item.phone)),
      );

      if (succeededRecipients.length === 0) {
        setFeedback({ tone: "error", message: `${failedRecipients.length}건 발송에 실패했습니다.` });
      } else {
        setFeedback({
          tone: "error",
          message: `${succeededRecipients.length}건 발송 완료, ${failedRecipients.length}건 실패. 실패한 수신자에게 재발송해 주세요.`,
        });
      }
    }
  };

  const findDuplicateBeforeSend = async (recipients: RecipientQueueItem[]): Promise<DuplicateSendMatch[]> => {
    setIsCheckingDuplicate(true);
    try {
      const result = await refetchHistory();
      const latestHistory = filterHistoryRecordsByChannel(result.data ?? historyData, "sms");

      const matches: DuplicateSendMatch[] = [];
      for (const recipient of recipients) {
        const record = findRecentDuplicateSend(latestHistory, {
          receiver: recipient.formattedPhone,
          message: recipient.message,
        });
        if (record) matches.push({ recipient, record });
      }
      return matches;
    } catch {
      const matches: DuplicateSendMatch[] = [];
      for (const recipient of recipients) {
        const record = findRecentDuplicateSend(smsHistoryData, {
          receiver: recipient.formattedPhone,
          message: recipient.message,
        });
        if (record) matches.push({ recipient, record });
      }
      return matches;
    } finally {
      setIsCheckingDuplicate(false);
    }
  };

  const sendServiceRecordLink = async () => {
    if (clientId === null || employeeId === null || !serviceRecordLinkPreparation) {
      const errorMessage =
        serviceRecordValidationMessage ??
        "제공기록지 링크를 준비하고 있습니다. 잠시 후 다시 시도해 주세요.";
      setFeedback({ tone: "error", message: errorMessage });
      toast({ variant: "destructive", description: errorMessage });
      return;
    }

    setIsSending(true);
    setFeedback(null);
    const failureStage: ServiceRecordLinkFailureStage = "send";

    try {
      const response = await serviceRecordsApi.sendLink(serviceRecordLinkPreparation.scheduleId, {
        preparedLinkToken: serviceRecordLinkPreparation.preparedLinkToken,
        recipientPhone: serviceRecordLinkPreparation.recipientPhone,
      });
      const { status } = response.data;

      if (status === "sent") {
        setFeedback({ tone: "success", message: "제공기록지 링크 즉시 발송이 완료되었습니다." });
        toast({ description: "제공기록지 링크 즉시 발송이 완료되었습니다." });
        resetEmployeeFields();
        resetClientFields();
      } else if (status === "processing") {
        setFeedback({ tone: "success", message: "제공기록지 링크를 발송하고 있습니다." });
        toast({ description: "제공기록지 링크를 발송하고 있습니다." });
      } else {
        const errorMessage =
          status === "pending"
            ? "즉시 발송에 실패해 재시도 대기열에 등록되었습니다."
            : "제공기록지 링크 즉시 발송에 실패했습니다.";
        setFeedback({ tone: "error", message: errorMessage });
        toast({ variant: "destructive", description: errorMessage });
      }
    } catch (error) {
      const errorMessage = getServiceRecordLinkErrorMessage(error, failureStage);
      setFeedback({ tone: "error", message: errorMessage });
      toast({ variant: "destructive", description: errorMessage });
    } finally {
      void queryClient.invalidateQueries({ queryKey: messageTriggerKeys.upcoming() });
      void queryClient.invalidateQueries({ queryKey: messageTriggerKeys.history() });
      setIsSending(false);
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (validationMessage) {
      setFeedback({ tone: "error", message: validationMessage });
      if (isServiceRecordLinkDelivery) {
        toast({ variant: "destructive", description: validationMessage });
      }
      return;
    }

    if (isServiceRecordLinkDelivery) {
      await sendServiceRecordLink();
      return;
    }

    const recipients = getRecipientsForSubmit();
    if (recipients.length === 0) {
      setFeedback({ tone: "error", message: "발송할 수신자 정보를 입력해 주세요." });
      return;
    }

    const duplicates = await findDuplicateBeforeSend(recipients);
    if (duplicates.length > 0) {
      setFeedback(null);
      setDuplicateSendCandidates(duplicates);
      return;
    }

    await sendMessages(recipients);
  };

  const handleConfirmDuplicateSend = async () => {
    await sendMessages(getRecipientsForSubmit());
  };

  return (
    <form
      id={resolvedFormId}
      data-component="desktop_messages_sections_template-send-form"
      data-template-id={templateId}
      className={cn("flex min-h-0 flex-col gap-4 rounded-[20px] bg-v3-dim-white p-5", className)}
      onSubmit={handleSubmit}
    >
      <div data-component="desktop_messages_sections_template-send-form-header" className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-[calc(14.4px*var(--glint-ui-scale,1))] font-bold text-v3-dark">전송 정보</h3>
          <p className="mt-0.5 text-[calc(12px*var(--glint-ui-scale,1))] text-v3-text-muted">
            메시지 전송에 필요한 정보를 입력해 주세요.
          </p>
        </div>
        {showSubmitButton ? (
          <Button
            type="submit"
            disabled={isSubmitDisabled}
            className="shrink-0"
          >
            {isSending || isCheckingDuplicate ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="h-4 w-4" aria-hidden="true" />
            )}
            {isSending ? "발송 중…" : isCheckingDuplicate ? "확인 중…" : "즉시 발송"}
          </Button>
        ) : null}
      </div>

      {isServiceRecordLinkDelivery ? (
        children ? <TemplateFieldGrid layout="stack">{children}</TemplateFieldGrid> : null
      ) : shouldUseInlinePhoneRecipient ? (
        <>
          <div
            data-component="desktop_messages_sections_template-send-form-phone-field"
            className="min-w-0 w-full"
          >
            {templateId === "builtin:greeting" ? (
              <ContactInput
                phone={phone}
                setPhone={handlePhoneChange}
                label="휴대 전화번호"
                placeholder="010-0000-0000"
                required
              />
            ) : phoneAutocompleteField}
          </div>
          {children ? <TemplateFieldGrid layout="stack">{children}</TemplateFieldGrid> : null}
        </>
      ) : (
        <TemplateFieldGrid layout="stack">
          {requiresRecipientName ? (
            <>
              <TemplateFieldGridItem dataComponent="desktop_messages_sections_template-send-form-recipient-field">
                <ClientAutocomplete
                  value={selectedClientId}
                  onChange={handleRecipientChange}
                  label="산모님 성함"
                  required
                  placeholder="새로 입력 또는 기존 고객 선택"
                  manualValue={name}
                  onManualValueChange={handleManualRecipientNameChange}
                />
              </TemplateFieldGridItem>

              <TemplateFieldGridItem dataComponent="desktop_messages_sections_template-send-form-phone-field">
                <ContactInput
                  phone={phone}
                  setPhone={handlePhoneChange}
                  label="휴대 전화번호"
                  placeholder="010-0000-0000"
                  required
                />
              </TemplateFieldGridItem>
            </>
          ) : (
            <TemplateFieldGridItem dataComponent="desktop_messages_sections_template-send-form-phone-field">
              {phoneAutocompleteField}
            </TemplateFieldGridItem>
          )}

          {children}
        </TemplateFieldGrid>
      )}

      {isServiceRecordLinkDelivery ? null : recipientPills}

      {feedback ? (
        <div
          data-component="desktop_messages_sections_template-send-form-feedback"
          className={cn(
            "mt-4 rounded-[14px] px-4 py-3 text-[calc(12.48px*var(--glint-ui-scale,1))] font-semibold",
            feedback.tone === "success"
              ? "bg-v3-primary-light text-v3-primary"
              : "bg-v3-burgundy-light text-v3-burgundy",
          )}
          role="status"
        >
          {feedback.message}
        </div>
      ) : null}

      <TwoButtonModal
        open={Boolean(duplicateSendCandidates && duplicateSendCandidates.length > 0)}
        size="detail"
        onOpenChange={(open) => {
          if (!open) {
            setDuplicateSendCandidates(null);
          }
        }}
        dataComponent="desktop_messages_sections_duplicate-send-confirm-dialog"
        headerDataComponent="desktop_messages_sections_duplicate-send-confirm-dialog_header"
        bodyDataComponent="desktop_messages_sections_duplicate-send-confirm-dialog_main"
        footerDataComponent="desktop_messages_sections_duplicate-send-confirm-dialog_footer"
        title="중복 전송 확인"
        description={
          duplicateSendCandidates && duplicateSendCandidates.length > 1
            ? `최근 같은 내용의 메시지를 보낸 기록이 ${duplicateSendCandidates.length}건 있습니다. 동일한 메시지를 재전송 할까요?`
            : "최근 같은 내용의 메시지를 보낸 기록이 있습니다. 동일한 메시지를 재전송 할까요?"
        }
        isDescriptionVisuallyHidden={false}
        approvalLabel="전송"
        pendingLabel="전송 중..."
        isPending={isSending}
        onApprove={() => void handleConfirmDuplicateSend()}
      >
        {duplicateSendCandidates && duplicateSendCandidates.length > 0 ? (
          <div
            data-component="desktop_messages_sections_duplicate-send-confirm-list"
            className="flex flex-col gap-2"
          >
            {duplicateSendCandidates.map((match) => (
              <div
                key={match.recipient.phone}
                data-component="desktop_messages_sections_duplicate-send-confirm-recent"
                className="rounded-[16px] bg-v3-dim-white px-4 py-3"
              >
                {shouldShowRecipientNameInPill && match.recipient.name ? (
                  <p className="mb-1 truncate text-[0.78rem] font-semibold text-v3-dark">
                    {match.recipient.name} · {match.recipient.formattedPhone}
                  </p>
                ) : (
                  <p className="mb-1 truncate text-[0.78rem] font-semibold text-v3-dark">
                    {match.recipient.formattedPhone}
                  </p>
                )}
                <span className="flex min-w-0 shrink-0 items-center gap-[calc(4px*var(--glint-ui-scale,1))] text-[0.78rem] font-semibold text-v3-text-muted">
                  <Calendar className="h-[calc(12px*var(--glint-ui-scale,1))] w-[calc(12px*var(--glint-ui-scale,1))] shrink-0" />
                  최근 전송 {formatDuplicateSentAt(getHistoryTimestamp(match.record))}
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </TwoButtonModal>

    </form>
  );
}
