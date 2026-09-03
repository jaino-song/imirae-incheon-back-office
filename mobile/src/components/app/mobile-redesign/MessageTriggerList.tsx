"use client";

import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { MessageSquareText, type LucideIcon } from "lucide-react";
import {
  MESSAGE_EVENT_LABELS,
  MESSAGE_RECIPIENT_LABELS,
  getMessageTemplateLabel,
} from "@babyjamjam/shared";

import { Skeleton } from "@/components/ui/skeleton";
import {
  useMessageTriggerRules,
  useUpdateMessageTriggerRule,
} from "@/features/message-triggers/hooks/use-message-triggers";
import type {
  MessageTriggerRule,
  TriggerEventType,
} from "@/features/message-triggers/types";
import { fetchAllMessageLogs } from "@/lib/messages/logs";
import "@/components/app/mobile-redesign/redesign.css";

interface MessageLogRecord {
  id: number;
  templateKey: string;
  status: "pending" | "sent" | "failed";
  createdAt: string;
  ruleId: string | null;
  ruleName: string | null;
  eventType: TriggerEventType | null;
}

interface BaseTriggerDisplayRow {
  title: string;
  timingLabel: string;
  channelLabel: "SMS";
  icon: LucideIcon;
  tone: "primary" | "orange" | "green" | "purple";
  monthlyCount: number | null;
  failedCount: number | null;
}

interface LiveTriggerDisplayRow extends BaseTriggerDisplayRow {
  kind: "live";
  rule: MessageTriggerRule;
}

type TriggerDisplayRow = LiveTriggerDisplayRow;

const EVENT_SORT_ORDER: Record<TriggerEventType, number> = {
  CLIENT_CREATED: 0,
  SERVICE_START: 1,
  SERVICE_END: 2,
  EMPLOYEE_ASSIGNED: 3,
};

function getRuleTitle(rule: MessageTriggerRule) {
  return rule.name.trim() || getMessageTemplateLabel(rule.templateKey);
}

function getRuleTimingLabel(rule: MessageTriggerRule) {
  const eventLabel = MESSAGE_EVENT_LABELS[rule.eventType];

  if (rule.offsetType === "IMMEDIATE") {
    return `${eventLabel} 즉시`;
  }

  if (rule.offsetType === "SAME_DAY") {
    return `${eventLabel} 당일`;
  }

  const dayLabel = `${Math.max(rule.offsetDays, 0)}일`;
  if (rule.offsetType === "BEFORE_DAYS") {
    return `${eventLabel} ${dayLabel} 전`;
  }

  return `${eventLabel} ${dayLabel} 후`;
}

function isCurrentMonthLog(log: MessageLogRecord) {
  const createdAt = new Date(log.createdAt);
  const now = new Date();

  return (
    !Number.isNaN(createdAt.getTime())
    && createdAt.getFullYear() === now.getFullYear()
    && createdAt.getMonth() === now.getMonth()
  );
}

function matchesTriggerLog(log: MessageLogRecord, rule: MessageTriggerRule) {
  if (log.ruleId) {
    return log.ruleId === rule.id;
  }

  return (
    log.ruleName === rule.name
    || (
      log.templateKey === rule.templateKey
      && log.eventType === rule.eventType
    )
  );
}

function getMonthLabel() {
  return new Intl.DateTimeFormat("ko-KR", { month: "numeric" }).format(new Date());
}

function compareTriggerRules(first: MessageTriggerRule, second: MessageTriggerRule) {
  const eventOrder = EVENT_SORT_ORDER[first.eventType] - EVENT_SORT_ORDER[second.eventType];
  if (eventOrder !== 0) return eventOrder;

  const offsetOrder = first.offsetDays - second.offsetDays;
  if (offsetOrder !== 0) return offsetOrder;

  return getRuleTitle(first).localeCompare(getRuleTitle(second), "ko-KR");
}

export function MessageTriggerList({
  "data-component": dataComponent,
  onEdit,
}: {
  "data-component": string;
  onEdit?: (rule: MessageTriggerRule) => void;
}) {
  const sub = (suffix: string) => `${dataComponent}_${suffix}`;
  const {
    data: rulesResponse = [],
    isError: isRulesError,
    isLoading: isRulesLoading,
  } = useMessageTriggerRules();
  const updateRuleMutation = useUpdateMessageTriggerRule();

  const {
    data: logsResponse = [],
    isError: isLogsError,
    isLoading: isLogsLoading,
  } = useQuery<MessageLogRecord[]>({
    queryKey: ["messages", "logs", "all"],
    queryFn: () => fetchAllMessageLogs<MessageLogRecord>(),
  });

  const rules = useMemo<MessageTriggerRule[]>(() => (
    Array.isArray(rulesResponse) ? rulesResponse : []
  ), [rulesResponse]);

  const logs = useMemo<MessageLogRecord[]>(() => (
    Array.isArray(logsResponse) ? logsResponse : []
  ), [logsResponse]);

  const monthLabel = useMemo(() => getMonthLabel(), []);

  const displayRows = useMemo<TriggerDisplayRow[]>(() => {
    return [...rules].sort(compareTriggerRules).map((rule) => {
      const matchingLogs = logs.filter((log) => (
        isCurrentMonthLog(log) && matchesTriggerLog(log, rule)
      ));

      return {
        kind: "live",
        rule,
        title: getRuleTitle(rule),
        timingLabel: `${getRuleTimingLabel(rule)} · ${MESSAGE_RECIPIENT_LABELS[rule.recipientType]}`,
        channelLabel: "SMS",
        icon: MessageSquareText,
        tone: "primary",
        monthlyCount: isLogsLoading || isLogsError ? null : matchingLogs.length,
        failedCount: isLogsLoading || isLogsError
          ? null
          : matchingLogs.filter((log) => log.status === "failed").length,
      };
    });
  }, [isLogsError, isLogsLoading, logs, rules]);

  const handleToggle = useCallback((row: TriggerDisplayRow) => {
    const nextActive = !row.rule.isActive;

    updateRuleMutation.mutate({
      id: row.rule.id,
      dto: { isActive: nextActive },
    });
  }, [updateRuleMutation]);

  return (
    <div className="section-block message-trigger-list" data-component={dataComponent}>
        <div className="section-header message-trigger-list-header" data-component={sub("header")}>자동 전송 트리거</div>

        {displayRows.map((row) => {
          const Icon = row.icon;
          const rowActive = row.rule.isActive;
          const rowKey = row.rule.id;
          const triggerKey = row.rule.templateKey;
          const triggerId = row.rule.id;
          // M5: a branchless rule (branchId === null) is a system rule — the manual-send
          // synthetic rule is one example — and must not be editable or toggleable here,
          // mirroring the desktop guard (frontend/src/components/app/messages/
          // TriggerRulesManager.tsx:525,564,712).
          const isSystemRule = row.rule.branchId === null;

          const iconAndInfo = (
            <>
              <div
                className={`trigger-icon trigger-icon-${row.tone}`}
                data-component={sub("icon")}
              >
                <Icon size={18} strokeWidth={2.5} />
              </div>

              <div className="trigger-info" data-component={sub("info")}>
                <div className="trigger-title" data-component={sub("title")}>{row.title}</div>
                <div className="trigger-meta" data-component={sub("meta")}>
                  <span className={`send-stat ${isLogsError || (row.failedCount ?? 0) > 0 ? "fail" : ""}`}>
                    {isLogsLoading ? (
                      <span data-slot="skeleton" className="message-count-skeleton" aria-label="발송 건수 집계 중" />
                    ) : isLogsError ? (
                      "집계 실패"
                    ) : (
                      `${monthLabel} ${row.monthlyCount ?? 0}건`
                    )}
                  </span>
                  {" · "}
                  <span>{row.timingLabel}</span>
                  {" · "}
                  <span>{row.channelLabel}</span>
                </div>
              </div>
            </>
          );

          return onEdit ? (
            <div
              key={rowKey}
              className="list-item message-trigger-row"
              data-component={sub("row")}
              data-trigger-id={triggerId}
              data-trigger-key={triggerKey}
              data-trigger-channel={row.channelLabel}
            >
              {isSystemRule ? (
                <div className="flex min-w-0 flex-1 items-center gap-3 text-left">
                  {iconAndInfo}
                </div>
              ) : (
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  aria-label={`${row.title} 설정`}
                  onClick={() => onEdit(row.rule)}
                >
                  {iconAndInfo}
                </button>
              )}
              <button
                type="button"
                className="flex min-h-11 min-w-11 items-center justify-end"
                aria-label={`${row.title} ${rowActive ? "비활성화" : "활성화"}`}
                aria-pressed={rowActive}
                disabled={isSystemRule || updateRuleMutation.isPending}
                onClick={() => handleToggle(row)}
              >
                <span className={`toggle ${rowActive ? "on" : ""}`} aria-hidden="true" />
              </button>
            </div>
          ) : (
            <button
              key={rowKey}
              type="button"
              className="list-item message-trigger-row"
              aria-pressed={rowActive}
              data-component={sub("row")}
              data-trigger-id={triggerId}
              data-trigger-key={triggerKey}
              data-trigger-channel={row.channelLabel}
              disabled={isSystemRule || updateRuleMutation.isPending}
              onClick={() => handleToggle(row)}
            >
              {iconAndInfo}
              <span className={`toggle ${rowActive ? "on" : ""}`} aria-hidden="true" />
            </button>
          );
        })}

        {isRulesLoading && (
          Array.from({ length: 4 }).map((_, index) => (
            <div
              key={`message-trigger-skeleton-${index}`}
              className="list-item message-trigger-row message-trigger-row-skeleton"
              data-component={sub("row-skeleton")}
              aria-hidden="true"
            >
              <Skeleton className="trigger-icon bg-v3-dim-white animate-pulse" />
              <div className="trigger-info" data-component={sub("row-skeleton_info")}>
                <Skeleton className="h-4 w-28 bg-v3-dim-white animate-pulse" />
                <Skeleton className="mt-2 h-3 w-36 bg-v3-dim-white animate-pulse" />
              </div>
              <Skeleton className="h-[22px] w-[38px] rounded-full bg-v3-dim-white animate-pulse" />
            </div>
          ))
        )}

        {!isRulesLoading && isRulesError && (
          <div className="message-empty-state" data-component={sub("error")}>
            자동 전송 트리거를 불러오지 못했습니다.
          </div>
        )}

        {!isRulesLoading && !isRulesError && displayRows.length === 0 && (
          <div className="message-empty-state" data-component={sub("empty")}>
            등록된 자동 전송 트리거가 없습니다.
          </div>
        )}
    </div>
  );
}
