"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  Building2,
  CalendarClock,
  CheckCircle2,
  Clock3,
  ExternalLink,
  History,
  Repeat2,
  Send,
  ShieldCheck,
  UserPlus,
} from "lucide-react";
import {
  AnimatedSlotList,
  AnimatedSlotListItemContent,
  DetailEmptyState,
  DetailPanel,
  InfoCard,
  InfoRow,
  ListEmptyState,
  ListPanel,
} from "@/components/app/v3";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { isTriggerRuleInChannel } from "@/features/message-triggers/channel";
import { useMessageTriggerRules } from "@/features/message-triggers/hooks/use-message-triggers";
import type {
  MessageTriggerRule,
  TriggerEventType,
  TriggerOffsetType,
  TriggerRecipientType,
} from "@/features/message-triggers/types";
import { useGetAuthUser } from "@/hooks/useGetAuthUser";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  settingsApi,
  type ClientRegistrationPolicy,
  type ClientRegistrationPolicyPatch,
  type MessageAutomationPoliciesResponse,
  type MessageAutomationPastTriggerConfig,
  type MessageAutomationPolicy,
} from "@/services/api";

const UNIFIED_SENDER_PHONE = "010-9641-1878";
const DUPLICATE_SEND_POLICY_ITEM_ID = "duplicate-send-confirmation";
const SERVICE_RECORD_LINK_POLICY_ID = "service-feedback-link";
const SMS_RETRY_POLICY_ID = "sms-retry";
const PAST_TRIGGER_POLICY_ID = "past-trigger";
const DEFAULT_PAST_TRIGGER_CONFIG: MessageAutomationPastTriggerConfig = {
  sendIntervalMinutes: 1,
  ruleOrder: [],
};

const TRIGGER_EVENT_LABELS: Record<TriggerEventType, string> = {
  CLIENT_CREATED: "고객 등록",
  SERVICE_START: "서비스 시작",
  SERVICE_END: "서비스 종료",
  EMPLOYEE_ASSIGNED: "직원 배정",
};

const TRIGGER_RECIPIENT_LABELS: Record<TriggerRecipientType, string> = {
  CLIENT: "고객",
  PRIMARY_EMPLOYEE: "주 담당 직원",
  SECONDARY_EMPLOYEE: "보조 직원",
};

const TRIGGER_OFFSET_LABELS: Record<TriggerEventType, Record<TriggerOffsetType, string>> = {
  CLIENT_CREATED: {
    IMMEDIATE: "즉시 발송",
    SAME_DAY: "등록 당일",
    BEFORE_DAYS: "등록 N일 전",
    AFTER_DAYS: "등록 N일 후",
  },
  SERVICE_START: {
    IMMEDIATE: "즉시 발송",
    SAME_DAY: "시작 당일",
    BEFORE_DAYS: "시작 N일 전",
    AFTER_DAYS: "시작 N일 후",
  },
  SERVICE_END: {
    IMMEDIATE: "즉시 발송",
    SAME_DAY: "종료 당일",
    BEFORE_DAYS: "종료 N일 전",
    AFTER_DAYS: "종료 N일 후",
  },
  EMPLOYEE_ASSIGNED: {
    IMMEDIATE: "즉시 발송",
    SAME_DAY: "배정 당일",
    BEFORE_DAYS: "배정 N일 전",
    AFTER_DAYS: "배정 N일 후",
  },
};

const ALIGO_POLICY_ITEMS = [
  {
    id: "aligo-terms",
    text: "알리고 문자 서비스 이용약관에 동의합니다.",
    sourceLabel: "알리고 회원가입",
    sourceHref: "https://smartsms.aligo.in/join.html",
  },
  {
    id: "aligo-privacy-third-party",
    text: "메시지 발송 기능 제공을 위해 필요한 개인정보를 제3자에게 제공하는 데 동의합니다.",
    sourceLabel: "알리고 회원가입",
    sourceHref: "https://smartsms.aligo.in/join.html",
  },
  {
    id: "sender-number",
    text: "발신번호는 사이트 내에 사전 등록된 번호만 사용할 수 있음을 확인했습니다.",
    sourceLabel: "알리고 API SPEC",
    sourceHref: "https://smartsms.aligo.in/admin/api/spec.html",
  },
] as const;

const CURRENT_TENANT_ITEM_ID = "current-tenant";
const CLIENT_REGISTRATION_POLICY_ITEM_ID = "client-registration-policy";

type TenantApplicationListItem = {
  id: string;
  title: string;
  subtitle: string;
  statusLabel: string;
  icon: typeof Building2;
  kind: "tenant-application" | "automation-policy" | "duplicate-send-policy" | "client-registration-policy";
  active: boolean;
  requiresApproval: boolean;
  rows?: MessageAutomationPolicy["rows"];
};

const DUPLICATE_SEND_POLICY_ITEM: TenantApplicationListItem = {
  id: DUPLICATE_SEND_POLICY_ITEM_ID,
  title: "중복 전송 확인",
  subtitle: "72시간 내 같은 번호와 같은 메시지는 전송 전 확인합니다.",
  statusLabel: "활성",
  icon: Repeat2,
  kind: "duplicate-send-policy",
  active: true,
  requiresApproval: true,
};

function formatRequestedAt(date: Date) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function getAutomationPolicyIcon(policyId: string) {
  if (policyId === SERVICE_RECORD_LINK_POLICY_ID) {
    return CalendarClock;
  }

  if (policyId === PAST_TRIGGER_POLICY_ID) {
    return History;
  }

  if (policyId === SMS_RETRY_POLICY_ID) {
    return Repeat2;
  }

  return ShieldCheck;
}

function getPolicyStatusLabel(active: boolean) {
  return active ? "활성" : "비활성";
}

function getAutomationPolicyDataComponent(policyId: string) {
  return `messages-settings-${policyId}-policy`;
}

function formatTriggerOffset(rule: MessageTriggerRule) {
  const offsetLabel = TRIGGER_OFFSET_LABELS[rule.eventType]?.[rule.offsetType] ?? rule.offsetType;

  if (rule.offsetType === "BEFORE_DAYS" || rule.offsetType === "AFTER_DAYS") {
    return offsetLabel.replace("N", String(rule.offsetDays || 0));
  }

  return offsetLabel;
}

function getTriggerRuleSummary(rule: MessageTriggerRule) {
  const eventLabel = TRIGGER_EVENT_LABELS[rule.eventType] ?? rule.eventType;
  const recipientLabel = TRIGGER_RECIPIENT_LABELS[rule.recipientType] ?? rule.recipientType;

  return `${eventLabel} · ${formatTriggerOffset(rule)} · ${recipientLabel}`;
}

function getOrderedTriggerRules(rules: MessageTriggerRule[], orderIds: string[]) {
  const rulesById = new Map(rules.map((rule) => [rule.id, rule]));
  const ordered = orderIds
    .map((id) => rulesById.get(id))
    .filter((rule): rule is MessageTriggerRule => Boolean(rule));
  const orderedIds = new Set(ordered.map((rule) => rule.id));
  const missing = rules.filter((rule) => !orderedIds.has(rule.id));

  return [...ordered, ...missing];
}

export function MessageTenantApplicationSettings() {
  const { data: authUser } = useGetAuthUser();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: messageSenderApproval, isLoading: isMessageSenderApprovalLoading } = useQuery({
    queryKey: ["settings", "message-sender-approval"],
    queryFn: settingsApi.getMessageSenderApproval,
  });
  const { data: messageAutomationPolicies } = useQuery({
    queryKey: ["settings", "message-automation-policies"],
    queryFn: settingsApi.getMessageAutomationPolicies,
  });
  const { data: clientRegistrationPolicy } = useQuery({
    queryKey: ["settings", "client-registration-policy"],
    queryFn: settingsApi.getClientRegistrationPolicy,
  });
  const { data: triggerRulesData = [], isLoading: isTriggerRulesLoading } = useMessageTriggerRules();
  const [agreements, setAgreements] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(ALIGO_POLICY_ITEMS.map((item) => [item.id, false])),
  );
  const [requestedAt, setRequestedAt] = useState<string | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [draftRetroactiveRuleOrderIds, setDraftRetroactiveRuleOrderIds] = useState<string[] | null>(null);
  const [draftRetroactiveSendIntervalMinutes, setDraftRetroactiveSendIntervalMinutes] = useState<string | null>(null);

  const tenantName = authUser?.branchName?.trim() || "현재 선택된 지점";
  const allAgreed = ALIGO_POLICY_ITEMS.every((item) => agreements[item.id]);
  const canSubmit = allAgreed;
  const isMessageSenderApproved = messageSenderApproval?.isApproved === true;
  const listItems = useMemo<TenantApplicationListItem[]>(
    () => {
      if (isMessageSenderApprovalLoading) {
        return [];
      }

      const items: TenantApplicationListItem[] = [];

      if (!isMessageSenderApproved) {
        items.push({
          id: CURRENT_TENANT_ITEM_ID,
          title: "메시지 발송 기능 신청",
          subtitle: requestedAt
            ? `신청 접수 ${requestedAt}`
            : "알리고 정책 동의 후 신청해 주세요.",
          statusLabel: requestedAt ? "접수됨" : canSubmit ? "준비 완료" : "작성 중",
          icon: Building2,
          kind: "tenant-application",
          active: true,
          requiresApproval: true,
        });
      }

      const automationPolicyItems = (messageAutomationPolicies?.policies ?? []).map<TenantApplicationListItem>(
        (policy) => ({
          id: policy.id,
          title: policy.title,
          subtitle: policy.description,
          statusLabel: getPolicyStatusLabel(policy.active),
          icon: getAutomationPolicyIcon(policy.id),
          kind: "automation-policy",
          active: policy.active,
          requiresApproval: policy.requiresApproval,
          rows: policy.rows,
        }),
      );

      items.push(...automationPolicyItems, {
        id: CLIENT_REGISTRATION_POLICY_ITEM_ID,
        title: "고객 자동 등록",
        subtitle: "전자문서 고객 등록과 인사 문자 발송을 관리합니다.",
        statusLabel: getPolicyStatusLabel(clientRegistrationPolicy?.clientAutoRegistration === true),
        icon: UserPlus,
        kind: "client-registration-policy",
        active: clientRegistrationPolicy?.clientAutoRegistration === true,
        requiresApproval: false,
      }, DUPLICATE_SEND_POLICY_ITEM);

      return items;
    },
    [
      canSubmit,
      isMessageSenderApprovalLoading,
      isMessageSenderApproved,
      messageAutomationPolicies?.policies,
      clientRegistrationPolicy?.clientAutoRegistration,
      requestedAt,
    ],
  );
  const fallbackSelectedItemId = isMessageSenderApproved
    ? (listItems.find((item) => item.kind === "automation-policy")?.id ?? DUPLICATE_SEND_POLICY_ITEM_ID)
    : CURRENT_TENANT_ITEM_ID;
  const selectedItem = listItems.find((item) => item.id === (selectedItemId ?? fallbackSelectedItemId))
    ?? listItems[0]
    ?? null;
  const SelectedItemIcon = selectedItem?.icon ?? ShieldCheck;
  const activeSmsTriggerRules = useMemo(
    () => (Array.isArray(triggerRulesData) ? triggerRulesData : [])
      .filter((rule) => rule.isActive && isTriggerRuleInChannel(rule, "sms")),
    [triggerRulesData],
  );
  const savedPastTriggerConfig = messageAutomationPolicies?.pastTriggerConfig ?? DEFAULT_PAST_TRIGGER_CONFIG;
  const retroactiveRuleOrderIds = draftRetroactiveRuleOrderIds ?? savedPastTriggerConfig.ruleOrder;
  const retroactiveSendIntervalMinutes =
    draftRetroactiveSendIntervalMinutes ?? String(savedPastTriggerConfig.sendIntervalMinutes);
  const retroactiveTriggerOrderItems = useMemo(
    () => getOrderedTriggerRules(activeSmsTriggerRules, retroactiveRuleOrderIds),
    [activeSmsTriggerRules, retroactiveRuleOrderIds],
  );
  const isPastTriggerConfigDirty = draftRetroactiveRuleOrderIds !== null ||
    (
      draftRetroactiveSendIntervalMinutes !== null &&
      Number(draftRetroactiveSendIntervalMinutes) !== savedPastTriggerConfig.sendIntervalMinutes
    );
  const canSavePastTriggerConfig = isPastTriggerConfigDirty && Number(retroactiveSendIntervalMinutes) >= 1;

  const moveRetroactiveRuleOrder = (ruleId: string, direction: -1 | 1) => {
    const currentOrderIds = retroactiveTriggerOrderItems.map((item) => item.id);
    const index = currentOrderIds.indexOf(ruleId);
    const nextIndex = index + direction;

    if (index < 0 || nextIndex < 0 || nextIndex >= currentOrderIds.length) {
      return;
    }

    const nextOrderIds = [...currentOrderIds];
    [nextOrderIds[index], nextOrderIds[nextIndex]] = [nextOrderIds[nextIndex], nextOrderIds[index]];
    setDraftRetroactiveRuleOrderIds(nextOrderIds);
  };

  const updateRetroactiveSendIntervalMinutes = (value: string) => {
    if (value === "" || /^\d+$/.test(value)) {
      setDraftRetroactiveSendIntervalMinutes(value);
    }
  };

  const toggleAgreement = (id: string, checked: boolean) => {
    setAgreements((previous) => ({
      ...previous,
      [id]: checked,
    }));
  };

  const requestApprovalMutation = useMutation({
    mutationFn: settingsApi.requestMessageSenderApproval,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["settings", "message-sender-approval"] });
      setRequestedAt(formatRequestedAt(new Date()));
      toast({ description: `${tenantName} 메시지 발송 신청이 접수되었습니다.` });
    },
    onError: () => {
      toast({
        variant: "destructive",
        description: "메시지 발송 신청 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
      });
    },
  });

  const savePastTriggerConfigMutation = useMutation({
    mutationFn: settingsApi.updateMessageAutomationPastTriggerConfig,
    onSuccess: (savedConfig) => {
      queryClient.setQueryData<MessageAutomationPoliciesResponse>(
        ["settings", "message-automation-policies"],
        (current) => current ? { ...current, pastTriggerConfig: savedConfig } : current,
      );
      setDraftRetroactiveRuleOrderIds(null);
      setDraftRetroactiveSendIntervalMinutes(null);
      toast({ description: "지난 자동 전송 설정이 저장되었습니다." });
    },
    onError: () => {
      toast({
        variant: "destructive",
        description: "지난 자동 전송 설정 저장 중 오류가 발생했습니다.",
      });
    },
  });

  const updateClientRegistrationPolicyMutation = useMutation({
    mutationFn: settingsApi.updateClientRegistrationPolicy,
    onMutate: async (patch: ClientRegistrationPolicyPatch) => {
      await queryClient.cancelQueries({ queryKey: ["settings", "client-registration-policy"] });
      const previous = queryClient.getQueryData<ClientRegistrationPolicy>([
        "settings",
        "client-registration-policy",
      ]);
      queryClient.setQueryData<ClientRegistrationPolicy>(
        ["settings", "client-registration-policy"],
        (current) => current ? { ...current, ...patch } : current,
      );
      return { previous };
    },
    onError: (_error, _patch, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["settings", "client-registration-policy"], context.previous);
      }
      toast({ variant: "destructive", description: "고객 자동 등록 설정 저장 중 오류가 발생했습니다." });
    },
    onSuccess: (savedPolicy) => {
      queryClient.setQueryData(["settings", "client-registration-policy"], savedPolicy);
      toast({ description: "고객 자동 등록 설정이 저장되었습니다." });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["settings", "client-registration-policy"] });
    },
  });

  const handleSubmit = () => {
    if (!allAgreed) {
      toast({ variant: "destructive", description: "알리고 정책 동의 항목을 모두 확인해 주세요." });
      return;
    }

    requestApprovalMutation.mutate();
  };
  const handleSavePastTriggerConfig = () => {
    const sendIntervalMinutes = Number(retroactiveSendIntervalMinutes);
    if (!Number.isInteger(sendIntervalMinutes) || sendIntervalMinutes < 1) {
      toast({ variant: "destructive", description: "전송 간격은 1분 이상이어야 합니다." });
      return;
    }

    savePastTriggerConfigMutation.mutate({
      sendIntervalMinutes,
      ruleOrder: retroactiveTriggerOrderItems.map((item) => item.id),
    });
  };
  const emptyListMessage = isMessageSenderApprovalLoading
    ? "설정 정보를 불러오는 중입니다."
    : "표시할 설정 항목이 없습니다.";
  const emptyDetailMessage = isMessageSenderApprovalLoading
    ? "설정 정보를 불러오는 중입니다."
    : "설정 항목을 선택해 주세요.";

  if (isMessageSenderApprovalLoading) {
    return (
      <div
        data-component="messages-settings-layout"
        className="grid min-h-[560px] flex-1 gap-6 lg:grid-cols-[380px_1fr]"
      >
        <ListPanel data-component="desktop_messages_split-layout_list-panel"
          title="설정"
          subtitle="메시지에 관련된 설정들을 정할 수 있어요"
          headerActions={
            <span className="inline-flex items-center whitespace-nowrap rounded-full bg-v3-primary-light px-3 py-1 text-[0.72rem] font-semibold text-v3-primary">
              {listItems.length}개
            </span>
          }
        >
          <ListEmptyState
            message={emptyListMessage}
          />
        </ListPanel>

        <DetailPanel data-component="desktop_messages_split-layout_detail-panel"
          title="설정"
          subtitle="메시지에 관련된 설정들을 정할 수 있어요"
        >
          <DetailEmptyState
            name="messages-settings-detail-empty"
            message={emptyDetailMessage}
          />
        </DetailPanel>
      </div>
    );
  }

  return (
    <div
      data-component="messages-settings-tenant-application"
      className="grid min-h-[560px] flex-1 gap-6 lg:grid-cols-[380px_1fr]"
    >
      <ListPanel data-component="desktop_messages_split-layout_list-panel-2"
        title="설정"
        subtitle="메시지에 관련된 설정들을 정할 수 있어요"
        headerActions={
          <span className="inline-flex items-center whitespace-nowrap rounded-full bg-v3-primary-light px-3 py-1 text-[0.72rem] font-semibold text-v3-primary">
            {listItems.length}개
          </span>
        }
      >
        <AnimatedSlotList<TenantApplicationListItem>
          items={listItems}
          isLoading={false}
          className="space-y-2"
          getSlotState={({ item }) => ({
            isActive: item?.id === selectedItem?.id,
            isInteractive: Boolean(item),
          })}
          onSlotClick={(item) => setSelectedItemId(item.id)}
          render={({ item }) => {
            if (!item) return null;

            return (
              <AnimatedSlotListItemContent
                dataComponent="messages-settings-tenant-list"
                icon={item.icon}
                iconContainerClassName="bg-white text-v3-primary"
                title={item.title}
                subtitle={item.subtitle}
                status={
                  item.kind === "tenant-application" ? (
                    <span className="inline-flex items-center rounded-full bg-white/85 px-2 py-0.5 text-[0.68rem] font-semibold text-v3-primary">
                      {item.statusLabel}
                    </span>
                  ) : (
                    <Switch
                      aria-label={`${item.title} 활성화`}
                      checked={item.requiresApproval ? (isMessageSenderApproved && item.active) : item.active}
                      disabled
                      onClick={(event) => event.stopPropagation()}
                      className="ml-auto shrink-0"
                    />
                  )
                }
              />
            );
          }}
        />
      </ListPanel>

      {selectedItem?.kind === "automation-policy" ? (
        <DetailPanel data-component="desktop_messages_split-layout_detail-panel-2"
          avatar={
            <div className="flex h-12 w-12 items-center justify-center rounded-[16px] bg-v3-primary-light text-v3-primary">
              <SelectedItemIcon className="h-5 w-5" />
            </div>
          }
          title={selectedItem.title}
          subtitle={selectedItem.subtitle}
          trailing={
            <span className="inline-flex items-center rounded-full bg-v3-primary-light px-3 py-1 text-[0.72rem] font-semibold text-v3-primary">
              {selectedItem.statusLabel}
            </span>
          }
          footer={selectedItem.id === PAST_TRIGGER_POLICY_ID ? (
            <div
              data-component="messages-settings-past-trigger-policy-footer"
              className="ml-auto flex shrink-0 flex-wrap justify-end gap-[calc(12px*var(--glint-ui-scale,1))]"
            >
              <Button
                type="button"
                variant="positive"
                onClick={handleSavePastTriggerConfig}
                disabled={!canSavePastTriggerConfig || savePastTriggerConfigMutation.isPending}
                data-component="messages-settings-past-trigger-policy-save"
                className="shrink-0"
              >
                <Send className="h-4 w-4" />
                {savePastTriggerConfigMutation.isPending ? "저장 중..." : "저장"}
              </Button>
            </div>
          ) : undefined}
        >
          <div data-component={getAutomationPolicyDataComponent(selectedItem.id)} className="space-y-4">
            <InfoCard
              data-component={`${getAutomationPolicyDataComponent(selectedItem.id)}-card`}
              title="규칙"
            >
              <div className="-mt-1">
                {(selectedItem.rows ?? []).map((item) => (
                  <InfoRow
                    key={item.id}
                    data-component={`${getAutomationPolicyDataComponent(selectedItem.id)}-${item.id}`}
                    label={item.label}
                    value={item.value}
                  />
                ))}
                {selectedItem.id === PAST_TRIGGER_POLICY_ID ? (
                  <InfoRow
                    data-component="messages-settings-past-trigger-policy-send-interval"
                    label="전송 간격"
                    value={
                      <div className="flex min-w-0 items-center justify-end gap-2">
                        <Input
                          aria-label="늦은 등록 자동 전송 간격"
                          inputMode="numeric"
                          min={1}
                          onChange={(event) => updateRetroactiveSendIntervalMinutes(event.target.value)}
                          step={1}
                          type="number"
                          value={retroactiveSendIntervalMinutes}
                          variant="v3"
                          className="h-9 w-20 shrink-0 text-center"
                        />
                        <span className="shrink-0 text-[0.8rem] font-semibold text-v3-text-muted">분</span>
                      </div>
                    }
                  />
                ) : null}
              </div>
            </InfoCard>

            {selectedItem.id === PAST_TRIGGER_POLICY_ID ? (
              <InfoCard
                data-component="messages-settings-past-trigger-policy-order-card"
                title="늦은 등록 자동 전송 순서"
              >
                <div
                  data-component="messages-settings-past-trigger-policy-order-form"
                  className="-mt-1"
                >
                  {isTriggerRulesLoading ? (
                    <InfoRow
                      data-component="messages-settings-past-trigger-policy-order-loading"
                      label="상태"
                      value="자동 전송 루틴을 불러오는 중"
                    />
                  ) : retroactiveTriggerOrderItems.length > 0 ? retroactiveTriggerOrderItems.map((item, index) => (
                    <InfoRow
                      key={item.id}
                      data-component={`messages-settings-past-trigger-policy-order-${item.id}`}
                      label={`${index + 1}순위`}
                      value={
                        <div className="flex min-w-0 items-center justify-end gap-2">
                          <div className="min-w-0 text-right">
                            <span className="block truncate">{item.name}</span>
                            <span className="block truncate text-[0.7rem] font-medium text-v3-text-muted">
                              {getTriggerRuleSummary(item)}
                            </span>
                          </div>
                          <Input
                            aria-label={`${item.name} 순서`}
                            readOnly
                            type="number"
                            value={index + 1}
                            variant="v3"
                            className="h-9 w-14 shrink-0 text-center"
                          />
                          <Button
                            aria-label={`${item.name} 위로 이동`}
                            disabled={index === 0}
                            onClick={() => moveRetroactiveRuleOrder(item.id, -1)}
                            type="button"
                            variant="neutral"
                            size="icon"
                            className="h-9 w-9 shrink-0"
                          >
                            <ArrowUp className="h-4 w-4" />
                          </Button>
                          <Button
                            aria-label={`${item.name} 아래로 이동`}
                            disabled={index === retroactiveTriggerOrderItems.length - 1}
                            onClick={() => moveRetroactiveRuleOrder(item.id, 1)}
                            type="button"
                            variant="neutral"
                            size="icon"
                            className="h-9 w-9 shrink-0"
                          >
                            <ArrowDown className="h-4 w-4" />
                          </Button>
                        </div>
                      }
                    />
                  )) : (
                    <InfoRow
                      data-component="messages-settings-past-trigger-policy-order-empty"
                      label="루틴"
                      value="등록된 자동 전송 루틴 없음"
                    />
                  )}
                </div>
              </InfoCard>
            ) : null}
          </div>
        </DetailPanel>
      ) : selectedItem?.kind === "client-registration-policy" ? (
        <DetailPanel data-component="desktop_messages_split-layout_detail-panel-3"
          avatar={<div className="flex h-12 w-12 items-center justify-center rounded-[16px] bg-v3-primary-light text-v3-primary"><UserPlus className="h-5 w-5" /></div>}
          title="고객 자동 등록"
          subtitle="전자문서 고객 등록과 인사 문자 발송을 관리합니다."
        >
          <InfoCard data-component="messages-settings-client-registration-policy-card" title="고객 자동 등록">
            <div className="-mt-1">
              <InfoRow
                data-component="messages-settings-client-auto-registration"
                label="전자문서 생성 시 고객 자동 등록"
                value={<Switch aria-label="전자문서 생성 시 고객 자동 등록" checked={clientRegistrationPolicy?.clientAutoRegistration === true} disabled={!clientRegistrationPolicy || updateClientRegistrationPolicyMutation.isPending} onCheckedChange={(checked) => updateClientRegistrationPolicyMutation.mutate({ clientAutoRegistration: checked })} />}
              />
              <InfoRow
                data-component="messages-settings-greeting-on-auto-registration"
                label="자동 등록 시 인사 문자 발송"
                value={<Switch aria-label="자동 등록 시 인사 문자 발송" checked={clientRegistrationPolicy?.greetingOnAutoRegistration === true} disabled={!clientRegistrationPolicy?.clientAutoRegistration || updateClientRegistrationPolicyMutation.isPending} onCheckedChange={(checked) => updateClientRegistrationPolicyMutation.mutate({ greetingOnAutoRegistration: checked })} />}
              />
            </div>
          </InfoCard>
        </DetailPanel>
      ) : selectedItem?.kind === "duplicate-send-policy" ? (
        <DetailPanel data-component="desktop_messages_split-layout_detail-panel-4"
          avatar={
            <div className="flex h-12 w-12 items-center justify-center rounded-[16px] bg-v3-primary-light text-v3-primary">
              <Repeat2 className="h-5 w-5" />
            </div>
          }
          title="중복 전송 확인"
          subtitle="같은 번호에 같은 메시지를 짧은 시간 안에 다시 보낼 때 재확인합니다."
          trailing={
            <span className="inline-flex items-center rounded-full bg-v3-primary-light px-3 py-1 text-[0.72rem] font-semibold text-v3-primary">
              활성
            </span>
          }
        >
          <div data-component="messages-settings-duplicate-send-policy" className="space-y-4">
            <InfoCard
              data-component="messages-settings-duplicate-send-policy-card"
              title="규칙"
            >
              <div className="-mt-1">
                <InfoRow
                  data-component="messages-settings-duplicate-send-policy-condition"
                  label="조건"
                  value="같은 번호 · 같은 메시지"
                />
                <InfoRow
                  data-component="messages-settings-duplicate-send-policy-window"
                  label="확인 범위"
                  value="최근 72시간"
                />
                <InfoRow
                  data-component="messages-settings-duplicate-send-policy-action"
                  label="동작"
                  value="전송 전 확인 모달"
                />
              </div>
            </InfoCard>

            <div
              data-component="messages-settings-duplicate-send-policy-preview"
              className="rounded-[18px] border border-v3-border bg-white p-4"
            >
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] bg-v3-primary-light text-v3-primary">
                  <Clock3 className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-[0.82rem] font-semibold text-v3-dark">중복 전송 확인</p>
                  <p className="mt-1 text-[0.74rem] leading-5 text-v3-text-muted">
                    최근 같은 내용의 메시지를 보낸 기록이 있으면, 발송 버튼을 누른 뒤 최근 전송 시각과 함께 재전송 여부를 확인합니다.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </DetailPanel>
      ) : (
        <DetailPanel data-component="desktop_messages_split-layout_detail-panel-5"
          avatar={
            <div className="flex h-12 w-12 items-center justify-center rounded-[16px] bg-v3-primary-light text-v3-primary">
              <ShieldCheck className="h-5 w-5" />
            </div>
          }
          title="메시지 발송 기능 신청"
          subtitle="메시지 발송 기능 사용을 위해 아래의 항목들을 확인 및 동의해 주세요."
          trailing={
            requestedAt ? (
              <span className="inline-flex items-center rounded-full bg-v3-primary-light px-3 py-1 text-[0.72rem] font-semibold text-v3-primary">
                접수 {requestedAt}
              </span>
            ) : undefined
          }
        >
          <div data-component="messages-settings-tenant-form" className="space-y-5 pb-2">
            <div
              data-component="messages-settings-tenant-card"
              className="rounded-[18px] border border-v3-border bg-v3-dim-white/35 p-4"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] bg-white text-v3-primary shadow-sm">
                  <Building2 className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex h-11 items-center">
                  <p className="text-[0.92rem] font-semibold leading-none text-v3-dark">{tenantName}</p>
                </div>
              </div>
            </div>

            <div
              data-component="messages-settings-tenant-sender-info"
              className="rounded-[18px] border border-v3-border bg-v3-dim-white/35 p-4"
            >
              <p className="text-[0.76rem] font-semibold text-v3-dark">발신번호</p>
              <p className="mt-1 text-[1rem] font-semibold text-v3-primary">{UNIFIED_SENDER_PHONE}</p>
              <p className="mt-1 text-[0.72rem] leading-5 text-v3-text-muted">
                모든 메시지는 사전 등록된 대표 발신번호 {UNIFIED_SENDER_PHONE} 으로 발송됩니다. 별도의 발신번호 입력이 필요하지 않습니다.
              </p>
            </div>

            <div data-component="messages-settings-tenant-agreements" className="space-y-3">
              {ALIGO_POLICY_ITEMS.map((policy) => {
                const checked = agreements[policy.id];

                return (
                  <label
                    key={policy.id}
                    htmlFor={policy.id}
                    className={cn(
                      "block cursor-pointer rounded-[18px] border px-4 py-3 transition-colors",
                      checked
                        ? "border-v3-primary bg-v3-primary-light/60"
                        : "border-v3-border bg-white hover:border-v3-primary/30 hover:bg-v3-primary-light/20",
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <Checkbox
                        id={policy.id}
                        checked={checked}
                        onCheckedChange={(value) => toggleAgreement(policy.id, value === true)}
                        className="mt-0.5"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-[0.76rem] leading-5 text-v3-dark">{policy.text}</p>
                        <a
                          href={policy.sourceHref}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-2 inline-flex items-center gap-1 text-[0.7rem] font-semibold text-v3-primary hover:underline"
                        >
                          {policy.sourceLabel}
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>

            <Button
              data-component="messages-settings-tenant-submit"
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="h-11 w-full rounded-[14px]"
            >
              <Send className="h-4 w-4" />
              메시지 발송 신청하기
            </Button>

            {requestedAt ? (
              <div
                data-component="messages-settings-tenant-success"
                className="rounded-[18px] border border-emerald-200 bg-emerald-50 px-4 py-3"
              >
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="mt-0.5 h-4.5 w-4.5 text-emerald-600" />
                  <div>
                    <p className="text-[0.78rem] font-semibold text-emerald-700">신청 접수 완료</p>
                    <p className="mt-1 text-[0.72rem] leading-5 text-emerald-700/90">
                      {tenantName} 기준 신청이 접수되었습니다. 접수 시각: {requestedAt}
                    </p>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </DetailPanel>
      )}
    </div>
  );
}
