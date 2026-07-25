"use client";

import { useMemo, useState } from "react";
import { BellRing, Trash2 } from "lucide-react";

import { MobileDetailHeader, MobileDetailPage } from "./detail-sheet";
import { ApprovalTwoButtonModal } from "@/components/app/ui/ApprovalTwoButtonModal";
import {
  useCreateMessageTriggerRule,
  useDeleteMessageTriggerRule,
  useMessageTriggerTemplates,
  useUpdateMessageTriggerRule,
} from "@/features/message-triggers/hooks/use-message-triggers";
import type {
  CreateMessageTriggerRuleDto,
  MessageTriggerRule,
  TriggerEventType,
  TriggerOffsetType,
  TriggerRecipientType,
  TriggerTemplateKey,
} from "@/features/message-triggers/types";

const EVENT_OPTIONS: Array<{ value: TriggerEventType; label: string }> = [
  { value: "CLIENT_CREATED", label: "고객 등록" },
  { value: "SERVICE_START", label: "서비스 시작" },
  { value: "SERVICE_END", label: "서비스 종료" },
  { value: "EMPLOYEE_ASSIGNED", label: "직원 배정" },
];

const OFFSET_OPTIONS: Record<TriggerEventType, Array<{ value: TriggerOffsetType; label: string }>> = {
  CLIENT_CREATED: [
    { value: "IMMEDIATE", label: "즉시 발송" },
    { value: "AFTER_DAYS", label: "등록 후 N일" },
  ],
  SERVICE_START: [
    { value: "SAME_DAY", label: "시작 당일" },
    { value: "BEFORE_DAYS", label: "시작 N일 전" },
    { value: "AFTER_DAYS", label: "시작 N일 후" },
  ],
  SERVICE_END: [
    { value: "SAME_DAY", label: "종료 당일" },
    { value: "BEFORE_DAYS", label: "종료 N일 전" },
    { value: "AFTER_DAYS", label: "종료 N일 후" },
  ],
  EMPLOYEE_ASSIGNED: [{ value: "IMMEDIATE", label: "즉시 발송" }],
};

const RECIPIENT_OPTIONS: Array<{ value: TriggerRecipientType; label: string }> = [
  { value: "CLIENT", label: "고객" },
  { value: "PRIMARY_EMPLOYEE", label: "주 담당 직원" },
  { value: "SECONDARY_EMPLOYEE", label: "보조 직원" },
];

type RuleForm = Required<CreateMessageTriggerRuleDto>;

function initialForm(rule: MessageTriggerRule | null): RuleForm {
  if (rule) {
    return {
      name: rule.name,
      isActive: rule.isActive,
      eventType: rule.eventType,
      offsetType: rule.offsetType,
      offsetDays: rule.offsetDays,
      recipientType: rule.recipientType,
      templateKey: rule.templateKey,
    };
  }

  return {
    name: "",
    isActive: true,
    eventType: "SERVICE_START",
    offsetType: "BEFORE_DAYS",
    offsetDays: 7,
    recipientType: "CLIENT",
    templateKey: "SERVICE_INFO",
  };
}

const FIELD_CLASS = "min-h-11 w-full rounded-xl border border-v3-border bg-white px-3 text-sm text-v3-dark outline-none focus:border-v3-primary";

export function MessageTriggerEditor({
  rule,
  onClose,
}: {
  rule: MessageTriggerRule | null;
  onClose: () => void;
}) {
  const [form, setForm] = useState<RuleForm>(() => initialForm(rule));
  const [error, setError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const createMutation = useCreateMessageTriggerRule();
  const updateMutation = useUpdateMessageTriggerRule();
  const deleteMutation = useDeleteMessageTriggerRule();
  const templatesQuery = useMessageTriggerTemplates({
    eventType: form.eventType,
    recipientType: form.recipientType,
  });
  const templates = useMemo(
    () => (templatesQuery.data ?? []).filter((template) => template.providers.sms),
    [templatesQuery.data],
  );
  const isPending = createMutation.isPending || updateMutation.isPending || deleteMutation.isPending;
  const needsDays = form.offsetType === "BEFORE_DAYS" || form.offsetType === "AFTER_DAYS";
  const selectedTemplateKey = templates.some((template) => template.key === form.templateKey)
    ? form.templateKey
    : templates[0]?.key ?? form.templateKey;

  const setField = <K extends keyof RuleForm>(key: K, value: RuleForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const handleEventChange = (eventType: TriggerEventType) => {
    const nextOffset = OFFSET_OPTIONS[eventType][0]?.value ?? "IMMEDIATE";
    setForm((current) => ({
      ...current,
      eventType,
      offsetType: nextOffset,
      offsetDays: nextOffset === "BEFORE_DAYS" || nextOffset === "AFTER_DAYS" ? current.offsetDays : 0,
    }));
  };

  const handleSave = async () => {
    const name = form.name.trim();
    if (!name) {
      setError("규칙 이름을 입력해 주세요.");
      return;
    }
    if (templates.length === 0) {
      setError("선택한 조건에 사용할 수 있는 SMS 템플릿이 없습니다.");
      return;
    }

    const dto: CreateMessageTriggerRuleDto = {
      ...form,
      name,
      templateKey: selectedTemplateKey,
      offsetDays: needsDays ? Math.max(0, Number(form.offsetDays) || 0) : 0,
    };

    setError(null);
    try {
      if (rule) {
        await updateMutation.mutateAsync({ id: rule.id, dto });
      } else {
        await createMutation.mutateAsync(dto);
      }
      onClose();
    } catch {
      setError("자동 전송 규칙을 저장하지 못했습니다. 다시 시도해 주세요.");
    }
  };

  const handleDelete = async () => {
    if (!rule) return;
    setError(null);
    try {
      await deleteMutation.mutateAsync(rule.id);
      setDeleteOpen(false);
      onClose();
    } catch {
      setDeleteOpen(false);
      setError("자동 전송 규칙을 삭제하지 못했습니다. 다시 시도해 주세요.");
    }
  };

  return (
    <MobileDetailPage data-component="mobile_mobile-redesign_detail-sheet_stack_detail-page" name="message-trigger-editor">
      <MobileDetailHeader data-component="mobile_mobile-redesign_detail-sheet_stack_detail-page_header"
        name="message-trigger-editor"
        avatar={<BellRing size={22} aria-hidden="true" />}
        title={rule ? "자동 전송 규칙 수정" : "자동 전송 규칙 추가"}
        badges={[{ label: form.isActive ? "활성화" : "비활성화", tone: form.isActive ? "green" : "muted" }]}
      />

      <form
        className="space-y-4 px-4 pb-8"
        data-component="mobile-message-trigger-editor-form"
        onSubmit={(event) => {
          event.preventDefault();
          void handleSave();
        }}
      >
        <label className="block space-y-1.5 text-xs font-semibold text-v3-text-muted">
          <span>규칙 이름</span>
          <input
            name="ruleName"
            autoComplete="off"
            className={FIELD_CLASS}
            value={form.name}
            onChange={(event) => setField("name", event.target.value)}
          />
        </label>

        <label className="block space-y-1.5 text-xs font-semibold text-v3-text-muted">
          <span>발송 이벤트</span>
          <select
            name="eventType"
            className={FIELD_CLASS}
            value={form.eventType}
            onChange={(event) => handleEventChange(event.target.value as TriggerEventType)}
          >
            {EVENT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>

        <label className="block space-y-1.5 text-xs font-semibold text-v3-text-muted">
          <span>발송 시점</span>
          <select
            name="offsetType"
            className={FIELD_CLASS}
            value={form.offsetType}
            onChange={(event) => setField("offsetType", event.target.value as TriggerOffsetType)}
          >
            {OFFSET_OPTIONS[form.eventType].map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>

        {needsDays ? (
          <label className="block space-y-1.5 text-xs font-semibold text-v3-text-muted">
            <span>기준 일수</span>
            <input
              name="offsetDays"
              type="number"
              inputMode="numeric"
              min={0}
              className={FIELD_CLASS}
              value={form.offsetDays}
              onChange={(event) => setField("offsetDays", Number(event.target.value))}
            />
          </label>
        ) : null}

        <label className="block space-y-1.5 text-xs font-semibold text-v3-text-muted">
          <span>수신자</span>
          <select
            name="recipientType"
            className={FIELD_CLASS}
            value={form.recipientType}
            onChange={(event) => setField("recipientType", event.target.value as TriggerRecipientType)}
          >
            {RECIPIENT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>

        <label className="block space-y-1.5 text-xs font-semibold text-v3-text-muted">
          <span>메시지 템플릿</span>
          <select
            name="templateKey"
            className={FIELD_CLASS}
            value={selectedTemplateKey}
            disabled={templatesQuery.isLoading || templates.length === 0}
            onChange={(event) => setField("templateKey", event.target.value as TriggerTemplateKey)}
          >
            {templates.map((template) => <option key={template.key} value={template.key}>{template.name}</option>)}
          </select>
        </label>

        <label className="flex min-h-11 items-center justify-between rounded-xl border border-v3-border bg-white px-3 text-sm font-semibold text-v3-dark">
          <span>규칙 활성화</span>
          <input
            name="isActive"
            type="checkbox"
            checked={form.isActive}
            onChange={(event) => setField("isActive", event.target.checked)}
          />
        </label>

        {error ? <p className="text-sm font-semibold text-v3-burgundy" role="alert">{error}</p> : null}

        <div className="flex gap-2" data-component="mobile-message-trigger-editor-actions">
          {rule ? (
            <button
              type="button"
              className="btn btn-secondary min-h-11"
              disabled={isPending}
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2 size={15} aria-hidden="true" />
              규칙 삭제
            </button>
          ) : null}
          <button type="submit" className="btn btn-primary min-h-11 flex-1" disabled={isPending}>
            {isPending ? "저장 중…" : "규칙 저장"}
          </button>
        </div>
      </form>

      <ApprovalTwoButtonModal
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="자동 전송 규칙을 삭제할까요?"
        description="삭제한 규칙은 복구할 수 없습니다."
        isDescriptionVisuallyHidden={false}
        approvalLabel="삭제 확인"
        pendingLabel="삭제 중…"
        approvalVariant="destructive"
        isPending={deleteMutation.isPending}
        onApprove={handleDelete}
        dataComponent="mobile-message-trigger-delete-modal"
      />
    </MobileDetailPage>
  );
}
