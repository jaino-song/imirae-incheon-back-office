"use client";

import {
  cloneElement,
  isValidElement,
  useCallback,
  useDeferredValue,
  useMemo,
  useState,
  type ReactElement,
} from "react";
import {
  MESSAGE_EVENT_LABELS,
  MESSAGE_HISTORY_STATUS_LABELS,
  MESSAGE_JOB_CANCEL_COPY,
  MESSAGE_JOB_STATUS_BADGE_VARIANT,
  MESSAGE_JOB_STATUS_LABELS,
  MESSAGE_LOG_STATUS_BADGE_VARIANT,
  MESSAGE_RECIPIENT_LABELS,
  MESSAGE_RECORD_REASON_LABEL,
  MESSAGE_RECORD_STATUS_FILTER_LABELS,
  MESSAGE_RECORD_ZONE_LABELS,
  MESSAGE_SECTION_DEFINITIONS,
  formatMessageDateTimeCompact,
  formatMessageDateTimeDetail,
  getMessageTemplateLabel,
  type MessageRecordStatusFilter,
  type MessageSectionId as SharedMessageSectionId,
} from "@babyjamjam/shared";
import { t } from "@/lib/i18n/translations";
import { useLocale } from "@/providers/LocaleProvider";
import { useInitialUser } from "@/providers/UserProvider";
import { ROLES } from "@/lib/constants/roles";
import { useMessageTemplates } from "@/features/message-templates/hooks/use-message-templates";
import { useSystemTemplate } from "@/features/system-templates/hooks";
import type { SystemTemplateKey } from "@/features/system-templates/types";
import {
  useCancelUpcomingMessageTriggerJob,
  useMessageHistory,
  useRetryMessageHistory,
  useUpcomingMessageTriggerJobs,
} from "@/features/message-triggers/hooks/use-message-triggers";
import {
  isHistoryRecordInChannel,
  isUpcomingJobInChannel,
  SMS_TRIGGER_TO_SYSTEM_TEMPLATE,
} from "@/features/message-triggers/channel";
import { useAllClients } from "@/features/clients/hooks/use-clients";
import { useToast } from "@/hooks/use-toast";
import type {
  TriggerEventType,
  TriggerRecipientType,
  UpcomingMessageTriggerJob,
} from "@/features/message-triggers/types";
import { CustomTemplateForm } from "@/components/app/messages/forms/custom-template-form";
import {
  getMessageHistoryEmptyStateCopy,
  getMessageHistoryTemplateLabel as getHistoryTemplateLabel,
  getScheduledRecipientBadge,
  matchesMessageHistoryQuery as matchesHistoryQuery,
  MessageHistoryDetailPanel,
  normalizeMessageHistoryRecord as normalizeHistoryRecord,
  formatMessageHistoryDate as formatHistoryDate,
  type MessageHistoryFilter,
  type MessageHistoryRecord,
} from "@/components/app/messages/MessageHistoryDetailPanel";
import {
  AnimatedSlotList,
  AnimatedSlotListItemContent,
  CompactDateSelect,
  DetailEmptyState,
  DetailPanel,
  DetailTabPanels,
  DetailTabs,
  HeaderActionButton,
  InfoCard,
  InfoRow,
  ListEmptyState,
  ListPanel,
  PageSection,
  SectionNav,
  SplitLayout,
  useSplitLayoutSelection,
} from "@/components/app/v3";
import { MessagePhonePreview } from "@/components/app/messages/MessagePhonePreview";
import {
  AutoFillMsgCardSide,
  type AutoFillMsgCardVariableItem,
} from "@/components/app/messages/templates/AutoFillMsgCard";
import { MsgField } from "@/components/app/messages/templates/MsgField";
import { serviceInfoMsgTemplate } from "@/components/app/messages/templates/messageTemplate/serviceInfoMsg";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/app/ui/status-badge";
import { TwoButtonModal } from "@/components/app/ui/TwoButtonModal";
import { matchesSearchQuery } from "@/lib/search/korean-search";
import { findMessageHistoryClient } from "@/lib/message-history/client-match";
import { renderTemplate } from "@/lib/template-utils";
import { cn } from "@/lib/utils";
import {
  Ban,
  Bell,
  Briefcase,
  CalendarClock,
  ClipboardList,
  Clock3,
  CreditCard,
  FilePen,
  FileText,
  Heart,
  History,
  Info,
  Loader2,
  MessageCircle,
  Plus,
  RotateCcw,
  Send,
  Settings2,
  Workflow,
} from "lucide-react";
import { GreetingMessageForm } from "@/components/app/messages/forms/GreetingMessageForm";
import { ServiceInfoMessageForm } from "@/components/app/messages/forms/service-info-message-form";
import { ServiceRecordLinkMessageForm } from "@/components/app/messages/forms/ServiceRecordLinkMessageForm";
import { PriceInfoMessageForm } from "@/components/app/messages/forms/PriceInfoMessageForm";
import { ReminderMessageForm } from "@/components/app/messages/forms/ReminderMessageForm";
import { ThanksMessageForm } from "@/components/app/messages/forms/ThanksMessageForm";
import { SurveyMessageForm } from "@/components/app/messages/forms/SurveyMessageForm";
import { InfoMessageForm } from "@/components/app/messages/forms/InfoMessageForm";
import {
  TemplateSendForm,
  type TemplateSendFormSubmitState,
} from "@/components/app/messages/forms/TemplateSendForm";
import type { TemplateMessageFormLayout } from "@/components/app/messages/forms/form-components/TemplateMessageFormLayout";
import { MessageTenantApplicationSettings } from "@/components/app/messages/MessageTenantApplicationSettings";
import {
  MessageApprovalGate,
  useMessageSenderApproval,
} from "@/components/app/messages/MessageApprovalGate";
import { TriggerRulesManager } from "@/components/app/messages/TriggerRulesManager";
import { Button } from "@/components/ui/button";
import {
  APP_CONTENT_BODY_CARD_CLASS_NAME,
  AppContentCard,
} from "@/components/ui/app-surface";

type BuiltinTemplateType =
  | "greeting"
  | "service-info"
  | "service-feedback-link"
  | "price-info"
  | "reminder"
  | "thanks"
  | "survey"
  | "info";
type TemplateFilter = "builtin" | "branch";

interface TemplateListItem {
  id: string;
  label: string;
  icon: typeof MessageCircle;
}

interface PlaceholderPreviewItem {
  id: string;
  label: string;
  summary: string;
  badge: string;
  detailTitle: string;
  detailDescription: string;
  checklist: string[];
  recipientName?: string;
  recipientType?: "고객" | "직원";
  recipientPhone?: string;
  templateTitle?: string;
  scheduledAt?: string;
  messageBody?: string;
  variableAssignments?: Array<{
    token: string;
    label: string;
    value: string;
  }>;
}

const BUILTIN_TEMPLATES: TemplateListItem[] = [
  { id: "builtin:greeting", label: getMessageTemplateLabel("GREETING"), icon: MessageCircle },
  { id: "builtin:service-info", label: getMessageTemplateLabel("SERVICE_INFO"), icon: Briefcase },
  { id: "builtin:service-feedback-link", label: getMessageTemplateLabel("SERVICE_RECORD_LINK"), icon: FileText },
  { id: "builtin:price-info", label: getMessageTemplateLabel("PRICE_INFO"), icon: CreditCard },
  { id: "builtin:reminder", label: getMessageTemplateLabel("REMINDER"), icon: Bell },
  { id: "builtin:thanks", label: getMessageTemplateLabel("THANKS"), icon: Heart },
  { id: "builtin:survey", label: getMessageTemplateLabel("SURVEY"), icon: ClipboardList },
  { id: "builtin:info", label: getMessageTemplateLabel("INFO"), icon: Info },
];

const TEMPLATE_FILTERS: Array<{ value: TemplateFilter; label: string }> = [
  { value: "builtin", label: "기본 템플릿" },
  { value: "branch", label: "지점 템플릿" },
];

const ICON_BY_SECTION_ID: Record<SharedMessageSectionId, typeof Send> = {
  send: Send,
  scheduled: Clock3,
  history: History,
  templates: FileText,
  triggers: Workflow,
  settings: Settings2,
};

const MESSAGE_SECTIONS = MESSAGE_SECTION_DEFINITIONS.map((section) => ({
  ...section,
  icon: ICON_BY_SECTION_ID[section.id],
}));

type MessageSectionId = SharedMessageSectionId;
// "scheduled" stays out of this union on purpose: MessageSectionId keeps the member
// for shared-package compatibility (see MESSAGE_SECTION_DEFINITIONS), but the nav
// never offers it and MessageSectionPlaceholder no longer has scheduled-specific
// copy to render for it — see the render dispatch below for how that's kept safe.
type PlaceholderSectionId = Exclude<MessageSectionId, "send" | "templates" | "triggers" | "history" | "scheduled">;

// Sections that are still 출시 예정. The owner gets early access to them; everyone
// else sees them disabled until the features ship. "scheduled" and "history" are
// merged into one always-available section once SMS sending is approved for the
// branch (see SENDER_APPROVAL_EXEMPT_SECTION_IDS below), so neither is unreleased
// anymore.
const UNRELEASED_SECTION_IDS = new Set<MessageSectionId>([
  "templates",
  "triggers",
]);
const SENDER_APPROVAL_EXEMPT_SECTION_IDS = new Set<MessageSectionId>(["send", "settings"]);

const TEMPLATE_SEND_FORM_ID = "messages-template-send-form-active";

function getMessageHistoryListStatusMeta(status: MessageHistoryRecord["status"]) {
  return {
    label: MESSAGE_HISTORY_STATUS_LABELS[status],
    variant: MESSAGE_LOG_STATUS_BADGE_VARIANT[status],
  };
}

function getMessageHistoryAvatarClassName(status: MessageHistoryRecord["status"]): string {
  if (status === "sent") {
    return "border border-[hsl(137,34%,84%)] bg-[hsl(137,60%,94%)] text-v3-green";
  }
  if (status === "pending") {
    return "border border-amber-200 bg-amber-50 text-amber-700";
  }
  if (status === "canceled") {
    return "border border-slate-200 bg-slate-100 text-slate-600";
  }
  return "border border-[hsla(355,36%,45%,0.20)] bg-[hsl(355,40%,94%)] text-[hsl(355,36%,45%)]";
}

function getScheduledJobStatusMeta(status: UpcomingMessageTriggerJob["status"]) {
  return {
    label: MESSAGE_JOB_STATUS_LABELS[status],
    variant: MESSAGE_JOB_STATUS_BADGE_VARIANT[status],
  };
}

// Manual scheduled sends ride along in the /upcoming response as message_log rows
// coerced into the UpcomingMessageTriggerJob shape (see backend
// MessageTriggerService.listManualScheduledSmsLogs). They carry a synthetic
// `manual-sms:<logId>` ruleId instead of a real message_trigger_rule id, which is
// the only signal that distinguishes them from a real trigger job. Only real
// trigger jobs can be canceled through /message-trigger-jobs/:id/cancel.
function isManualScheduledJob(job: UpcomingMessageTriggerJob): boolean {
  return job.ruleId.startsWith("manual-sms:");
}

type MessageHistoryRelativeDateFilter = "all" | "1d" | "7d" | "30d";
type ScheduledDetailTab = "info" | "message";
type TemplateDetailTab = "details" | "preview";

const PLACEHOLDER_COPY: Record<
  PlaceholderSectionId,
  { description: string; helper: string; items: PlaceholderPreviewItem[] }
> = {
  settings: {
    description: "메시지 발송 정책과 기본 옵션을 관리하는 영역입니다.",
    helper: "채널 설정이나 발신 정책 관련 UI를 연결하면 이곳에서 공통 설정을 다룰 수 있습니다.",
    items: [
      {
        id: "settings-channel",
        label: "채널 기본값",
        summary: "발신 채널과 기본 템플릿 정책을 정리하는 설정 목록입니다.",
        badge: "기본",
        detailTitle: "채널 기본값 상세",
        detailDescription: "각 채널의 기본 발신 규칙과 템플릿 연결 상태를 확인하는 영역입니다.",
        checklist: ["기본 채널 활성화 여부", "기본 템플릿 연결", "Fallback 정책"],
      },
      {
        id: "settings-policy",
        label: "발송 정책",
        summary: "발송 가능 시간, 중복 방지 규칙 등을 관리하는 정책 목록입니다.",
        badge: "정책",
        detailTitle: "발송 정책 상세",
        detailDescription: "운영 정책에 따른 발송 제한과 자동화 규칙을 구성하는 상세 영역입니다.",
        checklist: ["발송 허용 시간", "중복/빈도 제한", "예외 처리 기준"],
      },
      {
        id: "settings-alert",
        label: "알림 및 감사",
        summary: "오류 알림, 감사 로그, 운영자 확인 항목을 모아둔 영역입니다.",
        badge: "감사",
        detailTitle: "알림 및 감사 상세",
        detailDescription: "운영자 알림과 설정 변경 기록을 함께 관리하는 상세 영역입니다.",
        checklist: ["오류 알림 수신 대상", "설정 변경 기록", "감사 로그 보관 정책"],
      },
    ],
  },
};

const MESSAGE_HISTORY_RELATIVE_DATE_OPTIONS: {
  value: MessageHistoryRelativeDateFilter;
  label: string;
}[] = [
  { value: "all", label: "전체" },
  { value: "1d", label: "1일전" },
  { value: "7d", label: "1주일 전" },
  { value: "30d", label: "한달 전" },
];

const MESSAGE_HISTORY_MONTH_OPTIONS = Array.from({ length: 12 }, (_, index) => {
  const value = String(index + 1).padStart(2, "0");
  return { value, label: `${index + 1}월` };
});

// Top-level status tabs for the merged 발송 기록 list. "all" shows both zones;
// "upcoming" shows only the upcoming zone; the rest filter zone 2 (past sends) to
// that status. There's deliberately no dedicated tab for the old scheduled
// section's 고객/직원 recipient-type filter — see matchesScheduledJobQuery and
// matchesHistoryQuery, which both fold the recipient badge into the free-text
// search, so a second row of tabs isn't needed on top of these (ListPanel only
// supports one tab row anyway).
const MESSAGE_RECORD_STATUS_FILTER_TABS: { value: MessageRecordStatusFilter; label: string }[] = (
  ["all", "upcoming", "sent", "failed", "canceled"] as const
).map((value) => ({ value, label: MESSAGE_RECORD_STATUS_FILTER_LABELS[value] }));

const SCHEDULED_DETAIL_TABS = [
  { key: "info", label: "발송 정보" },
  { key: "message", label: "메시지 내용" },
] satisfies Array<{ key: ScheduledDetailTab; label: string }>;

const TEMPLATE_DETAIL_TABS = [
  { key: "details", label: "상세정보" },
  { key: "preview", label: "미리보기" },
];

const BUILTIN_TEMPLATE_SYSTEM_KEYS: Record<BuiltinTemplateType, SystemTemplateKey> = {
  greeting: "GREETING",
  "service-info": "SERVICE_INFO",
  "service-feedback-link": "SERVICE_RECORD_LINK",
  "price-info": "PRICE_INFO",
  reminder: "REMINDER",
  thanks: "THANKS",
  survey: "SURVEY",
  info: "INFO",
};

const BUILTIN_TEMPLATE_PREVIEW_META: Record<
  BuiltinTemplateType,
  { headline: string; subtitle: string; buttons: string[] }
> = {
  greeting: {
    headline: "등록이 완료되었어요",
    subtitle: "첫 안내 메시지",
    buttons: ["서비스 안내"],
  },
  "service-info": {
    headline: "서비스를 안내드릴게요",
    subtitle: "기본 안내 메시지",
    buttons: ["서비스 보기"],
  },
  "service-feedback-link": {
    headline: "제공기록지를 작성해 주세요",
    subtitle: "제공기록지 작성 링크",
    buttons: ["기록지 열기"],
  },
  "price-info": {
    headline: "이용 요금을 확인해 주세요",
    subtitle: "결제 전 안내",
    buttons: ["결제 안내"],
  },
  reminder: {
    headline: "일정을 다시 안내드려요",
    subtitle: "리마인더 메시지",
    buttons: ["일정 확인"],
  },
  thanks: {
    headline: "서비스 이용에 감사드려요",
    subtitle: "후속 안내 메시지",
    buttons: ["후기 남기기"],
  },
  survey: {
    headline: "만족도 조사를 부탁드려요",
    subtitle: "설문 메시지",
    buttons: ["설문 참여"],
  },
  info: {
    headline: "운영 안내를 확인해 주세요",
    subtitle: "기본 안내 메시지",
    buttons: ["안내 확인"],
  },
};

const SCHEDULED_VARIABLE_LABELS: Record<string, string> = {
  clientName: "고객명",
  employeeName: "직원명",
  registrationDate: "등록일",
  recipientName: "수신자명",
  serviceEndDate: "서비스 종료일",
  serviceStartDate: "서비스 시작일",
  serviceType: "서비스 유형",
  timingText: "발송 문구",
};

function getScheduledRecipientLabel(recipientType: TriggerRecipientType) {
  return MESSAGE_RECIPIENT_LABELS[recipientType];
}

function getScheduledEventLabel(eventType: TriggerEventType | null) {
  if (!eventType) return "기타 이벤트";
  return MESSAGE_EVENT_LABELS[eventType];
}

function formatScheduledPreviewDate(dateString: string) {
  return formatMessageDateTimeCompact(dateString);
}

function formatScheduledDetailDate(dateString: string) {
  return formatMessageDateTimeDetail(dateString);
}

function matchesScheduledJobQuery(job: UpcomingMessageTriggerJob, query: string) {
  return matchesSearchQuery(query, [
    job.ruleName,
    job.payload.recipientName,
    job.payload.clientName ?? "",
    job.payload.employeeName ?? "",
    job.recipientPhone ?? job.payload.recipientPhone ?? "",
    getScheduledRecipientBadge(job.recipientType),
    getHistoryTemplateLabel(job.templateKey),
    getScheduledEventLabel(job.eventType),
    formatScheduledPreviewDate(job.scheduledFor),
  ]);
}

type ScheduledJobPayloadWithMessageBody = UpcomingMessageTriggerJob["payload"] & {
  messageBody?: string | null;
};

function getScheduledJobPayloadMessageBody(job: UpcomingMessageTriggerJob | null) {
  const payload = job?.payload as ScheduledJobPayloadWithMessageBody | undefined;
  const messageBody = payload?.messageBody;

  return typeof messageBody === "string" ? messageBody.trim() : "";
}

function getScheduledJobTemplateVariables(job: UpcomingMessageTriggerJob) {
  return {
    name: job.payload.recipientName,
    clientName: job.payload.recipientName,
    phone: job.payload.recipientPhone,
    ...job.payload.templateVariables,
  };
}

function getScheduledJobFallbackMessage(job: UpcomingMessageTriggerJob, variables: Record<string, string>) {
  if (job.templateKey === "SERVICE_INFO") {
    return serviceInfoMsgTemplate({ name: variables.name?.trim() || "{{name}}" });
  }

  return "예약 발송 메시지 본문을 불러올 수 없습니다.";
}

function buildScheduledJobMessageBody(job: UpcomingMessageTriggerJob | null, systemTemplateContent?: string) {
  if (!job) return "";

  const payloadMessageBody = getScheduledJobPayloadMessageBody(job);
  if (payloadMessageBody) return payloadMessageBody;

  const variables = getScheduledJobTemplateVariables(job);
  if (systemTemplateContent) {
    return renderTemplate(systemTemplateContent, variables);
  }

  return getScheduledJobFallbackMessage(job, variables);
}

const FormComponents: Record<
  BuiltinTemplateType,
  React.ComponentType<{
    onPreviewMessageChange?: (message: string) => void;
    renderLayout?: TemplateMessageFormLayout;
    showMessageSide?: boolean;
  }>
> = {
  greeting: GreetingMessageForm,
  "service-info": ServiceInfoMessageForm,
  "service-feedback-link": ServiceRecordLinkMessageForm,
  "price-info": PriceInfoMessageForm,
  reminder: ReminderMessageForm,
  thanks: ThanksMessageForm,
  survey: SurveyMessageForm,
  info: InfoMessageForm,
};

// The only reachable PlaceholderSectionId today is "settings" (see the render
// dispatch in MessagesPage) — this generic list/detail preview stands in until a
// real settings UI section is built. It no longer special-cases "scheduled":
// that content merged into MessageHistorySection below.
function MessageSectionPlaceholder({ sectionId }: { sectionId: PlaceholderSectionId }) {
  const section = MESSAGE_SECTIONS.find((item) => item.id === sectionId);
  const copy = PLACEHOLDER_COPY[sectionId];
  const [selectedPreviewId, setSelectedPreviewId] = useState<string | null>(null);
  const selectedPreview = copy.items.find((item) => item.id === selectedPreviewId) ?? null;

  if (!section) return null;

  const Icon = section.icon;
  const detailSubtitle =
    selectedPreview?.detailDescription ?? "왼쪽 목록에서 미리보기 항목을 선택하면 이 영역에 상세 구성 가이드가 표시됩니다.";

  return (
    <div data-component="desktop_messages_sections_section-placeholder-layout" className="flex min-h-[560px] flex-1 flex-col">
      <SplitLayout data-component="desktop_messages_sections_split-layout-2" hasSelection={!!selectedPreview} onBack={() => setSelectedPreviewId(null)}>
        <ListPanel data-component="desktop_messages_sections_split-layout_list-panel-2"
          title={section.label}
          subtitle={copy.description}
          headerActions={
            <span
              data-component="desktop_messages_sections_section-placeholder-list-badge"
              className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full bg-v3-primary-light px-3 py-1 text-[0.72rem] font-semibold text-v3-primary"
            >
              {copy.items.length}개
            </span>
          }
          emptyState={!(copy.items.length > 0) ? (
            <ListEmptyState message="표시할 항목이 없습니다." />
          ) : undefined}
        >
          <div data-component="desktop_messages_sections_split-layout_list-panel-2_section-placeholder-list" className="space-y-3 pb-2">
            <AnimatedSlotList<PlaceholderPreviewItem>
                items={copy.items}
                isLoading={false}
                className="space-y-2"
                itemDataComponent="desktop_messages_sections_section-placeholder-layout_split-layout_list-panel_list_item"
                getSlotState={({ item }) => ({
                  isActive: item?.id === selectedPreviewId,
                  isInteractive: Boolean(item),
                })}
                onSlotClick={(item) => {
                  setSelectedPreviewId(item.id);
                }}
                render={({ item }) => {
                  if (!item) return null;

                  return (
                    <AnimatedSlotListItemContent
                      dataComponent="desktop_messages_sections_section-placeholder-list-item"
                      icon={Icon}
                      iconContainerClassName="text-v3-primary"
                      title={item.label}
                      subtitle={item.summary}
                      status={
                        <span
                          data-component="desktop_messages_sections_section-placeholder-list-item-badge"
                          className="inline-flex shrink-0 items-center rounded-full bg-white/85 px-2 py-0.5 text-[0.66rem] font-semibold text-v3-primary"
                        >
                          {item.badge}
                        </span>
                      }
                    />
                  );
                }}
              />
            </div>
        </ListPanel>

        <DetailPanel data-component="desktop_messages_sections_section_split-layout_detail-panel"
          avatar={
            <div
              data-component="desktop_messages_sections_section_split-layout_detail-panel_section-placeholder-detail-avatar"
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[16px] bg-v3-primary-light text-v3-primary"
            >
              <Icon className="h-5 w-5" />
            </div>
          }
          title={selectedPreview?.detailTitle ?? `${section.label} 상세`}
          subtitle={detailSubtitle}
        >
          {selectedPreview ? (
            <div data-component="desktop_messages_sections_section_split-layout_detail-panel_section-placeholder-detail" className="space-y-4">
              <AppContentCard
                data-component="desktop_messages_sections_section-placeholder-detail-overview"
                variant="muted"
                title="연결 예정 콘텐츠"
                titleVariant="eyebrow"
              >
                <p className="text-sm font-semibold text-v3-dark">{selectedPreview.detailTitle}</p>
                <p className="text-[0.82rem] leading-6 text-v3-text-muted">
                  {selectedPreview.detailDescription}
                </p>
              </AppContentCard>

              <AppContentCard
                data-component="desktop_messages_sections_section-placeholder-detail-checklist"
                variant="muted"
                title="구성 제안"
                titleVariant="eyebrow"
                contentClassName="space-y-3"
              >
                <div data-component="desktop_messages_sections_section-placeholder-detail-checklist_section-placeholder-detail-checklist-items" className="space-y-3">
                  {selectedPreview.checklist.map((item) => (
                    <div
                      key={item}
                      data-component="desktop_messages_sections_section-placeholder-detail-checklist_section-placeholder-detail-checklist-items_section-placeholder-detail-checklist-item"
                      className="flex items-center gap-3 rounded-[16px] bg-white px-4 py-3"
                    >
                      <div
                        data-component="desktop_messages_sections_section-placeholder-detail-checklist_section-placeholder-detail-checklist-items_section-placeholder-detail-checklist-item_section-placeholder-detail-checklist-marker"
                        className="h-2.5 w-2.5 rounded-full bg-v3-primary"
                      />
                      <p className="text-[0.78rem] text-v3-dark">{item}</p>
                    </div>
                  ))}
                </div>
              </AppContentCard>
            </div>
          ) : (
            <DetailEmptyState
              message={detailSubtitle}
            />
          )}
        </DetailPanel>
      </SplitLayout>
    </div>
  );
}

function matchesHistoryDateParts(sentAt: string, yearFilter: string, monthFilter: string) {
  if (!yearFilter && !monthFilter) return true;

  const targetDate = new Date(sentAt);
  if (Number.isNaN(targetDate.getTime())) return true;

  const matchesYear = !yearFilter || String(targetDate.getFullYear()) === yearFilter;
  const matchesMonth = !monthFilter || String(targetDate.getMonth() + 1).padStart(2, "0") === monthFilter;

  return matchesYear && matchesMonth;
}

function normalizeDatePart(value: string, emptyValue: string) {
  return value === emptyValue ? "" : value;
}

function matchesHistoryRelativeDate(sentAt: string, relativeDateFilter: MessageHistoryRelativeDateFilter) {
  if (relativeDateFilter === "all") return true;

  const targetDate = new Date(sentAt);
  if (Number.isNaN(targetDate.getTime())) return true;

  const days = relativeDateFilter === "1d" ? 1 : relativeDateFilter === "7d" ? 7 : 30;
  const threshold = new Date();
  threshold.setHours(0, 0, 0, 0);
  threshold.setDate(threshold.getDate() - days);

  return targetDate >= threshold;
}

// Copy for the merged list's overall empty state (both zones empty under the
// active filter). Reuses the existing per-status history copy where the shared
// MessageRecordStatusFilter value overlaps MessageHistoryFilter (sent/failed/
// canceled); "upcoming" and "all" need their own wording since neither existed
// as a concept on the old history-only empty state.
function getMergedRecordEmptyStateMessage(filter: MessageRecordStatusFilter, hasSearchQuery: boolean): string {
  if (filter === "upcoming") {
    return hasSearchQuery ? "조건에 맞는 예정된 발송이 없습니다." : "예정된 발송이 없습니다.";
  }
  if (filter === "sent" || filter === "failed" || filter === "canceled") {
    return getMessageHistoryEmptyStateCopy(filter, hasSearchQuery).title;
  }
  return hasSearchQuery ? "조건에 맞는 메시지가 없습니다." : "표시할 메시지가 없습니다.";
}

function MessageHistorySection() {
  const [searchValue, setSearchValue] = useState("");
  const [recordStatusFilter, setRecordStatusFilter] = useState<MessageRecordStatusFilter>("all");
  const [relativeDateFilter, setRelativeDateFilter] = useState<MessageHistoryRelativeDateFilter>("all");
  const [dateYear, setDateYear] = useState("");
  const [dateMonth, setDateMonth] = useState("");
  const [scheduledDetailTab, setScheduledDetailTab] = useState<ScheduledDetailTab>("info");
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const deferredSearchValue = useDeferredValue(searchValue);
  const { data: historyData = [], isLoading, isError } = useMessageHistory();
  const { data: upcomingJobs = [], isLoading: isLoadingUpcoming } = useUpcomingMessageTriggerJobs();
  // The history query is often already cached (TemplateSendForm subscribes to
  // the same key), so isLoading can settle before isLoadingUpcoming does. Both
  // the past list and every count pill key off this combined flag so nothing
  // shows stale/real content while the other query is still in flight.
  const isPanelLoading = isLoading || isLoadingUpcoming;
  const { mutateAsync: retryHistory, isPending: isRetrying } = useRetryMessageHistory();
  const cancelMutation = useCancelUpcomingMessageTriggerJob();
  const { data: clients = [] } = useAllClients();
  const { toast } = useToast();
  const smsHistoryData = useMemo(
    () => historyData.filter((record) => isHistoryRecordInChannel(record, "sms")),
    [historyData],
  );
  const smsUpcomingJobs = useMemo(
    () => upcomingJobs.filter((job) => isUpcomingJobInChannel(job, "sms")),
    [upcomingJobs],
  );
  const historyRecords = useMemo(
    () =>
      // Sorted explicitly here (not left to the backend's createdAt-desc order)
      // so a retried record's most recent attempt sorts to the top — same key
      // and direction as mobile's MessagesDataPages historyRecords sort
      // (lastAttemptAt || createdAt, descending), so the two apps agree.
      [...smsHistoryData]
        .sort(
          (left, right) =>
            new Date(right.lastAttemptAt || right.createdAt).getTime()
            - new Date(left.lastAttemptAt || left.createdAt).getTime(),
        )
        .map((record) => {
          const matchedClient = findMessageHistoryClient(record, clients);
          const matchedClientName = matchedClient?.name.trim() ?? "";
          const normalizedRecord = normalizeHistoryRecord(record, {
            recipientNameFallback: matchedClientName,
            recipientListLabelFallback: matchedClientName,
          });

          const shouldUseMatchedClientName = record.recipientType === null
            || record.recipientType === "CLIENT";
          if (!matchedClientName || !shouldUseMatchedClientName) return normalizedRecord;

          return {
            ...normalizedRecord,
            recipientName: matchedClientName,
            recipientListLabel: matchedClientName,
          };
        }),
    [clients, smsHistoryData]
  );
  const hasDatePartFilter = Boolean(dateYear || dateMonth);
  const historyYearOptions = useMemo(() => {
    const years = new Set<number>();
    const currentYear = new Date().getFullYear();

    historyRecords.forEach((record) => {
      const sentDate = new Date(record.sentAt);
      if (!Number.isNaN(sentDate.getTime())) {
        years.add(sentDate.getFullYear());
      }
    });

    for (let year = currentYear; year >= currentYear - 5; year -= 1) {
      years.add(year);
    }

    return Array.from(years).sort((a, b) => b - a);
  }, [historyRecords]);
  const handleDateYearChange = useCallback((value: string) => {
    setDateYear(normalizeDatePart(value, "year"));
  }, []);
  const handleDateMonthChange = useCallback((value: string) => {
    setDateMonth(normalizeDatePart(value, "month"));
  }, []);

  // "all" and "upcoming" both show every zone-1 row; the remaining three values
  // show only zone 1 (upcoming shows nothing from zone 2 at all).
  const showUpcomingZone = recordStatusFilter === "all" || recordStatusFilter === "upcoming";
  const showPastZone = recordStatusFilter !== "upcoming";
  const pastStatusFilter: MessageHistoryFilter =
    recordStatusFilter === "sent" || recordStatusFilter === "failed" || recordStatusFilter === "canceled"
      ? recordStatusFilter
      : "all";

  // Soonest-first, matching the old scheduled section. No date-range filter here
  // on purpose — upcoming sends are always in the future, so the "지난 발송" date
  // filter below only ever applies to zone 2.
  const filteredUpcomingJobs = useMemo(() => {
    if (!showUpcomingZone) return [];
    return smsUpcomingJobs
      .filter((job) => matchesScheduledJobQuery(job, deferredSearchValue))
      .sort((left, right) => new Date(left.scheduledFor).getTime() - new Date(right.scheduledFor).getTime());
  }, [deferredSearchValue, showUpcomingZone, smsUpcomingJobs]);

  const filteredHistoryRecords = useMemo(
    () => {
      if (!showPastZone) return [];
      return historyRecords.filter((record) => {
        const matchesStatus = pastStatusFilter === "all" || record.status === pastStatusFilter;
        const matchesRelativeDate = matchesHistoryRelativeDate(record.sentAt, relativeDateFilter);
        const matchesDate = matchesHistoryDateParts(record.sentAt, dateYear, dateMonth);
        return matchesStatus && matchesRelativeDate && matchesDate && matchesHistoryQuery(record, deferredSearchValue);
      });
    },
    [dateMonth, dateYear, deferredSearchValue, historyRecords, pastStatusFilter, relativeDateFilter, showPastZone]
  );

  const combinedRecordIds = useMemo(
    () => [
      ...filteredUpcomingJobs.map((job) => job.id),
      ...filteredHistoryRecords.map((record) => record.id),
    ],
    [filteredHistoryRecords, filteredUpcomingJobs],
  );
  const {
    selectedId: selectedRecordId,
    setSelectedId: setSelectedRecordId,
    setSplitLayoutMode,
  } = useSplitLayoutSelection(combinedRecordIds);

  const totalVisibleCount = filteredUpcomingJobs.length + filteredHistoryRecords.length;
  const isOverallEmpty = !isError && !isLoading && !isLoadingUpcoming && totalVisibleCount === 0;

  const selectedJob = useMemo(
    () => filteredUpcomingJobs.find((job) => job.id === selectedRecordId) ?? null,
    [filteredUpcomingJobs, selectedRecordId],
  );
  const selectedRecord = useMemo(
    () => filteredHistoryRecords.find((record) => record.id === selectedRecordId) ?? null,
    [filteredHistoryRecords, selectedRecordId],
  );

  const selectedJobPhone = selectedJob?.recipientPhone ?? selectedJob?.payload.recipientPhone ?? "-";
  const selectedJobVariables = selectedJob ? Object.entries(selectedJob.payload.templateVariables) : [];
  const selectedJobSystemTemplateKey = selectedJob ? SMS_TRIGGER_TO_SYSTEM_TEMPLATE[selectedJob.templateKey] ?? "" : "";
  const { data: selectedJobSystemTemplate } = useSystemTemplate(selectedJobSystemTemplateKey);
  const selectedJobMessageBody = buildScheduledJobMessageBody(selectedJob, selectedJobSystemTemplate?.content);
  const handleScheduledDetailTabChange = useCallback((key: string) => {
    if (key === "info" || key === "message") {
      setScheduledDetailTab(key);
    }
  }, []);

  const canRetry = !!selectedRecord
    && typeof selectedRecord.id === "number"
    && selectedRecord.status === "failed";

  const handleRetry = useCallback(async () => {
    if (!selectedRecord || typeof selectedRecord.id !== "number") return;

    try {
      const retriedRecord = await retryHistory(selectedRecord.id);

      if (retriedRecord.status === "failed") {
        throw new Error(retriedRecord.errorMessage || "메시지를 재발송하지 못했어요");
      }

      toast({ variant: "success", description: "재발송 요청을 접수했어요" });
    } catch (error) {
      toast({
        variant: "destructive",
        description: error instanceof Error ? error.message : "재발송을 요청하지 못했어요",
      });
    }
  }, [retryHistory, selectedRecord, toast]);

  // Only a pending trigger job can be canceled (POST /message-trigger-jobs/:id/cancel
  // refuses processing/sent/canceled/missing jobs), and manual scheduled entries
  // are never cancellable at all.
  const canCancelSelectedJob = !!selectedJob
    && selectedJob.status === "pending"
    && !isManualScheduledJob(selectedJob);

  // Awaited (not mutate's per-call callbacks): invalidating the upcoming/history
  // queries can unmount this detail panel before a per-call onError would fire.
  const handleCancelJob = useCallback(async () => {
    if (!selectedJob) return;

    try {
      await cancelMutation.mutateAsync(selectedJob.id);
      toast({ variant: "success", description: MESSAGE_JOB_CANCEL_COPY.success });
    } catch {
      // A 409 (already sent/processing/canceled) means the confirm button in
      // this dialog would just 409 again — the failure toast is the feedback,
      // the modal has nothing left to offer, so close it here too instead of
      // trapping the user behind a confirm button that can only fail.
      toast({ variant: "destructive", description: MESSAGE_JOB_CANCEL_COPY.failure });
    } finally {
      setCancelDialogOpen(false);
    }
  }, [cancelMutation, selectedJob, toast]);

  return (
    <>
    <SplitLayout data-component="desktop_messages_sections_split-layout-3"
      hasSelection={!!selectedJob || !!selectedRecord}
      onBack={() => setSelectedRecordId(null)}
      onModeChange={setSplitLayoutMode}
    >
      <ListPanel data-component="desktop_messages_sections_split-layout_list-panel-3"
        title="발송 기록"
        subtitle="예정된 발송과 지난 발송 기록을 함께 확인할 수 있어요."
        tabs={MESSAGE_RECORD_STATUS_FILTER_TABS}
        activeTab={recordStatusFilter}
        onTabChange={(value) => {
          setRecordStatusFilter(value as MessageRecordStatusFilter);
          setSelectedRecordId(null);
        }}
        searchValue={searchValue}
        onSearchChange={setSearchValue}
        searchPlaceholder="고객명, 연락처, 템플릿, 내용 검색…"
        headerActions={
          isPanelLoading ? (
            <Skeleton
              data-component="desktop_messages_sections_history-list-count"
              className="h-[22px] w-12 rounded-full bg-v3-dim-white"
            />
          ) : (
            <span
              data-component="desktop_messages_sections_history-list-count"
              className="inline-flex items-center gap-1.5 rounded-full bg-v3-primary-light px-3 py-1 text-[0.72rem] font-semibold text-v3-primary"
            >
              {totalVisibleCount}건
            </span>
          )
        }
        emptyState={isOverallEmpty ? (
          <ListEmptyState message={getMergedRecordEmptyStateMessage(recordStatusFilter, deferredSearchValue.trim().length > 0)} />
        ) : undefined}
        subHeader={
          showPastZone && !isError ? (
            <div data-component="desktop_messages_sections_split-layout_list-panel-3_history-list-filters" className="flex items-center justify-between gap-2">
              <div data-component="desktop_messages_sections_split-layout_list-panel-3_history-list-filters_history-list-filter-relative" className="w-[110px] shrink-0">
                <Select value={relativeDateFilter} onValueChange={(value) => setRelativeDateFilter(value as MessageHistoryRelativeDateFilter)}>
                  <SelectTrigger
                    aria-label="발송 기간"
                    size="sm"
                    data-component="desktop_messages_sections_history-list-filter-relative-trigger"
                    className="w-full"
                  >
                    <SelectValue placeholder="기간 선택" />
                  </SelectTrigger>
                  <SelectContent data-component="desktop_messages_sections_history-list-filter-relative-content">
                    {MESSAGE_HISTORY_RELATIVE_DATE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div
                data-component="desktop_messages_sections_split-layout_list-panel-3_history-list-filters_history-list-filter-date"
                className="ml-auto flex flex-1 items-center justify-end gap-1.5"
              >
                {(hasDatePartFilter || relativeDateFilter !== "all") && (
                  <button
                    type="button"
                    aria-label="필터 초기화"
                    title="필터 초기화"
                    data-component="desktop_messages_sections_history-list-filter-reset"
                    onClick={() => {
                      setDateYear("");
                      setDateMonth("");
                      setRelativeDateFilter("all");
                    }}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-white text-v3-text-muted transition-colors hover:bg-v3-dim-white hover:text-v3-dark"
                  >
                    <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                )}
                <CompactDateSelect
                  ariaLabel="발송 연도"
                  value={dateYear || "year"}
                  onValueChange={handleDateYearChange}
                  placeholder="연"
                  dataComponent="desktop_messages_sections_history-list-filter-date-year"
                  contentDataComponent="desktop_messages_sections_history-list-filters_filter-date_year-content"
                  options={[
                    { label: "연", value: "year" },
                    ...historyYearOptions.map((year) => ({
                      label: `${year}년`,
                      value: String(year),
                    })),
                  ]}
                />

                <CompactDateSelect
                  ariaLabel="발송 월"
                  value={dateMonth || "month"}
                  onValueChange={handleDateMonthChange}
                  placeholder="월"
                  dataComponent="desktop_messages_sections_history-list-filter-date-month"
                  contentDataComponent="desktop_messages_sections_history-list-filters_filter-date_month-content"
                  options={[
                    { label: "월", value: "month" },
                    ...MESSAGE_HISTORY_MONTH_OPTIONS,
                  ]}
                />
              </div>
            </div>
          ) : undefined
        }
      >
        {isError ? (
          <div
            data-component="desktop_messages_sections_split-layout_list-panel-3_history-list-error"
            className="rounded-[18px] border border-red-200 bg-red-50 p-6 text-center"
          >
            <p className="text-sm font-semibold text-red-700">발송 기록을 불러오지 못했습니다.</p>
            <p className="mt-1 text-[0.8rem] text-red-600">잠시 후 다시 시도해 주세요.</p>
          </div>
        ) : (
          <>
            {showUpcomingZone && !isOverallEmpty ? (
              <div data-component="desktop_messages_sections_split-layout_list-panel-3_zone-upcoming">
                <div
                  data-component="desktop_messages_sections_split-layout_list-panel-3_zone-upcoming_label"
                  className="flex items-center gap-2 px-1 pb-2 pt-1 text-[0.72rem] font-semibold text-v3-text-muted"
                >
                  <span>{MESSAGE_RECORD_ZONE_LABELS.upcoming}</span>
                  {isPanelLoading ? (
                    <Skeleton
                      data-component="desktop_messages_sections_split-layout_list-panel-3_zone-upcoming_count"
                      className="h-[18px] w-7 rounded-full bg-v3-dim-white"
                    />
                  ) : (
                    <span
                      data-component="desktop_messages_sections_split-layout_list-panel-3_zone-upcoming_count"
                      className="inline-flex items-center rounded-full bg-v3-primary-light px-2 py-0.5 text-[0.66rem] font-semibold text-v3-primary"
                    >
                      {filteredUpcomingJobs.length}
                    </span>
                  )}
                </div>
                <AnimatedSlotList<UpcomingMessageTriggerJob>
                  items={filteredUpcomingJobs}
                  isLoading={isPanelLoading}
                  loadingCount={3}
                  className="space-y-2 pb-3"
                  itemDataComponent="desktop_messages_sections_split-layout_list-panel-3_upcoming-list_item"
                  getSlotState={({ item, isLoading: slotLoading }) => ({
                    isActive: !slotLoading && item?.id === selectedRecordId,
                    isInteractive: !slotLoading && Boolean(item),
                  })}
                  onSlotClick={(item) => {
                    setSelectedRecordId(item.id);
                    setScheduledDetailTab("info");
                  }}
                  render={({ item }) => {
                    if (!item) return null;
                    const statusMeta = getScheduledJobStatusMeta(item.status);

                    return (
                      <AnimatedSlotListItemContent
                        dataComponent="desktop_messages_sections_upcoming-list-item"
                        icon={Clock3}
                        iconContainerClassName="text-v3-primary"
                        title={item.payload.recipientName || "-"}
                        subtitle={`${getHistoryTemplateLabel(item.templateKey)} · ${formatScheduledPreviewDate(item.scheduledFor)}`}
                        status={
                          <div
                            data-component="desktop_messages_sections_split-layout_list-panel-3_zone-upcoming_upcoming-list-item-badges"
                            className="flex shrink-0 flex-col items-end gap-1"
                          >
                            <StatusBadge
                              data-component="desktop_messages_sections_split-layout_list-panel-3_zone-upcoming_upcoming-list-item-badges_status"
                              variant={statusMeta.variant}
                              size="sm"
                            >
                              {item.status === "processing" ? (
                                <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                              ) : null}
                              {statusMeta.label}
                            </StatusBadge>
                            <span
                              data-component="desktop_messages_sections_split-layout_list-panel-3_zone-upcoming_upcoming-list-item-badges_recipient"
                              className="text-[0.64rem] font-medium text-v3-text-muted"
                            >
                              {getScheduledRecipientBadge(item.recipientType)}
                            </span>
                          </div>
                        }
                      />
                    );
                  }}
                />
              </div>
            ) : null}

            {showPastZone && !isOverallEmpty ? (
              <div data-component="desktop_messages_sections_split-layout_list-panel-3_zone-past">
                <div
                  data-component="desktop_messages_sections_split-layout_list-panel-3_zone-past_label"
                  className="flex items-center gap-2 px-1 pb-2 pt-1 text-[0.72rem] font-semibold text-v3-text-muted"
                >
                  <span>{MESSAGE_RECORD_ZONE_LABELS.past}</span>
                  {isPanelLoading ? (
                    <Skeleton
                      data-component="desktop_messages_sections_split-layout_list-panel-3_zone-past_count"
                      className="h-[18px] w-7 rounded-full bg-v3-dim-white"
                    />
                  ) : (
                    <span
                      data-component="desktop_messages_sections_split-layout_list-panel-3_zone-past_count"
                      className="inline-flex items-center rounded-full bg-v3-dim-white px-2 py-0.5 text-[0.66rem] font-semibold text-v3-text-muted"
                    >
                      {filteredHistoryRecords.length}
                    </span>
                  )}
                </div>
                <AnimatedSlotList<MessageHistoryRecord>
                  items={filteredHistoryRecords}
                  isLoading={isPanelLoading}
                  loadingCount={4}
                  className="space-y-2"
                  itemDataComponent="desktop_messages_sections_split-layout_list-panel-3_history-list_item"
                  getSlotState={({ item, isLoading: slotLoading }) => ({
                    isActive: !slotLoading && item?.id === selectedRecordId,
                    isInteractive: !slotLoading && Boolean(item),
                  })}
                  onSlotClick={(record) => setSelectedRecordId(record.id)}
                  render={({ item: record }) => {
                    if (!record) return null;
                    const statusMeta = getMessageHistoryListStatusMeta(record.status);
                    const ItemIcon = record.icon;
                    const inlineReason = record.status === "failed"
                      ? record.failureReason
                      : record.status === "canceled"
                        ? record.cancelReason
                        : undefined;

                    return (
                      <AnimatedSlotListItemContent
                        dataComponent="desktop_messages_sections_history-list-item"
                        icon={ItemIcon}
                        iconContainerClassName={getMessageHistoryAvatarClassName(record.status)}
                        title={record.title}
                        subtitle={record.recipientListLabel}
                        meta={inlineReason ? (
                          <span
                            data-component="desktop_messages_sections_split-layout_list-panel-3_zone-past_history-list-item-reason"
                            className="block max-w-full truncate"
                          >
                            {MESSAGE_RECORD_REASON_LABEL}: {inlineReason}
                          </span>
                        ) : undefined}
                        status={
                          <div
                            data-component="desktop_messages_sections_split-layout_list-panel-3_zone-past_history-list-item-meta"
                            className="flex shrink-0 flex-col items-end justify-end gap-1 text-right"
                          >
                            <StatusBadge
                              data-component="desktop_messages_sections_split-layout_list-panel-3_zone-past_history-list-item-meta_status"
                              variant={statusMeta.variant}
                              size="sm"
                            >
                              {statusMeta.label}
                            </StatusBadge>
                            <span
                              data-component="desktop_messages_sections_split-layout_list-panel-3_zone-past_history-list-item-meta_date"
                              className="whitespace-nowrap text-[0.68rem] text-v3-text-muted"
                            >
                              {formatHistoryDate(record.sentAt)}
                            </span>
                          </div>
                        }
                      />
                    );
                  }}
                />
              </div>
            ) : null}
          </>
        )}
      </ListPanel>

      {selectedJob ? (
        <DetailPanel data-component="desktop_messages_sections_split-layout_detail-panel"
          avatar={
            <div
              data-component="desktop_messages_sections_split-layout_detail-panel_upcoming-detail-avatar"
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[16px] bg-v3-primary-light text-v3-primary"
            >
              <Clock3 className="h-5 w-5" />
            </div>
          }
          title={`${selectedJob.payload.recipientName || "수신자"} 예약 발송`}
          subtitle={`${getHistoryTemplateLabel(selectedJob.templateKey)} · ${selectedJobPhone}`}
          badges={
            <StatusBadge
              data-component="desktop_messages_sections_upcoming-detail-status"
              variant={getScheduledJobStatusMeta(selectedJob.status).variant}
              size="sm"
            >
              {selectedJob.status === "processing" ? (
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
              ) : null}
              {getScheduledJobStatusMeta(selectedJob.status).label}
            </StatusBadge>
          }
          trailing={
            <div data-component="desktop_messages_sections_split-layout_detail-panel_upcoming-detail-trailing" className="flex items-center gap-2">
              <div
                data-component="desktop_messages_sections_split-layout_detail-panel_upcoming-detail-trailing_scheduled-at"
                className="inline-flex items-center gap-1 rounded-full bg-v3-primary-light px-3 py-1 text-[0.72rem] font-semibold text-v3-primary"
              >
                <CalendarClock className="h-3.5 w-3.5" />
                {formatScheduledPreviewDate(selectedJob.scheduledFor)}
              </div>
              {canCancelSelectedJob ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setCancelDialogOpen(true)}
                  disabled={cancelMutation.isPending}
                  data-component="desktop_messages_sections_split-layout_detail-panel_upcoming-detail-trailing_cancel-trigger"
                  className="rounded-full"
                >
                  <Ban className="h-3.5 w-3.5" aria-hidden="true" />
                  {MESSAGE_JOB_CANCEL_COPY.action}
                </Button>
              ) : null}
            </div>
          }
          tabs={
            <DetailTabs
              tabs={SCHEDULED_DETAIL_TABS}
              activeTab={scheduledDetailTab}
              onTabChange={handleScheduledDetailTabChange}
            />
          }
        >
          <DetailTabPanels
            activeTab={scheduledDetailTab}
            dataComponent="desktop_messages_sections_upcoming-detail-tab-panels"
            panelDataComponent="desktop_messages_sections_upcoming-detail-tab-panel"
            panels={[
              {
                key: "info",
                children: (
                  <div data-component="desktop_messages_sections_split-layout_detail-panel_upcoming-detail" className="space-y-4">
                    <InfoCard title="예약 개요" data-component="desktop_messages_sections_upcoming-detail-overview">
                      <InfoRow
                        data-component="desktop_messages_sections_upcoming-detail-overview-rule"
                        label="발송 규칙"
                        value={selectedJob.ruleName}
                      />
                      <InfoRow
                        data-component="desktop_messages_sections_upcoming-detail-overview-recipient"
                        label="수신자"
                        value={selectedJob.payload.recipientName || "-"}
                      />
                      <InfoRow
                        data-component="desktop_messages_sections_upcoming-detail-overview-scheduled-time"
                        label="발신 예정 시간"
                        value={formatScheduledDetailDate(selectedJob.scheduledFor)}
                      />
                      <InfoRow
                        data-component="desktop_messages_sections_upcoming-detail-overview-template"
                        label="템플릿"
                        value={getHistoryTemplateLabel(selectedJob.templateKey)}
                      />
                    </InfoCard>

                    <div
                      data-component="desktop_messages_sections_split-layout_detail-panel_upcoming-detail_upcoming-detail-grid"
                      className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
                    >
                      <InfoCard title="메시지 정보" data-component="desktop_messages_sections_upcoming-detail-meta">
                        <InfoRow
                          data-component="desktop_messages_sections_upcoming-detail-meta-recipient"
                          label="수신자 이름"
                          value={selectedJob.payload.recipientName || "-"}
                        />
                        <InfoRow
                          data-component="desktop_messages_sections_upcoming-detail-meta-phone"
                          label="전화번호"
                          value={selectedJobPhone}
                        />
                        <InfoRow
                          data-component="desktop_messages_sections_upcoming-detail-meta-scheduled-time"
                          label="발신 예정 시간"
                          value={formatScheduledDetailDate(selectedJob.scheduledFor)}
                        />
                        <InfoRow
                          data-component="desktop_messages_sections_upcoming-detail-meta-template"
                          label="메시지 템플릿 이름"
                          value={getHistoryTemplateLabel(selectedJob.templateKey)}
                        />
                        <InfoRow
                          data-component="desktop_messages_sections_upcoming-detail-meta-rule"
                          label="발송 규칙명"
                          value={selectedJob.ruleName}
                        />
                        <InfoRow
                          data-component="desktop_messages_sections_upcoming-detail-meta-recipient-type"
                          label="수신 유형"
                          value={getScheduledRecipientLabel(selectedJob.recipientType)}
                        />
                        <InfoRow
                          data-component="desktop_messages_sections_upcoming-detail-meta-event"
                          label="이벤트 기준"
                          value={getScheduledEventLabel(selectedJob.eventType)}
                        />
                      </InfoCard>

                      <InfoCard title="변수" data-component="desktop_messages_sections_upcoming-detail-variables">
                        {selectedJobVariables.length > 0 ? (
                          selectedJobVariables.map(([key, value], index) => (
                            <InfoRow
                              key={`${selectedJob.id}-${key}`}
                              data-component={`desktop_messages_sections_upcoming-detail-variable-${index + 1}`}
                              label={SCHEDULED_VARIABLE_LABELS[key] ?? key}
                              value={value || "-"}
                            />
                          ))
                        ) : (
                          <InfoRow
                            data-component="desktop_messages_sections_upcoming-detail-variable-empty"
                            label="변수"
                            value={<span className="font-normal text-v3-text-muted">변수 정보가 없습니다.</span>}
                          />
                        )}
                      </InfoCard>
                    </div>
                  </div>
                ),
              },
              {
                key: "message",
                children: (
                  <InfoCard
                    title="메시지 내용"
                    data-component="desktop_messages_sections_upcoming-detail-message"
                    className="flex min-h-[420px] flex-col"
                    contentClassName="flex flex-1"
                  >
                    <div
                      data-component="desktop_messages_sections_upcoming-detail-message_generated-msg-detail-content-body"
                      className={cn(
                        "flex min-h-[320px] flex-1",
                        APP_CONTENT_BODY_CARD_CLASS_NAME,
                      )}
                    >
                      <MsgField label="메시지 내용" value={selectedJobMessageBody} />
                    </div>
                  </InfoCard>
                ),
              },
            ]}
          />
        </DetailPanel>
      ) : (
        <MessageHistoryDetailPanel
          dataComponentPrefix="desktop_messages_sections_section-content_history-section_split-layout_detail-panel"
          selectedRecord={selectedRecord}
          canRetry={canRetry}
          isRetrying={isRetrying}
          onRetry={handleRetry}
        />
      )}
    </SplitLayout>

    <TwoButtonModal
      open={cancelDialogOpen}
      onOpenChange={setCancelDialogOpen}
      title={MESSAGE_JOB_CANCEL_COPY.confirmTitle}
      description={MESSAGE_JOB_CANCEL_COPY.confirmBody}
      cancelLabel={MESSAGE_JOB_CANCEL_COPY.dismiss}
      approvalLabel={MESSAGE_JOB_CANCEL_COPY.confirmAction}
      approvalVariant="destructive"
      isPending={cancelMutation.isPending}
      isDescriptionVisuallyHidden={false}
      onApprove={() => void handleCancelJob()}
      data-component="desktop_messages_sections_upcoming-cancel-confirmation"
    />
    </>
  );
}

export default function MessagesPage() {
  const locale = useLocale();
  const [activeSection, setActiveSection] = useState<MessageSectionId>("send");
  const [templateFilter, setTemplateFilter] = useState<TemplateFilter>("builtin");
  const [templateDetailTab, setTemplateDetailTab] = useState<TemplateDetailTab>("details");
  const [templatePreviewOverride, setTemplatePreviewOverride] = useState<string | null>(null);
  const [templateSendSubmitState, setTemplateSendSubmitState] =
    useState<TemplateSendFormSubmitState | null>(null);
  const user = useInitialUser();
  const isOwner = user?.role === ROLES.owner;
  const { data: senderApproval } = useMessageSenderApproval();
  const isSenderApprovalRequired = senderApproval?.isApproved === false;
  const messageSections = useMemo(
    () => MESSAGE_SECTIONS.map((section) => ({
      ...section,
      disabled:
        (isSenderApprovalRequired && !SENDER_APPROVAL_EXEMPT_SECTION_IDS.has(section.id)) ||
        (UNRELEASED_SECTION_IDS.has(section.id) && !isOwner),
    })),
    [isOwner, isSenderApprovalRequired],
  );

  const { data: userTemplatesData, isLoading: isLoadingUserTemplates } = useMessageTemplates(1, 100);
  const userTemplates = useMemo(() => userTemplatesData ?? [], [userTemplatesData]);

  const userTemplateItems = useMemo<TemplateListItem[]>(() => {
    return userTemplates.map((template) => ({
      id: `user:${template.id}`,
      label: template.name,
      icon: FileText,
    }));
  }, [userTemplates]);

  const visibleItems = useMemo(
    () => (templateFilter === "builtin" ? BUILTIN_TEMPLATES : userTemplateItems),
    [templateFilter, userTemplateItems]
  );
  const templateItemIds = useMemo(() => visibleItems.map((item) => item.id), [visibleItems]);
  const {
    selectedId: selectedValue,
    setSelectedId: setSelectedValue,
    setSplitLayoutMode: setTemplateSplitLayoutMode,
  } = useSplitLayoutSelection(templateItemIds);
  const isTemplateListLoading = templateFilter === "branch" && isLoadingUserTemplates;

  const handleTemplateSelect = useCallback((id: string) => {
    setSelectedValue(id);
    setTemplateDetailTab("details");
    setTemplatePreviewOverride(null);
  }, [setSelectedValue]);

  const handleTemplateFilterChange = useCallback(
    (nextFilter: TemplateFilter) => {
      const nextItems = nextFilter === "builtin" ? BUILTIN_TEMPLATES : userTemplateItems;

      setTemplateFilter(nextFilter);
      setTemplateDetailTab("details");
      setTemplatePreviewOverride(null);
      setSelectedValue((current) => {
        if (current && nextItems.some((item) => item.id === current)) {
          return current;
        }

        return null;
      });
    },
    [setSelectedValue, userTemplateItems]
  );

  const activeTemplateId = useMemo(() => {
    if (!selectedValue) return null;
    return visibleItems.find((item) => item.id === selectedValue)?.id ?? null;
  }, [selectedValue, visibleItems]);

  const isBuiltin = activeTemplateId?.startsWith("builtin:") ?? false;
  const builtinType = isBuiltin && activeTemplateId ? (activeTemplateId.replace("builtin:", "") as BuiltinTemplateType) : null;
  const userTemplateId = !isBuiltin && activeTemplateId?.startsWith("user:") ? activeTemplateId.replace("user:", "") : null;
  const isBranchTemplate = userTemplateId !== null;
  const selectedUserTemplate = userTemplateId ? userTemplates.find((template) => template.id === userTemplateId) : null;
  const SelectedBuiltinForm = builtinType ? FormComponents[builtinType] : null;
  const selectedTemplateItem = useMemo(
    () => visibleItems.find((item) => item.id === activeTemplateId) ?? null,
    [activeTemplateId, visibleItems]
  );
  const selectedTemplateIcon = selectedTemplateItem?.icon ?? FileText;
  const SelectedTemplateIcon = selectedTemplateIcon;
  const selectedTemplateTitle = selectedTemplateItem?.label ?? selectedUserTemplate?.name ?? "메시지 템플릿";
  const selectedTemplateSubtitle = isBranchTemplate
    ? selectedUserTemplate
      ? `지점 템플릿 · ${selectedUserTemplate.variables.length}개 변수`
      : "지점 템플릿 · 정보를 불러오지 못했습니다."
    : "기본 템플릿은 오너 관리자 페이지에서 관리됩니다.";
  const selectedBuiltinSystemKey = builtinType ? BUILTIN_TEMPLATE_SYSTEM_KEYS[builtinType] : "";
  const { data: selectedBuiltinSystemTemplate } = useSystemTemplate(selectedBuiltinSystemKey);
  const builtinPreviewMeta = builtinType ? BUILTIN_TEMPLATE_PREVIEW_META[builtinType] : null;
  const templatePreviewMessage =
    templatePreviewOverride ??
    selectedUserTemplate?.content ??
    selectedBuiltinSystemTemplate?.content ??
    "";
  const templatePreviewHeadline = isBranchTemplate ? selectedTemplateTitle : builtinPreviewMeta?.headline;
  const templatePreviewSubtitle = isBranchTemplate ? "지점 템플릿" : builtinPreviewMeta?.subtitle;
  const templatePreviewGeneratedTitle = t(locale, "common.generated-message-title");
  const templatePreviewMetaItems = useMemo(
    () => [
      { label: "구성 영역", value: templatePreviewGeneratedTitle },
      { label: "메시지 길이", value: `${templatePreviewMessage.length}자` },
      {
        label: "문단 수",
        value: `${templatePreviewMessage.split("\n").filter((line) => line.trim().length > 0).length}개`,
      },
      { label: "편집 상태", value: "수정 가능" },
    ],
    [templatePreviewGeneratedTitle, templatePreviewMessage],
  );
  const templatePreviewVariableItems = useMemo<AutoFillMsgCardVariableItem[]>(() => {
    if (selectedUserTemplate?.variables.length) {
      return selectedUserTemplate.variables.map((variable) => ({
        token: `{{${variable.key}}}`,
        label: variable.label,
        value: "-",
      }));
    }

    const tokenPattern = /{{\s*([^{}]+?)\s*}}|#\{([^{}]+?)\}/g;
    const seenTokens = new Set<string>();
    const items: AutoFillMsgCardVariableItem[] = [];
    let match = tokenPattern.exec(templatePreviewMessage);

    while (match) {
      const token = match[0];
      const label = match[1] ?? match[2] ?? token;

      if (!seenTokens.has(token)) {
        seenTokens.add(token);
        items.push({
          token,
          label,
          value: "-",
        });
      }

      match = tokenPattern.exec(templatePreviewMessage);
    }

    return items;
  }, [selectedUserTemplate, templatePreviewMessage]);
  const sendTemplateFormLayout: TemplateMessageFormLayout = ({
    fields,
    messageCard,
    requiresRecipientName,
    deliveryMode,
    serviceRecordLinkPreparation,
  }) => {
    const flattenedMessageCard = isValidElement(messageCard)
      ? cloneElement(messageCard as ReactElement<{ layout?: "flat" }>, { layout: "flat" })
      : messageCard;

    return (
      <div
        data-component="desktop_messages_sections_template-send-layout"
        className="grid h-full min-h-0 items-stretch gap-4 xl:grid-cols-[minmax(14rem,0.85fr)_minmax(0,1.45fr)]"
      >
        <TemplateSendForm
          key={activeTemplateId}
          templateId={activeTemplateId ?? selectedTemplateTitle}
          templateName={selectedTemplateTitle}
          message={templatePreviewMessage}
          requiresRecipientName={requiresRecipientName}
          deliveryMode={deliveryMode}
          serviceRecordLinkPreparation={serviceRecordLinkPreparation}
          className="h-full"
          formId={TEMPLATE_SEND_FORM_ID}
          showSubmitButton={false}
          onSubmitStateChange={setTemplateSendSubmitState}
        >
          {fields}
        </TemplateSendForm>
        {flattenedMessageCard}
      </div>
    );
  };
  const selectedTemplateRenderLayout =
    activeSection === "send" ? sendTemplateFormLayout : undefined;
  const selectedTemplateHeaderTrailing = activeTemplateId ? (
    <>
      {selectedUserTemplate ? (
        <div
          data-component="desktop_messages_sections_template-detail-summary"
          className="inline-flex items-center gap-1 rounded-full bg-v3-primary-light px-3 py-1 text-[0.72rem] font-semibold text-v3-primary"
        >
          <FileText className="h-3.5 w-3.5" />
          {`${selectedUserTemplate.variables.length}개 변수`}
        </div>
      ) : null}

      {activeSection === "send" ? (
        <Button
          type="submit"
          form={templateSendSubmitState?.formId ?? TEMPLATE_SEND_FORM_ID}
          disabled={!templateSendSubmitState || templateSendSubmitState.isSubmitDisabled}
          className="shrink-0"
        >
          {templateSendSubmitState?.isSending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Send className="h-4 w-4" aria-hidden="true" />
          )}
          {templateSendSubmitState?.isSending ? "발송 중…" : "즉시 발송"}
        </Button>
      ) : null}
    </>
  ) : undefined;
  const selectedTemplateFormContent = (
    <>
      {SelectedBuiltinForm ? (
        <SelectedBuiltinForm
          onPreviewMessageChange={(message) => setTemplatePreviewOverride(message)}
          renderLayout={selectedTemplateRenderLayout}
          showMessageSide={false}
        />
      ) : null}

      {selectedUserTemplate ? (
        <CustomTemplateForm
          template={selectedUserTemplate as never}
          onPreviewMessageChange={(message) => setTemplatePreviewOverride(message)}
          renderLayout={selectedTemplateRenderLayout}
          showMessageSide={false}
        />
      ) : null}

      {!SelectedBuiltinForm && !selectedUserTemplate ? (
        <DetailEmptyState
          message="선택한 템플릿 정보를 불러오지 못했습니다."
        />
      ) : null}
    </>
  );

  return (
    <PageSection name="desktop_messages_sections">
      <div
        data-slot="page-sections"
        className="flex flex-1 min-h-0 flex-col gap-4 lg:flex-row lg:items-stretch"
      >
        <SectionNav
          data-component="desktop_messages_sections_section-nav"
          ariaLabel="메시지 기능"
          items={messageSections}
          activeId={activeSection}
          onSelect={(id) => setActiveSection(id as MessageSectionId)}
        />

        <div data-component="desktop_messages_sections_section-content" className="flex min-h-0 min-w-0 flex-1 flex-col">
          {/*
            "scheduled" is unreachable: MESSAGE_SECTION_DEFINITIONS no longer has a
            scheduled entry, so SectionNav can never set activeSection to it — its
            content now lives inside the "history" branch below. This branch stays
            only so activeSection is fully narrowed (to `never`) by the time it
            reaches the generic MessageSectionPlaceholder fallback at the end of
            this chain, keeping that fallback's PlaceholderSectionId prop type-safe
            now that PlaceholderSectionId itself excludes "scheduled".
          */}
          {activeSection === "scheduled" ? null : activeSection === "send" || activeSection === "templates" ? (
            <MessageApprovalGate dataComponent="desktop_messages_sections_section-content_templates-section_approval-gate">
            <section
              data-component={
                activeSection === "send"
                  ? "desktop_messages_sections_section-content_send-section"
                  : "desktop_messages_sections_section-content_templates-section"
              }
              className="flex min-h-0 flex-1 flex-col"
            >
              <SplitLayout data-component="desktop_messages_sections_split-layout-4"
                hasSelection={!!activeTemplateId}
                onModeChange={setTemplateSplitLayoutMode}
                onBack={() => {
                  setSelectedValue(null);
                  setTemplateDetailTab("details");
                  setTemplatePreviewOverride(null);
                }}
              >
                <ListPanel data-component="desktop_messages_sections_split-layout_list-panel-4"
                  title="메시지 템플릿"
                  tabs={TEMPLATE_FILTERS}
                  activeTab={templateFilter}
                  onTabChange={(value) => handleTemplateFilterChange(value as TemplateFilter)}
                  headerActions={
                    templateFilter === "branch" ? (
                      <div data-component="desktop_messages_sections_split-layout_list-panel-4_templates-actions" className="flex items-center gap-1.5">
                        <HeaderActionButton
                          icon={Plus}
                          label={t(locale, "msg-form.add-template")}
                          href="/messages/templates/new"
                        />
                        <HeaderActionButton
                          icon={FilePen}
                          label={t(locale, "msg-form.edit-template")}
                          href="/messages/templates"
                          variant="muted"
                        />
                      </div>
                    ) : undefined
                  }
                  emptyState={!(isTemplateListLoading || visibleItems.length > 0) && templateFilter === "branch" && !isLoadingUserTemplates ? (
                    <ListEmptyState message="등록된 지점 템플릿이 없습니다." />
                  ) : undefined}
                >
                  {isTemplateListLoading || visibleItems.length > 0 ? (
                    <div data-component="desktop_messages_sections_split-layout_list-panel-4_templates-list" className="space-y-2 pb-2">
                      <AnimatedSlotList<TemplateListItem>
                        items={visibleItems}
                        isLoading={isTemplateListLoading}
                        className="space-y-2"
                        getSlotState={({ item, isLoading }) => ({
                          isActive: !isLoading && item?.id === activeTemplateId,
                          isInteractive: !isLoading && Boolean(item),
                        })}
                        onSlotClick={(item) => handleTemplateSelect(item.id)}
                        render={({ item, isLoading }) => {
                          if (isLoading) {
                            return (
                              <>
                                <div
                                  data-component="desktop_messages_sections_split-layout_list-panel-4_templates-list_template-skeleton-icon"
                                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] bg-v3-dim-white"
                                >
                                  <Skeleton className="h-4 w-4 rounded-md bg-white/70" />
                                </div>
                                <div data-component="desktop_messages_sections_split-layout_list-panel-4_templates-list_template-skeleton-copy" className="min-w-0 flex-1">
                                  <Skeleton className="h-4 w-32 bg-v3-dim-white" />
                                </div>
                              </>
                            );
                          }

                          if (!item) return null;

                          return (
                            <AnimatedSlotListItemContent
                              dataComponent="desktop_messages_sections_template-item"
                              icon={item.icon}
                              title={item.label}
                            />
                          );
                        }}
                      />
                    </div>
                  ) : null}
                </ListPanel>

                <DetailPanel data-component="desktop_messages_sections_templates_split-layout_detail-panel"
                  avatar={
                    activeTemplateId ? (
                      <div
                        data-component="desktop_messages_sections_templates_split-layout_detail-panel_template-detail-avatar"
                        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[16px] bg-v3-primary-light text-v3-primary"
                      >
                        <SelectedTemplateIcon className="h-5 w-5" />
                      </div>
                    ) : undefined
                  }
                  title={activeTemplateId ? selectedTemplateTitle : undefined}
                  subtitle={activeTemplateId ? selectedTemplateSubtitle : undefined}
                  badges={
                    activeTemplateId ? (
                      <span
                        data-component="desktop_messages_sections_template-detail-badge"
                        className={cn(
                          "inline-flex items-center rounded-full px-3 py-1 text-[0.68rem] font-semibold",
                          isBranchTemplate
                            ? "bg-v3-dim-white text-v3-text-muted"
                            : "bg-v3-primary-light text-v3-primary"
                        )}
                      >
                        {isBranchTemplate ? "지점 템플릿" : "기본 템플릿"}
                      </span>
                    ) : undefined
                  }
                  trailing={selectedTemplateHeaderTrailing}
                  tabs={
                    activeTemplateId ? (
                      <DetailTabs
                        tabs={TEMPLATE_DETAIL_TABS}
                        activeTab={templateDetailTab}
                        onTabChange={(key) => setTemplateDetailTab(key as TemplateDetailTab)}
                      />
                    ) : undefined
                  }
                >
                  {!activeTemplateId ? (
                    <DetailEmptyState
                      message="왼쪽 목록에서 템플릿을 선택해 주세요."
                    />
                  ) : (
                    <DetailTabPanels
                      activeTab={templateDetailTab}
                      dataComponent="desktop_messages_sections_template-detail-tabpanes"
                      panelDataComponent="desktop_messages_sections_template-detail-pane"
                      className={
                        templateDetailTab === "preview" || activeSection === "send"
                          ? "flex min-h-0 flex-1"
                          : "min-h-0 shrink-0"
                      }
                      trackClassName={
                        templateDetailTab === "preview" || activeSection === "send"
                          ? "min-h-0 flex-1"
                          : "min-h-0"
                      }
                      panelClassName={
                        templateDetailTab === "preview" || activeSection === "send"
                          ? "h-full min-h-0"
                          : "min-h-0"
                      }
                      panels={[
                        {
                          key: "details",
                          className: activeSection === "send"
                            ? "min-h-0"
                            : undefined,
                          children: selectedTemplateFormContent,
                        },
                        {
                          key: "preview",
                          className: "flex min-h-0 justify-center overflow-y-auto",
                          children: (
                            <div
                              data-component="desktop_messages_sections_templates_split-layout_detail-panel_template-preview-layout"
                              className="flex min-h-0 w-full flex-wrap items-start justify-center gap-4"
                            >
                              <MessagePhonePreview
                                className="h-full min-h-0 overflow-hidden py-0"
                                content={templatePreviewMessage}
                                templateName={selectedTemplateTitle}
                                headline={templatePreviewHeadline}
                                subtitle={templatePreviewSubtitle}
                                dataComponentPrefix="desktop_messages_sections_section-content_templates-section_split-layout_detail-panel_preview"
                                panelDataComponent="desktop_messages_sections_template-preview-phone-panel"
                              />
                              <AutoFillMsgCardSide
                                title={templatePreviewGeneratedTitle}
                                message={templatePreviewMessage}
                                metaItems={templatePreviewMetaItems}
                                variableItems={templatePreviewVariableItems}
                                className="w-full min-w-[260px] max-w-[360px] shrink-0"
                              />
                            </div>
                          ),
                        },
                      ]}
                    />
                  )}
                </DetailPanel>
              </SplitLayout>
            </section>
            </MessageApprovalGate>
          ) : activeSection === "history" ? (
            <MessageApprovalGate dataComponent="desktop_messages_sections_section-content_history-section_approval-gate">
              <section data-component="desktop_messages_sections_section-content_history-section" className="flex min-h-0 flex-1 flex-col">
                <MessageHistorySection />
              </section>
            </MessageApprovalGate>
          ) : activeSection === "triggers" ? (
            <MessageApprovalGate dataComponent="desktop_messages_sections_section-content_triggers-section_approval-gate">
              <section
                data-component="desktop_messages_sections_section-content_triggers-section"
                data-slot="trigger-rules-section"
                className="flex h-full min-h-0 flex-1 flex-col"
              >
                <TriggerRulesManager
                  dataComponent="desktop_messages_sections_section-content_triggers-section_trigger-rules"
                  channel="sms"
                />
              </section>
            </MessageApprovalGate>
          ) : activeSection === "settings" ? (
            <section data-component="desktop_messages_sections_section-content_settings-section" className="flex min-h-0 flex-1 flex-col">
              <MessageTenantApplicationSettings />
            </section>
          ) : (
            <MessageApprovalGate dataComponent={`desktop_messages_sections_section-content_${activeSection}-section_approval-gate`}>
              <section
                data-component={`desktop_messages_sections_section-content_${activeSection}-section`}
                className="flex min-h-0 flex-1 flex-col"
              >
                <MessageSectionPlaceholder sectionId={activeSection} />
              </section>
            </MessageApprovalGate>
          )}
        </div>
      </div>
    </PageSection>
  );
}
