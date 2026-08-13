"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp } from "lucide-react";
import { useDebouncedCallback } from "use-debounce";
import {
  MESSAGE_EVENT_LABELS,
  MESSAGE_RECIPIENT_LABELS,
  isSmsTriggerTemplate,
} from "@babyjamjam/shared";
import { mergeRuleOrder } from "@babyjamjam/shared/utils/rule-order";
import type {
  MessageAutomationPastTriggerConfig,
  MessageAutomationPoliciesResponse,
  MessageAutomationPolicy,
  MessageTriggerEventType,
  MessageTriggerOffsetType,
  MessageTriggerRule,
} from "@babyjamjam/shared/types/message";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useMessageTriggerRules } from "@/features/message-triggers/hooks/use-message-triggers";
import { useToast } from "@/hooks/use-toast";
import { settingsApi } from "@/services/api";

import { PolicyInfoRows } from "./PolicyInfoRows";
import { getOrderedTriggerRules } from "./settings-items";

const MESSAGE_AUTOMATION_POLICIES_QUERY_KEY = [
  "settings",
  "message-automation-policies",
] as const;
const MIN_SEND_INTERVAL_MINUTES = 1;
const MAX_SEND_INTERVAL_MINUTES = 1_440;
const SOURCE_COMPONENT = "PastTriggerPolicyDetail";

const TRIGGER_OFFSET_LABELS: Record<
  MessageTriggerEventType,
  Record<MessageTriggerOffsetType, string>
> = {
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

export interface PastTriggerPolicyDetailProps {
  "data-component": string;
  policy: MessageAutomationPolicy;
  pastTriggerConfig: MessageAutomationPastTriggerConfig;
}

interface PastTriggerMutationContext {
  previous: MessageAutomationPoliciesResponse | undefined;
}

function formatTriggerOffset(rule: MessageTriggerRule): string {
  const offsetLabel = TRIGGER_OFFSET_LABELS[rule.eventType][rule.offsetType];

  if (rule.offsetType === "BEFORE_DAYS" || rule.offsetType === "AFTER_DAYS") {
    return offsetLabel.replace("N", String(rule.offsetDays || 0));
  }

  return offsetLabel;
}

function getTriggerRuleSummary(rule: MessageTriggerRule): string {
  return `${MESSAGE_EVENT_LABELS[rule.eventType]} · ${formatTriggerOffset(rule)} · ${MESSAGE_RECIPIENT_LABELS[rule.recipientType]}`;
}

function parseSendInterval(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;

  const parsed = Number(value);
  if (
    !Number.isInteger(parsed) ||
    parsed < MIN_SEND_INTERVAL_MINUTES ||
    parsed > MAX_SEND_INTERVAL_MINUTES
  ) {
    return null;
  }

  return parsed;
}

export function PastTriggerPolicyDetail({
  "data-component": dataComponent,
  policy,
  pastTriggerConfig,
}: PastTriggerPolicyDetailProps): ReactElement {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: triggerRules = [], isLoading: isTriggerRulesLoading } =
    useMessageTriggerRules();
  const [draftInterval, setDraftInterval] = useState(() =>
    String(pastTriggerConfig.sendIntervalMinutes),
  );
  const [draftRuleOrder, setDraftRuleOrder] = useState<string[] | null>(null);
  const draftIntervalRef = useRef(draftInterval);
  const draftRuleOrderRef = useRef<string[] | null>(null);
  const effectiveOrderIdsRef = useRef<string[]>([]);
  const configRef = useRef(pastTriggerConfig);
  const lastSyncedConfigRef = useRef(pastTriggerConfig);
  const queuedRef = useRef(false);
  const isPersistingRef = useRef(false);
  const persistRef = useRef<() => void>(() => undefined);
  const intervalInputId = useId();
  const intervalHelperId = `${intervalInputId}-helper`;
  const sub = (suffix: string) => `${dataComponent}_${suffix}`;

  const activeSmsRules = useMemo(
    () =>
      triggerRules.filter(
        (rule) => rule.isActive && isSmsTriggerTemplate(rule.templateKey),
      ),
    [triggerRules],
  );
  const orderedRules = useMemo(
    () =>
      getOrderedTriggerRules(
        activeSmsRules,
        draftRuleOrder ?? pastTriggerConfig.ruleOrder,
      ),
    [activeSmsRules, draftRuleOrder, pastTriggerConfig.ruleOrder],
  );
  const effectiveOrderIds = orderedRules.map((rule) => rule.id);
  const isIntervalValid = parseSendInterval(draftInterval) !== null;

  useEffect(() => {
    configRef.current = pastTriggerConfig;
  }, [pastTriggerConfig]);

  useEffect(() => {
    effectiveOrderIdsRef.current = effectiveOrderIds;
  }, [effectiveOrderIds]);

  const saveMutation = useMutation<
    MessageAutomationPastTriggerConfig,
    Error,
    MessageAutomationPastTriggerConfig,
    PastTriggerMutationContext
  >({
    mutationFn: settingsApi.updateMessageAutomationPastTriggerConfig,
    onMutate: async (nextConfig) => {
      isPersistingRef.current = true;
      await queryClient.cancelQueries({
        queryKey: MESSAGE_AUTOMATION_POLICIES_QUERY_KEY,
      });
      const previous =
        queryClient.getQueryData<MessageAutomationPoliciesResponse>(
          MESSAGE_AUTOMATION_POLICIES_QUERY_KEY,
        );
      queryClient.setQueryData<MessageAutomationPoliciesResponse>(
        MESSAGE_AUTOMATION_POLICIES_QUERY_KEY,
        (current) =>
          current ? { ...current, pastTriggerConfig: nextConfig } : current,
      );
      return { previous };
    },
    onError: (_error, _nextConfig, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          MESSAGE_AUTOMATION_POLICIES_QUERY_KEY,
          context.previous,
        );
        const revertedConfig = context.previous.pastTriggerConfig;
        configRef.current = revertedConfig;
        lastSyncedConfigRef.current = revertedConfig;
        draftIntervalRef.current = String(revertedConfig.sendIntervalMinutes);
        // Rollback also resets drafts so the editor matches the restored cache baseline.
        setDraftInterval(String(revertedConfig.sendIntervalMinutes));
        draftRuleOrderRef.current = null;
        setDraftRuleOrder(null);
      }
      queuedRef.current = false;
      toast({
        variant: "destructive",
        description: "지난 자동 전송 설정을 저장하지 못했어요",
      });
    },
    onSuccess: (nextConfig) => {
      configRef.current = nextConfig;
      queryClient.setQueryData<MessageAutomationPoliciesResponse>(
        MESSAGE_AUTOMATION_POLICIES_QUERY_KEY,
        (current) =>
          current ? { ...current, pastTriggerConfig: nextConfig } : current,
      );
    },
    onSettled: () => {
      isPersistingRef.current = false;
      void queryClient.invalidateQueries({
        queryKey: MESSAGE_AUTOMATION_POLICIES_QUERY_KEY,
      });

      if (queuedRef.current) {
        queuedRef.current = false;
        persistRef.current();
      }
    },
  });

  const persist = useCallback(() => {
    const parsedInterval = parseSendInterval(draftIntervalRef.current);
    if (isPersistingRef.current) {
      queuedRef.current = true;
      return;
    }

    const config = configRef.current;
    const latestOrderIds =
      draftRuleOrderRef.current ?? effectiveOrderIdsRef.current;
    const nextRuleOrder = mergeRuleOrder(config.ruleOrder, latestOrderIds);
    const nextInterval =
      parsedInterval ?? config.sendIntervalMinutes;
    const hasIntervalChange =
      parsedInterval !== null && parsedInterval !== config.sendIntervalMinutes;
    const hasOrderChange =
      nextRuleOrder.length !== config.ruleOrder.length ||
      nextRuleOrder.some((ruleId, index) => ruleId !== config.ruleOrder[index]);

    if (!hasIntervalChange && !hasOrderChange) {
      return;
    }

    isPersistingRef.current = true;
    saveMutation.mutate({
      sendIntervalMinutes: nextInterval,
      ruleOrder: nextRuleOrder,
    });
  }, [saveMutation]);

  useEffect(() => {
    persistRef.current = persist;
  }, [persist]);

  const debouncedOrderPersist = useDebouncedCallback(
    () => persistRef.current(),
    300,
  );
  const debouncedIntervalPersist = useDebouncedCallback(
    () => persistRef.current(),
    600,
  );

  useEffect(() => {
    return () => {
      // Flush pending autosaves; mutation settlement already supports post-unmount replay.
      debouncedOrderPersist.flush();
      debouncedIntervalPersist.flush();
    };
  }, [debouncedIntervalPersist, debouncedOrderPersist]);

  useEffect(() => {
    const hasPendingIntervalEdit =
      draftInterval === "" || !isIntervalValid;
    const hasPendingWork =
      debouncedOrderPersist.isPending() ||
      debouncedIntervalPersist.isPending() ||
      saveMutation.isPending ||
      queuedRef.current ||
      hasPendingIntervalEdit;

    if (
      lastSyncedConfigRef.current === pastTriggerConfig ||
      hasPendingWork
    ) {
      return;
    }

    lastSyncedConfigRef.current = pastTriggerConfig;
    const nextInterval = String(pastTriggerConfig.sendIntervalMinutes);
    draftIntervalRef.current = nextInterval;
    draftRuleOrderRef.current = null;
    // A fully idle editor adopts the latest server-owned baseline.
    /* eslint-disable react-hooks/set-state-in-effect -- Server-owned props intentionally reset the idle editor. */
    setDraftInterval(nextInterval);
    setDraftRuleOrder(null);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [
    debouncedIntervalPersist,
    debouncedOrderPersist,
    draftInterval,
    isIntervalValid,
    pastTriggerConfig,
    saveMutation.isPending,
  ]);

  const moveRule = (ruleId: string, direction: -1 | 1) => {
    const currentIndex = effectiveOrderIds.indexOf(ruleId);
    const nextIndex = currentIndex + direction;

    if (
      currentIndex < 0 ||
      nextIndex < 0 ||
      nextIndex >= effectiveOrderIds.length
    ) {
      return;
    }

    const nextOrderIds = [...effectiveOrderIds];
    [nextOrderIds[currentIndex], nextOrderIds[nextIndex]] = [
      nextOrderIds[nextIndex],
      nextOrderIds[currentIndex],
    ];
    effectiveOrderIdsRef.current = nextOrderIds;
    draftRuleOrderRef.current = nextOrderIds;
    setDraftRuleOrder(nextOrderIds);
    debouncedOrderPersist();
  };

  return (
    <div
      data-component={dataComponent}
      data-slot="past-trigger-policy-detail"
      data-source-component={SOURCE_COMPONENT}
      className="flex flex-col gap-[calc(12px*var(--glint-ui-scale,1))]"
    >
      <PolicyInfoRows data-component={sub("rules")} rows={policy.rows} />

      <section
        data-component={sub("interval")}
        data-slot="info-card"
        className="info-card !flex !flex-col !gap-[calc(8px*var(--glint-ui-scale,1))] !rounded-[calc(18px*var(--glint-ui-scale,1))] !px-[calc(16px*var(--glint-ui-scale,1))] !py-[calc(14px*var(--glint-ui-scale,1))]"
      >
        <label
          data-component={sub("interval_title")}
          data-slot="info-card-title"
          className="info-card-title !mb-0 !text-[calc(0.6rem*var(--glint-ui-scale,1))]"
          htmlFor={intervalInputId}
        >
          전송 간격
        </label>
        <div
          data-component={sub("interval_field")}
          className="flex items-center gap-[calc(8px*var(--glint-ui-scale,1))]"
        >
          <Input
            id={intervalInputId}
            data-component={sub("interval_field_input")}
            aria-describedby={intervalHelperId}
            aria-invalid={draftInterval !== "" && !isIntervalValid}
            aria-label="늦은 등록 자동 전송 간격"
            inputMode="numeric"
            pattern="[0-9]*"
            type="text"
            value={draftInterval}
            variant="v3"
            error={draftInterval !== "" && !isIntervalValid}
            className="!h-[calc(44px*var(--glint-ui-scale,1))] !w-[calc(104px*var(--glint-ui-scale,1))] !rounded-[calc(12px*var(--glint-ui-scale,1))] !px-[calc(12px*var(--glint-ui-scale,1))] !text-center !text-[calc(0.9rem*var(--glint-ui-scale,1))]"
            onChange={(event) => {
              const nextInterval = event.target.value.replace(/\D/g, "");
              draftIntervalRef.current = nextInterval;
              setDraftInterval(nextInterval);

              if (parseSendInterval(nextInterval) !== null) {
                debouncedIntervalPersist();
              } else {
                debouncedIntervalPersist.cancel();
              }
            }}
          />
          <span
            data-component={sub("interval_field_unit")}
            className="text-[calc(0.78rem*var(--glint-ui-scale,1))] font-semibold text-v3-dark"
          >
            분
          </span>
        </div>
        <p
          id={intervalHelperId}
          data-component={sub("interval_helper")}
          className="text-[calc(0.66rem*var(--glint-ui-scale,1))] font-medium leading-[calc(0.98rem*var(--glint-ui-scale,1))] text-v3-text-muted"
        >
          1~1440분
        </p>
      </section>

      <section
        data-component={sub("order")}
        data-slot="info-card"
        className="info-card !rounded-[calc(18px*var(--glint-ui-scale,1))] !px-[calc(16px*var(--glint-ui-scale,1))] !py-[calc(14px*var(--glint-ui-scale,1))]"
        aria-busy={isTriggerRulesLoading}
      >
        <div
          data-component={sub("order_title")}
          data-slot="info-card-title"
          className="info-card-title !mb-[calc(8px*var(--glint-ui-scale,1))] !text-[calc(0.6rem*var(--glint-ui-scale,1))]"
        >
          늦은 등록 자동 전송 순서
        </div>

        {isTriggerRulesLoading ? (
          <div
            data-component={sub("order_loading")}
            data-slot="info-row"
            className="info-row !flex !w-full !flex-col !gap-[calc(6px*var(--glint-ui-scale,1))] !py-[calc(8px*var(--glint-ui-scale,1))]"
            role="status"
          >
            <Skeleton
              data-component={sub("order_loading_skeleton")}
              className="h-[calc(36px*var(--glint-ui-scale,1))] w-full rounded-[calc(10px*var(--glint-ui-scale,1))]"
            />
            <span className="text-[calc(0.66rem*var(--glint-ui-scale,1))] font-medium text-v3-text-muted">
              자동 전송 루틴을 불러오는 중
            </span>
          </div>
        ) : orderedRules.length > 0 ? (
          <ol data-component={sub("order_list")} className="flex list-none flex-col">
            {orderedRules.map((rule, index) => {
              const rowDataComponent = sub(`order_list_${rule.id}`);

              return (
                <li
                  key={rule.id}
                  data-component={rowDataComponent}
                  data-slot="info-row"
                  className="info-row !flex !items-center !gap-[calc(8px*var(--glint-ui-scale,1))] !py-[calc(8px*var(--glint-ui-scale,1))]"
                >
                  <span
                    data-component={`${rowDataComponent}_rank`}
                    className="w-[calc(20px*var(--glint-ui-scale,1))] shrink-0 text-center text-[calc(0.72rem*var(--glint-ui-scale,1))] font-bold text-v3-primary"
                  >
                    {index + 1}
                  </span>
                  <span
                    data-component={`${rowDataComponent}_copy`}
                    className="flex min-w-0 flex-1 flex-col gap-[calc(2px*var(--glint-ui-scale,1))]"
                  >
                    <span
                      data-component={`${rowDataComponent}_copy_title`}
                      className="truncate text-[calc(0.72rem*var(--glint-ui-scale,1))] font-bold leading-[calc(1rem*var(--glint-ui-scale,1))] text-v3-dark"
                    >
                      {rule.name}
                    </span>
                    <span
                      data-component={`${rowDataComponent}_copy_summary`}
                      className="truncate text-[calc(0.62rem*var(--glint-ui-scale,1))] font-medium leading-[calc(0.9rem*var(--glint-ui-scale,1))] text-v3-text-muted"
                    >
                      {getTriggerRuleSummary(rule)}
                    </span>
                  </span>
                  <span
                    data-component={`${rowDataComponent}_actions`}
                    className="flex shrink-0 gap-[calc(4px*var(--glint-ui-scale,1))]"
                  >
                    <Button
                      type="button"
                      data-component={`${rowDataComponent}_actions_up`}
                      aria-label={`${rule.name} 위로 이동`}
                      disabled={index === 0}
                      variant="v3-soft"
                      size="icon"
                      className="!h-[calc(44px*var(--glint-ui-scale,1))] !w-[calc(44px*var(--glint-ui-scale,1))] !rounded-full !p-0 [&_svg]:!h-[calc(16px*var(--glint-ui-scale,1))] [&_svg]:!w-[calc(16px*var(--glint-ui-scale,1))]"
                      onClick={() => moveRule(rule.id, -1)}
                    >
                      <ArrowUp aria-hidden="true" size={16} />
                    </Button>
                    <Button
                      type="button"
                      data-component={`${rowDataComponent}_actions_down`}
                      aria-label={`${rule.name} 아래로 이동`}
                      disabled={index === orderedRules.length - 1}
                      variant="v3-soft"
                      size="icon"
                      className="!h-[calc(44px*var(--glint-ui-scale,1))] !w-[calc(44px*var(--glint-ui-scale,1))] !rounded-full !p-0 [&_svg]:!h-[calc(16px*var(--glint-ui-scale,1))] [&_svg]:!w-[calc(16px*var(--glint-ui-scale,1))]"
                      onClick={() => moveRule(rule.id, 1)}
                    >
                      <ArrowDown aria-hidden="true" size={16} />
                    </Button>
                  </span>
                </li>
              );
            })}
          </ol>
        ) : (
          <div
            data-component={sub("order_empty")}
            data-slot="info-row"
            className="info-row !justify-center !py-[calc(12px*var(--glint-ui-scale,1))] text-center text-[calc(0.7rem*var(--glint-ui-scale,1))] font-medium text-v3-text-muted"
          >
            등록된 자동 전송 루틴 없음
          </div>
        )}
      </section>

    </div>
  );
}
