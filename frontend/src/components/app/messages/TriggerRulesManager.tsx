"use client";

/* eslint-disable react-hooks/set-state-in-effect -- controlled form state is synchronized when list selection and template availability change */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BellRing,
  CalendarClock,
  CalendarRange,
  Plus,
  UserPlus,
  Users,
} from "lucide-react";
import {
  SplitLayout,
  ListPanel,
  DetailPanel,
  AnimatedSlotList,
  AnimatedSlotListItemContent,
  HeaderActionButton,
  ListEmptyState,
  SteppedWizardPanelContent,
  DetailTabs,
  DetailTabPanels,
  type SplitLayoutMode,
} from "@/components/app/v3";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { TitleSelectMolecule } from "@/components/ui/title-select-molecule";
import { TitleTextInputMolecule } from "@/components/ui/title-text-input-molecule";
import { settingsApi } from "@/services/api";
import { useToast } from "@/hooks/use-toast";
import {
  useMessageTriggerRules,
  useMessageTriggerTemplates,
  useCreateMessageTriggerRule,
  useUpdateMessageTriggerRule,
  useDeleteMessageTriggerRule,
} from "@/features/message-triggers/hooks/use-message-triggers";
import {
  deriveAvailableTemplates,
  deriveEventTypesFromTemplates,
  deriveRecipientTypesFromTemplates,
  getChannelTemplates,
  isTriggerRuleInChannel,
  SMS_TRIGGER_TO_SYSTEM_TEMPLATE,
  type TriggerMessageChannel,
} from "@/features/message-triggers/channel";
import { useSystemTemplate } from "@/features/system-templates/hooks";
import { serviceInfoMsgTemplate } from "@/components/app/messages/templates/messageTemplate/serviceInfoMsg";
import { MessageApprovalRequiredNotice } from "@/components/app/messages/MessageApprovalRequiredNotice";
import { MessagePhonePreview } from "./MessagePhonePreview";
import type {
  MessageTriggerRule,
  CreateMessageTriggerRuleDto,
  TriggerEventType,
  TriggerOffsetType,
  TriggerRecipientType,
  TriggerTemplateKey,
} from "@/features/message-triggers/types";

type RuleSelection = string | "new" | null;
type RuleStatusFilter = "active" | "inactive";
type TriggerRuleDetailTab = "settings" | "preview";

type RuleFormState = CreateMessageTriggerRuleDto;

type TriggerRuleListItem = {
  kind: "trigger-rule";
  id: string;
  title: string;
  subtitle: string;
  active: boolean;
  icon: typeof BellRing;
  rule: MessageTriggerRule;
};

type RuleListItem = TriggerRuleListItem;

const EVENT_OPTIONS: Array<{ value: TriggerEventType; label: string; icon: typeof BellRing }> = [
  { value: "CLIENT_CREATED", label: "고객 등록", icon: UserPlus },
  { value: "SERVICE_START", label: "서비스 시작", icon: CalendarClock },
  { value: "SERVICE_END", label: "서비스 종료", icon: CalendarRange },
  { value: "EMPLOYEE_ASSIGNED", label: "직원 배정", icon: Users },
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

// Recipient labels are presentation-only (the catalog carries recipient *types*, not Korean
// labels). Which recipients are valid for an event is derived from the template catalog.
const RECIPIENT_LABELS: Record<TriggerRecipientType, string> = {
  CLIENT: "고객",
  PRIMARY_EMPLOYEE: "주 담당 직원",
  SECONDARY_EMPLOYEE: "보조 직원",
};

const RECIPIENT_TYPE_ORDER = Object.keys(RECIPIENT_LABELS) as TriggerRecipientType[];

function getDefaultFormState(): RuleFormState {
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

const RULE_STATUS_TABS = [
  { label: "활성화", value: "active" },
  { label: "비활성화", value: "inactive" },
] as const;

const CHANNEL_COPY: Record<
  TriggerMessageChannel,
  {
    listTitle: string;
    listSubtitle: string;
    detailSubtitle: string;
    emptySelection: string;
  }
> = {
  sms: {
    listTitle: "자동 전송 루틴",
    listSubtitle: "메시지 템플릿을 자동으로 보내는 루틴만 관리합니다.",
    detailSubtitle: "메시지 발송 시점, 수신자, 메시지 템플릿을 설정해서 자동 전송을 설정할 수 있어요.",
    emptySelection: "왼쪽 목록에서 SMS 규칙을 선택하거나 새 규칙을 만들어 주세요.",
  },
};

const TRIGGER_RULE_DETAIL_TABS = [
  { key: "settings", label: "규칙 설정" },
  { key: "preview", label: "미리보기" },
] satisfies Array<{ key: TriggerRuleDetailTab; label: string }>;

const TRIGGER_RULE_APPROVAL_MESSAGE =
  "메시지 발송 승인 후에 설정 가능합니다. 설정에서 메시지 발송 기능을 신청해 주세요.";

const TRIGGER_TEMPLATE_MESSAGE_FALLBACKS: Record<TriggerTemplateKey, string> = {
  CLIENT_WELCOME: `[아이미래 인천]
#{고객명}님, 등록이 완료되었습니다.

등록일: #{등록일}
서비스: #{서비스타입}

문의사항은 채널톡으로 연락주세요.`,
  SERVICE_START_REMINDER: `[아이미래 인천]
#{고객명}님, #{발송기준}입니다.

서비스 시작일: #{서비스시작일}

준비사항이나 문의사항이 있으시면 연락주세요.`,
  SERVICE_INFO: serviceInfoMsgTemplate({ name: "{{name}}" }),
  SERVICE_END_REMINDER: `[아이미래 인천]
#{고객명}님, #{발송기준}입니다.

서비스 종료일: #{서비스종료일}

필요한 사항이 있으면 언제든지 연락주세요.`,
  EMPLOYEE_ASSIGNED: `[아이미래 인천]
#{직원명}님, 새로운 배정이 등록되었습니다.

고객명: #{고객명}
서비스 시작일: #{서비스시작일}

세부 내용을 확인해 주세요.`,
  SERVICE_RECORD_LINK: `[사회서비스 제공자 품질평가 A등급]
안녕하세요, 인천 아이미래로 입니다 :)

{{employeeName}} 관리사님, {{clientName}} 산모님의 서비스 제공기록지 작성 링크입니다.
매일 서비스 제공 완료 직전에 서비스 세부사항 기록 후에, 산모님께 승인을 받으시면 됩니다.

최초 접속 시에 관리사님의 전화번호 인증이 필요합니다. 링크 접속 후 휴대폰 번호로 본인확인하고, 방문일마다 기록을 남겨주세요.

감사합니다.

제공기록지 링크
{{serviceRecordUrl}}`,
  CLIENT_GREETING: `[아이미래 인천]
#{고객명}님, 안녕하세요.

저희 아이미래에 등록해 주셔서 감사합니다.
앞으로 잘 부탁드립니다.

문의사항이 있으시면 언제든지 연락주세요.`,
  PRICE_INFO: `[아이미래 인천]
비용 안내드립니다. 자세한 내용은 담당자에게 문의해 주세요.`,
  REMINDER: `[아이미래 인천]
#{고객명}님, 일정 리마인드 안내드립니다.`,
  THANKS: `[아이미래 인천]
#{고객명}님, 예약이 완료되었습니다. 감사합니다.`,
  SURVEY: `[아이미래 인천]
#{고객명}님, 모니터링 설문 부탁드립니다.`,
  INFO: `[아이미래 인천]
안내드립니다.`,
};

function toFormState(rule: MessageTriggerRule | null): RuleFormState {
  if (!rule) return getDefaultFormState();
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

function normalizeDto(dto: RuleFormState): CreateMessageTriggerRuleDto {
  return {
    ...dto,
    offsetDays:
      dto.offsetType === "BEFORE_DAYS" || dto.offsetType === "AFTER_DAYS"
        ? Number(dto.offsetDays || 0)
        : 0,
  };
}

function getRuleSummary(rule: RuleFormState) {
  const eventLabel = EVENT_OPTIONS.find((option) => option.value === rule.eventType)?.label ?? rule.eventType;
  const recipientLabel = RECIPIENT_LABELS[rule.recipientType] ?? rule.recipientType;

  let timingLabel = OFFSET_OPTIONS[rule.eventType].find((option) => option.value === rule.offsetType)?.label ?? rule.offsetType;
  if (rule.offsetType === "BEFORE_DAYS" || rule.offsetType === "AFTER_DAYS") {
    timingLabel = `${timingLabel.replace("N", String(rule.offsetDays || 0))}`;
  }

  return `${eventLabel} · ${timingLabel} · ${recipientLabel}`;
}

function getRuleIcon(eventType: TriggerEventType) {
  return EVENT_OPTIONS.find((option) => option.value === eventType)?.icon ?? BellRing;
}

export function TriggerRulesManager({
  dataComponentPrefix = "message",
  channel = "sms",
}: {
  dataComponentPrefix?: string;
  channel?: TriggerMessageChannel;
} = {}) {
  const { toast } = useToast();
  const [selectedRuleId, setSelectedRuleId] = useState<RuleSelection>(null);
  const [isRuleDetailDismissed, setIsRuleDetailDismissed] = useState(false);
  const [splitLayoutMode, setSplitLayoutMode] = useState<SplitLayoutMode | null>(null);
  const [statusFilter, setStatusFilter] = useState<RuleStatusFilter>("active");
  const [activeDetailTab, setActiveDetailTab] = useState<TriggerRuleDetailTab>("settings");
  const [formState, setFormState] = useState<RuleFormState>(() => getDefaultFormState());
  const component = (suffix: string) => `${dataComponentPrefix}-${suffix}`;
  const isCompactSplitLayout = splitLayoutMode === "compact";
  const copy = CHANNEL_COPY[channel];

  const { data: rulesData = [], isLoading } = useMessageTriggerRules();
  const createMutation = useCreateMessageTriggerRule();
  const updateMutation = useUpdateMessageTriggerRule();
  const deleteMutation = useDeleteMessageTriggerRule();

  const rules = useMemo(() => (Array.isArray(rulesData) ? rulesData : []), [rulesData]);

  const { data: senderApproval, isLoading: isSenderApprovalLoading } = useQuery({
    queryKey: ["settings", "message-sender-approval"],
    queryFn: settingsApi.getMessageSenderApproval,
  });
  const isTriggerRulesLocked = !isSenderApprovalLoading && senderApproval?.isApproved === false;
  const effectiveSelectedRuleId = isTriggerRulesLocked ? null : selectedRuleId;

  const selectedRule =
    effectiveSelectedRuleId &&
    effectiveSelectedRuleId !== "new"
      ? rules.find((rule) => rule.id === effectiveSelectedRuleId) ?? null
      : null;

  // Fetch all SMS templates in one query (no event/recipient filter), then derive
  // the event / recipient / template dropdowns from the catalog so future templates surface
  // automatically.
  const templateQuery = useMessageTriggerTemplates({});
  const selectedSystemTemplateKey = SMS_TRIGGER_TO_SYSTEM_TEMPLATE[formState.templateKey] ?? "";
  const { data: selectedSystemTemplate } = useSystemTemplate(selectedSystemTemplateKey);

  const channelTemplates = useMemo(
    () => getChannelTemplates(templateQuery.data ?? [], channel),
    [channel, templateQuery.data],
  );

  const eventOptions = useMemo(() => {
    const allowedEvents = new Set(deriveEventTypesFromTemplates(channelTemplates));
    return EVENT_OPTIONS.filter((option) => allowedEvents.has(option.value));
  }, [channelTemplates]);

  const getRecipientTypesForEvent = useCallback(
    (eventType: TriggerEventType): TriggerRecipientType[] => {
      const allowed = new Set(deriveRecipientTypesFromTemplates(channelTemplates, eventType));
      return RECIPIENT_TYPE_ORDER.filter((recipientType) => allowed.has(recipientType));
    },
    [channelTemplates],
  );

  const recipientOptions = useMemo(
    () =>
      getRecipientTypesForEvent(formState.eventType).map((recipientType) => ({
        value: recipientType,
        label: RECIPIENT_LABELS[recipientType],
      })),
    [getRecipientTypesForEvent, formState.eventType],
  );

  const availableTemplates = useMemo(
    () => deriveAvailableTemplates(channelTemplates, formState.eventType, formState.recipientType),
    [channelTemplates, formState.eventType, formState.recipientType],
  );
  const selectedTemplate = useMemo(() => {
    return availableTemplates.find((template) => template.key === formState.templateKey) ?? null;
  }, [availableTemplates, formState.templateKey]);
  const selectedTemplateMessage = selectedSystemTemplate?.content?.trim()
    ? selectedSystemTemplate.content
    : TRIGGER_TEMPLATE_MESSAGE_FALLBACKS[formState.templateKey];
  const filteredRules = useMemo(() => {
    return rules.filter((rule) =>
      rule.isActive === (statusFilter === "active") &&
      isTriggerRuleInChannel(rule, channel)
    );
  }, [channel, rules, statusFilter]);

  useEffect(() => {
    if (isTriggerRulesLocked) return;

    if (selectedRuleId === "new") return;
    if (selectedRuleId === null && filteredRules.length > 0) {
      if (splitLayoutMode === null) return;
      if (isCompactSplitLayout) return;
      if (isRuleDetailDismissed) return;
      setSelectedRuleId(filteredRules[0].id);
      return;
    }
    if (!selectedRuleId) return;

    const existsInRules = rules.some((rule) => rule.id === selectedRuleId);
    if (!existsInRules) {
      setSelectedRuleId(splitLayoutMode === "desktop" && !isRuleDetailDismissed ? (filteredRules[0]?.id ?? null) : null);
      return;
    }

    const existsInFilteredRules = filteredRules.some((rule) => rule.id === selectedRuleId);
    if (!existsInFilteredRules) {
      setSelectedRuleId(splitLayoutMode === "desktop" && !isRuleDetailDismissed ? (filteredRules[0]?.id ?? null) : null);
    }
  }, [
    filteredRules,
    isCompactSplitLayout,
    isRuleDetailDismissed,
    isTriggerRulesLocked,
    rules,
    selectedRuleId,
    splitLayoutMode,
  ]);

  useEffect(() => {
    if (effectiveSelectedRuleId === "new") {
      setFormState(getDefaultFormState());
      return;
    }
    setFormState(toFormState(selectedRule));
  }, [channel, effectiveSelectedRuleId, selectedRule]);

  useEffect(() => {
    // Wait until the catalog has loaded before reconciling the form against derived options.
    if (eventOptions.length === 0) return;

    if (!eventOptions.some((option) => option.value === formState.eventType)) {
      setFormState(getDefaultFormState());
      return;
    }

    const allowedRecipients = getRecipientTypesForEvent(formState.eventType);
    if (allowedRecipients.length > 0 && !allowedRecipients.includes(formState.recipientType)) {
      const nextRecipient = allowedRecipients[0];
      setFormState((current) => ({
        ...current,
        recipientType: nextRecipient,
      }));
    }

    const allowedOffsets = OFFSET_OPTIONS[formState.eventType];
    if (!allowedOffsets.some((option) => option.value === formState.offsetType)) {
      setFormState((current) => ({
        ...current,
        offsetType: allowedOffsets[0].value,
        offsetDays: 0,
      }));
    }
  }, [
    channel,
    eventOptions,
    getRecipientTypesForEvent,
    formState.eventType,
    formState.recipientType,
    formState.offsetType,
  ]);

  useEffect(() => {
    if (availableTemplates.length === 0) return;
    if (!availableTemplates.some((template) => template.key === formState.templateKey)) {
      setFormState((current) => ({
        ...current,
        templateKey: availableTemplates[0].key,
      }));
    }
  }, [availableTemplates, formState.templateKey]);

  const listItems = useMemo<RuleListItem[]>(() => {
    return filteredRules.map((rule): TriggerRuleListItem => ({
      kind: "trigger-rule",
      id: rule.id,
      title: rule.name,
      subtitle: getRuleSummary(toFormState(rule)),
      active: rule.isActive,
      icon: getRuleIcon(rule.eventType),
      rule,
    }));
  }, [filteredRules]);

  const hasChanges = useMemo(() => {
    if (effectiveSelectedRuleId === "new") {
      return !!formState.name.trim();
    }
    if (!selectedRule) return false;
    return JSON.stringify(normalizeDto(formState)) !== JSON.stringify(normalizeDto(toFormState(selectedRule)));
  }, [effectiveSelectedRuleId, formState, selectedRule]);

  const isSaving = createMutation.isPending || updateMutation.isPending;
  const isDetailPendingSelection =
    !isLoading &&
    effectiveSelectedRuleId === null &&
    splitLayoutMode === "desktop" &&
    !isRuleDetailDismissed &&
    filteredRules.length > 0;
  const isDetailLoading = isLoading || isDetailPendingSelection;
  const hasVisibleDetailPanel = isDetailLoading || effectiveSelectedRuleId !== null;

  const handleCreateNew = () => {
    if (isTriggerRulesLocked) return;
    setIsRuleDetailDismissed(false);
    setStatusFilter("active");
    setSelectedRuleId("new");
    setFormState(getDefaultFormState());
  };

  const handleRuleSelect = (ruleId: string) => {
    setIsRuleDetailDismissed(false);
    setSelectedRuleId(ruleId);
  };

  const handleRuleActiveToggle = async (rule: MessageTriggerRule, checked: boolean) => {
    if (isTriggerRulesLocked) return;

    const dto = normalizeDto({
      ...toFormState(rule),
      isActive: checked,
    });

    try {
      await updateMutation.mutateAsync({ id: rule.id, dto });
      if (effectiveSelectedRuleId === rule.id) {
        setFormState((current) => ({ ...current, isActive: checked }));
      }
      toast({ description: checked ? "발송 규칙이 활성화되었습니다." : "발송 규칙이 비활성화되었습니다." });
    } catch {
      toast({ variant: "destructive", description: "규칙 상태 변경 중 오류가 발생했습니다." });
    }
  };

  const handleBackToRuleList = () => {
    setIsRuleDetailDismissed(true);
    setSelectedRuleId(null);
  };

  const handleSave = async () => {
    if (isTriggerRulesLocked) return;
    const dto = normalizeDto(formState);

    if (!dto.name.trim()) {
      toast({ variant: "destructive", description: "규칙 이름을 입력해 주세요." });
      return;
    }

    if ((dto.offsetType === "BEFORE_DAYS" || dto.offsetType === "AFTER_DAYS") && (!dto.offsetDays || dto.offsetDays < 1)) {
      toast({ variant: "destructive", description: "일수는 1 이상이어야 합니다." });
      return;
    }

    try {
      if (selectedRuleId === "new" || !selectedRule) {
        const created = await createMutation.mutateAsync(dto);
        setSelectedRuleId(created.id);
        toast({ description: "발송 규칙이 생성되었습니다." });
      } else {
        await updateMutation.mutateAsync({ id: selectedRule.id, dto });
        toast({ description: "발송 규칙이 저장되었습니다." });
      }
    } catch {
      toast({ variant: "destructive", description: "규칙 저장 중 오류가 발생했습니다." });
    }
  };

  const handleDelete = async () => {
    if (isTriggerRulesLocked) return;
    if (!selectedRule) return;
    try {
      await deleteMutation.mutateAsync(selectedRule.id);
      setSelectedRuleId(null);
      toast({ description: "발송 규칙이 삭제되었습니다." });
    } catch {
      toast({ variant: "destructive", description: "규칙 삭제 중 오류가 발생했습니다." });
    }
  };
  return (
    <section
      data-component={component("trigger-rules")}
      className="flex h-full min-h-0 flex-1 flex-col"
    >
      <div data-component={component("trigger-rules-layout")} className="flex h-full min-h-0 flex-1 flex-col">
        <SplitLayout data-component="desktop_messages_split-layout"
          hasSelection={hasVisibleDetailPanel}
          onBack={handleBackToRuleList}
          onModeChange={setSplitLayoutMode}
        >
          <ListPanel data-component="desktop_messages_split-layout_list-panel"
            title={copy.listTitle}
            subtitle={copy.listSubtitle}
            tabs={RULE_STATUS_TABS.map((tab) => ({ ...tab }))}
            activeTab={statusFilter}
            onTabChange={isTriggerRulesLocked ? undefined : (value) => setStatusFilter(value as RuleStatusFilter)}
            disabled={isTriggerRulesLocked}
            disabledOverlay={isTriggerRulesLocked ? (
              <MessageApprovalRequiredNotice dataComponent={component("trigger-rules-disabled-copy")} />
            ) : undefined}
            headerActions={isLoading || isTriggerRulesLocked ? undefined : (
              <HeaderActionButton
                icon={Plus}
                label="새 규칙"
                onClick={handleCreateNew}
                data-component={component("trigger-rules-new")}
              />
            )}
          >
            <>
              {(isLoading || listItems.length > 0) ? (
                <div data-component={component("trigger-rules-list")} className="space-y-2 pb-2">
                  <AnimatedSlotList<RuleListItem>
                    items={listItems}
                    isLoading={isLoading}
                    loadingCount={5}
                    className="space-y-2"
                    getSlotState={({ item, isLoading: slotLoading }) => ({
                      isActive: !slotLoading && item?.id === effectiveSelectedRuleId,
                      isInteractive: !slotLoading && Boolean(item),
                    })}
                    onSlotClick={(item) => {
                      handleRuleSelect(item.id);
                    }}
                    getItemKey={(item) => item.id}
                    render={({ item, isLoading: slotLoading }) => {
                      if (slotLoading) {
                        return (
                          <>
                            <div data-component={component("trigger-rule-skeleton-icon")} className="flex h-10 w-10 items-center justify-center rounded-[14px] bg-v3-dim-white">
                              <Skeleton className="h-4 w-4 rounded-md bg-white/70" />
                            </div>
                            <div data-component={component("trigger-rule-skeleton-text")} className="min-w-0 flex-1">
                              <Skeleton className="h-4 w-32 bg-v3-dim-white" />
                              <Skeleton className="mt-2 h-3 w-44 bg-v3-dim-white" />
                            </div>
                          </>
                        );
                      }

                      if (!item) return null;

                      return (
                        <AnimatedSlotListItemContent
                          dataComponent={component("trigger-rule")}
                          icon={item.icon}
                          title={item.title}
                          subtitle={item.subtitle}
                          status={
                            <Switch
                              aria-label={`${item.title} 활성화`}
                              checked={item.active}
                              disabled={isTriggerRulesLocked || updateMutation.isPending}
                              onClick={(event) => event.stopPropagation()}
                              onCheckedChange={(checked) => {
                                void handleRuleActiveToggle(item.rule, checked);
                              }}
                              className="ml-auto shrink-0"
                            />
                          }
                        />
                      );
                    }}
                  />
                </div>
              ) : !isTriggerRulesLocked ? (
                <ListEmptyState
                  message={statusFilter === "active" ? "활성화된 발송 규칙이 없습니다." : "비활성화된 발송 규칙이 없습니다."}
                />
              ) : null}
            </>
          </ListPanel>

          {isTriggerRulesLocked ? (
            <DetailPanel data-component="desktop_messages_split-layout_detail-panel"
              overlay={(
                <ListEmptyState
                  name={component("trigger-rules-locked")}
                  icon={BellRing}
                  message={TRIGGER_RULE_APPROVAL_MESSAGE}
                  className="flex-none min-h-0"
                />
              )}
            >
              {null}
            </DetailPanel>
          ) : effectiveSelectedRuleId === null && !isDetailLoading ? (
            <DetailPanel data-component="desktop_messages_split-layout_detail-panel-2"
              overlay={(
                <ListEmptyState
                  name={component("trigger-rules-detail-empty")}
                  icon={BellRing}
                  message={copy.emptySelection}
                  className="flex-none min-h-0"
                />
              )}
            >
              {null}
            </DetailPanel>
          ) : (
            <DetailPanel data-component="desktop_messages_split-layout_detail-panel-3"
              isLoading={isDetailLoading}
              title={effectiveSelectedRuleId === "new" ? "새 발송 규칙" : selectedRule?.name ?? "발송 규칙"}
              subtitle={copy.detailSubtitle}
              tabs={
                <DetailTabs
                  tabs={TRIGGER_RULE_DETAIL_TABS}
                  activeTab={activeDetailTab}
                  onTabChange={(key) => setActiveDetailTab(key as TriggerRuleDetailTab)}
                />
              }
              footer={
                <>
                  {isDetailLoading || selectedRule ? (
                    <Button
                      type="button"
                      variant="negative-outline"
                      size="sm"
                      width="sm"
                      onClick={handleDelete}
                      disabled={isDetailLoading || deleteMutation.isPending}
                      data-component={component("trigger-rules-delete")}
                    >
                      삭제
                    </Button>
                  ) : (
                    <span aria-hidden="true" className="w-1/4" />
                  )}
                  <Button
                    type="button"
                    variant="positive"
                    size="sm"
                    width="sm"
                    onClick={handleSave}
                    disabled={!hasChanges || isSaving}
                    data-component={component("trigger-rules-save")}
                  >
                    {isSaving ? "저장 중..." : "저장"}
                  </Button>
                </>
              }
            >
              <DetailTabPanels
                activeTab={activeDetailTab}
                dataComponent={component("trigger-rules-detail-tabpanes")}
                panelDataComponent={
                  dataComponentPrefix === "message" ? "messages-template-detail-pane" : component("template-detail-pane")
                }
                className="flex min-h-0 flex-1"
                trackClassName="min-h-0 flex-1"
                panelClassName="h-full min-h-0"
                panels={[
                  {
                    key: "settings",
                    children: (
                      <SteppedWizardPanelContent
                        dataComponent={component("trigger-rules-form")}
                        flattenStepContent
                        className="py-0"
                        stepContentClassName="justify-start gap-4"
                      >
                        <TitleTextInputMolecule
                          id="trigger-rule-name"
                          label="규칙 이름"
                          value={formState.name}
                          onValueChange={(value) =>
                            setFormState((current) => ({ ...current, name: value }))
                          }
                          placeholder="예: 서비스 시작 7일 전 고객 안내"
                          dataComponent={component("trigger-rules-name")}
                        />

                        <TitleSelectMolecule
                          id="trigger-rule-event"
                          label="이벤트 기준"
                          value={formState.eventType}
                          options={eventOptions.map((option) => ({
                            label: option.label,
                            value: option.value,
                          }))}
                          onValueChange={(value) => {
                            const nextEventType = value as TriggerEventType;
                            const nextRecipient =
                              getRecipientTypesForEvent(nextEventType)[0] ?? formState.recipientType;
                            const nextOffset = OFFSET_OPTIONS[nextEventType][0].value;

                            setFormState((current) => ({
                              ...current,
                              eventType: nextEventType,
                              recipientType: nextRecipient,
                              offsetType: nextOffset,
                              offsetDays: nextOffset === "BEFORE_DAYS" || nextOffset === "AFTER_DAYS" ? 1 : 0,
                            }));
                          }}
                          dataComponent={component("trigger-rules-event")}
                          triggerDataComponent={component("trigger-rules-event-select")}
                        />

                        <TitleSelectMolecule
                          id="trigger-rule-offset"
                          label="발송 시점"
                          value={formState.offsetType}
                          options={OFFSET_OPTIONS[formState.eventType]}
                          onValueChange={(value) => {
                            const nextOffsetType = value as TriggerOffsetType;

                            setFormState((current) => ({
                              ...current,
                              offsetType: nextOffsetType,
                              offsetDays:
                                nextOffsetType === "BEFORE_DAYS" || nextOffsetType === "AFTER_DAYS"
                                  ? Math.max(current.offsetDays || 1, 1)
                                  : 0,
                            }));
                          }}
                          dataComponent={component("trigger-rules-offset")}
                          triggerDataComponent={component("trigger-rules-offset-select")}
                        />

                        <TitleSelectMolecule
                          id="trigger-rule-recipient"
                          label="수신 대상"
                          value={formState.recipientType}
                          options={recipientOptions}
                          onValueChange={(value) =>
                            setFormState((current) => ({
                              ...current,
                              recipientType: value as TriggerRecipientType,
                            }))
                          }
                          dataComponent={component("trigger-rules-recipient")}
                          triggerDataComponent={component("trigger-rules-recipient-select")}
                        />

                        {(formState.offsetType === "BEFORE_DAYS" ||
                          formState.offsetType === "AFTER_DAYS") && (
                          <TitleTextInputMolecule
                            id="trigger-rule-offset-days"
                            label="기준 일수"
                            type="number"
                            min={1}
                            value={formState.offsetDays || 1}
                            onValueChange={(value) =>
                              setFormState((current) => ({
                                ...current,
                                offsetDays: Math.max(Number(value || 1), 1),
                              }))
                            }
                            dataComponent={component("trigger-rules-offset-days")}
                          />
                        )}

                        <TitleSelectMolecule
                          id="trigger-rule-template"
                          label="발송 템플릿"
                          value={formState.templateKey}
                          options={availableTemplates.map((template) => ({
                            label: template.name,
                            value: template.key,
                          }))}
                          onValueChange={(value) =>
                            setFormState((current) => ({
                              ...current,
                              templateKey: value as TriggerTemplateKey,
                            }))
                          }
                          dataComponent={component("trigger-rules-template")}
                          triggerDataComponent={component("trigger-rules-template-select")}
                        />
                      </SteppedWizardPanelContent>
                    ),
                  },
                  {
                    key: "preview",
                    className: "flex min-h-0 justify-center",
                    children: (
                      <MessagePhonePreview
                        className="h-full min-h-0 overflow-hidden py-0"
                        content={selectedTemplateMessage}
                        templateName={selectedTemplate?.name ?? "발송 템플릿"}
                        headline={selectedTemplate?.name ?? "발송 템플릿"}
                        subtitle={
                          selectedTemplate?.description ??
                          selectedSystemTemplate?.description ??
                          "선택한 발송 템플릿 미리보기입니다."
                        }
                        dataComponentPrefix={dataComponentPrefix === "message" ? "message" : dataComponentPrefix}
                        panelDataComponent={
                          dataComponentPrefix === "message"
                            ? "messages-template-preview-phone-panel"
                            : component("template-preview-phone-panel")
                        }
                      />
                    ),
                  },
                ]}
              />
            </DetailPanel>
          )}
        </SplitLayout>
      </div>
    </section>
  );
}
