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
  MESSAGE_JOB_STATUS_LABELS,
  MESSAGE_RECIPIENT_LABELS,
  MESSAGE_SECTION_DEFINITIONS,
  formatMessageDateTimeCompact,
  formatMessageDateTimeDetail,
  getMessageTemplateLabel,
  type MessageSectionId as SharedMessageSectionId,
} from "@babyjamjam/shared";
import { t } from "@/lib/i18n/translations";
import { useLocale } from "@/providers/LocaleProvider";
import { useMessageTemplates } from "@/features/message-templates/hooks/use-message-templates";
import { useSystemTemplate } from "@/features/system-templates/hooks";
import type { SystemTemplateKey } from "@/features/system-templates/types";
import {
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
  matchesMessageHistoryQuery as matchesHistoryQuery,
  MessageHistoryDetailPanel,
  MESSAGE_HISTORY_FILTER_META,
  MESSAGE_HISTORY_TABS,
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
import { matchesSearchQuery } from "@/lib/search/korean-search";
import { findMessageHistoryClient } from "@/lib/message-history/client-match";
import { renderTemplate } from "@/lib/template-utils";
import { cn } from "@/lib/utils";
import {
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
  Users,
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
import { MessageApprovalGate } from "@/components/app/messages/MessageApprovalGate";
import { TriggerRulesManager } from "@/components/app/messages/TriggerRulesManager";
import { Button } from "@/components/ui/button";
import {
  APP_CONTENT_BODY_CARD_CLASS_NAME,
  APP_CONTENT_BODY_CARD_OUTLINED_CLASS_NAME,
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

const MESSAGE_SECTIONS = [
  { ...MESSAGE_SECTION_DEFINITIONS[0], icon: Send },
  { ...MESSAGE_SECTION_DEFINITIONS[1], icon: Clock3 },
  { ...MESSAGE_SECTION_DEFINITIONS[2], icon: History },
  { ...MESSAGE_SECTION_DEFINITIONS[3], icon: FileText, disabled: true },
  { ...MESSAGE_SECTION_DEFINITIONS[4], icon: Workflow },
  { ...MESSAGE_SECTION_DEFINITIONS[5], icon: Settings2 },
] as const;

type MessageSectionId = SharedMessageSectionId;
type PlaceholderSectionId = Exclude<MessageSectionId, "send" | "templates" | "triggers" | "history">;

const TEMPLATE_SEND_FORM_ID = "messages-template-send-form-active";

function getMessageHistoryListStatusMeta(status: MessageHistoryRecord["status"]) {
  if (status === "sent") return { label: MESSAGE_HISTORY_STATUS_LABELS.sent, variant: "success" as const };
  if (status === "pending") return { label: MESSAGE_HISTORY_STATUS_LABELS.pending, variant: "warning" as const };
  if (status === "canceled") return { label: MESSAGE_HISTORY_STATUS_LABELS.canceled, variant: "neutral" as const };
  return { label: MESSAGE_HISTORY_STATUS_LABELS.failed, variant: "danger" as const };
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
  return status === "processing"
    ? {
        label: MESSAGE_JOB_STATUS_LABELS[status],
        className: "bg-sky-100 text-sky-700",
      }
    : {
        label: MESSAGE_JOB_STATUS_LABELS[status],
        className: status === "failed" || status === "canceled"
          ? "bg-red-100 text-red-700"
          : status === "sent"
            ? "bg-emerald-100 text-emerald-700"
            : "bg-amber-100 text-amber-700",
      };
}

type MessageHistoryRelativeDateFilter = "all" | "1d" | "7d" | "30d";
type ScheduledPreviewFilter = "all" | "customer" | "staff";
type ScheduledDetailTab = "info" | "message";
type TemplateDetailTab = "details" | "preview";

const PLACEHOLDER_COPY: Record<
  PlaceholderSectionId,
  { description: string; helper: string; items: PlaceholderPreviewItem[] }
> = {
  scheduled: {
    description: "발송이 예정된 메시지를 확인할 수 있어요.",
    helper: "예정 발송 목록 컴포넌트를 연결하면 이 섹션에서 예약 현황을 확인할 수 있습니다.",
    items: [
      {
        id: "scheduled-queue",
        label: "김서연",
        summary: "인사 메시지 · 3월 11일 09:00",
        badge: "고객",
        detailTitle: "김서연 예약 발송",
        detailDescription: "고객 김서연님에게 발송될 인사 메시지 예약 건으로, 템플릿 제목과 발송 예정 시각을 함께 확인하는 상세 영역입니다.",
        checklist: ["받는 사람: 고객", "템플릿: 인사 메시지", "발송 예정: 3월 11일 09:00"],
        recipientName: "김서연",
        recipientType: "고객",
        recipientPhone: "010-2481-9032",
        templateTitle: "인사 메시지",
        scheduledAt: "3월 11일 09:00",
        messageBody:
          "김서연님, 안녕하세요.\n아가잼잼 산후도우미 서비스 등록이 완료되었어요.\n담당 매니저는 한지민 매니저로 배정될 예정이며, 확정되면 다시 안내드릴게요.\n문의사항은 언제든 편하게 연락 주세요.",
        variableAssignments: [
          { token: "#{고객명}", label: "수신자 이름", value: "김서연" },
          { token: "#{서비스명}", label: "예약된 서비스", value: "산후도우미 서비스" },
          { token: "#{담당자명}", label: "배정 예정 매니저", value: "한지민 매니저" },
        ],
      },
      {
        id: "scheduled-today",
        label: "박지민",
        summary: "리마인더 · 3월 11일 14:30",
        badge: "직원",
        detailTitle: "박지민 예약 발송",
        detailDescription: "직원 박지민님에게 발송될 리마인더 예약 건으로, 발송 대상과 예약 시간을 빠르게 점검할 수 있는 상세 영역입니다.",
        checklist: ["받는 사람: 직원", "템플릿: 리마인더", "발송 예정: 3월 11일 14:30"],
        recipientName: "박지민",
        recipientType: "직원",
        recipientPhone: "010-5538-1120",
        templateTitle: "리마인더",
        scheduledAt: "3월 11일 14:30",
        messageBody:
          "박지민님, 오늘 오후 2시 30분 보호자 상담 일정이 예정되어 있어요.\n상담 시작 10분 전까지 회의실 2번으로 입장해 주세요.\n변동이 필요하면 운영팀에 바로 알려주세요.",
        variableAssignments: [
          { token: "#{수신자명}", label: "수신자 이름", value: "박지민" },
          { token: "#{상담시간}", label: "예약된 상담 시간", value: "오후 2시 30분" },
          { token: "#{상담장소}", label: "안내된 장소", value: "회의실 2번" },
        ],
      },
      {
        id: "scheduled-trigger",
        label: "이하은",
        summary: "요금 안내 · 3월 12일 10:00",
        badge: "고객",
        detailTitle: "이하은 예약 발송",
        detailDescription: "고객 이하은님에게 발송될 요금 안내 예약 건으로, 템플릿 제목과 예정 발송 시간을 확인할 수 있는 상세 영역입니다.",
        checklist: ["받는 사람: 고객", "템플릿: 요금 안내", "발송 예정: 3월 12일 10:00"],
        recipientName: "이하은",
        recipientType: "고객",
        recipientPhone: "010-8804-6621",
        templateTitle: "요금 안내",
        scheduledAt: "3월 12일 10:00",
        messageBody:
          "이하은님, 정부지원 바우처 서비스 비용을 안내드려요.\n4주 과정 기준 총 이용금액은 1,280,000원이며, 정부 지원금은 980,000원입니다.\n본인 부담금은 300,000원이고, 예약금 입금 후 일정이 최종 확정됩니다.",
        variableAssignments: [
          { token: "#{고객명}", label: "수신자 이름", value: "이하은" },
          { token: "#{서비스기간}", label: "이용 예정 기간", value: "4주 과정" },
          { token: "#{본인부담금}", label: "안내된 본인 부담금", value: "300,000원" },
        ],
      },
    ],
  },
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

const SCHEDULED_PREVIEW_TABS: {
  value: ScheduledPreviewFilter;
  label: string;
}[] = [
  { value: "all", label: "전체" },
  { value: "customer", label: "고객" },
  { value: "staff", label: "직원" },
];

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

function getScheduledRecipientBadge(recipientType: TriggerRecipientType) {
  return recipientType === "CLIENT" ? MESSAGE_RECIPIENT_LABELS.CLIENT : "직원";
}

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

function MessageScheduledSection() {
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [scheduledFilter, setScheduledFilter] = useState<ScheduledPreviewFilter>("all");
  const [scheduledDetailTab, setScheduledDetailTab] = useState<ScheduledDetailTab>("info");
  const [scheduledSearchValue, setScheduledSearchValue] = useState("");
  const deferredScheduledSearchValue = useDeferredValue(scheduledSearchValue);
  const { data: upcomingJobs = [], isLoading } = useUpcomingMessageTriggerJobs();
  const smsUpcomingJobs = useMemo(
    () => upcomingJobs.filter((job) => isUpcomingJobInChannel(job, "sms")),
    [upcomingJobs],
  );

  const filteredJobs = useMemo(() => {
    return smsUpcomingJobs
      .filter((job) => {
        const matchesRecipientType =
          scheduledFilter === "all" ||
          (scheduledFilter === "customer"
            ? job.recipientType === "CLIENT"
            : job.recipientType === "PRIMARY_EMPLOYEE" || job.recipientType === "SECONDARY_EMPLOYEE");

        if (!matchesRecipientType) {
          return false;
        }

        return matchesScheduledJobQuery(job, deferredScheduledSearchValue);
      })
      .sort((left, right) => new Date(left.scheduledFor).getTime() - new Date(right.scheduledFor).getTime());
  }, [deferredScheduledSearchValue, scheduledFilter, smsUpcomingJobs]);

  const selectedJob = useMemo(() => {
    if (!selectedJobId) return null;
    return filteredJobs.find((job) => job.id === selectedJobId) ?? null;
  }, [filteredJobs, selectedJobId]);

  const hasScheduledSearchQuery = deferredScheduledSearchValue.trim().length > 0;
  const hasScheduledFilters = scheduledFilter !== "all" || hasScheduledSearchQuery;
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

  return (
    <div data-component="messages-scheduled-layout" className="flex min-h-[560px] flex-1 flex-col">
      <SplitLayout data-component="desktop_messages_split-layout"
        hasSelection={!!selectedJob}
        onBack={() => {
          setSelectedJobId(null);
          setScheduledDetailTab("info");
        }}
      >
        <ListPanel data-component="desktop_messages_split-layout_list-panel"
          title="발송 예정"
          subtitle="발송이 예정된 메시지를 확인할 수 있어요."
          tabs={SCHEDULED_PREVIEW_TABS}
          activeTab={scheduledFilter}
          onTabChange={(value) => {
            setScheduledFilter(value as ScheduledPreviewFilter);
            setSelectedJobId(null);
            setScheduledDetailTab("info");
          }}
          searchValue={scheduledSearchValue}
          onSearchChange={(value) => {
            setScheduledSearchValue(value);
            setSelectedJobId(null);
            setScheduledDetailTab("info");
          }}
          searchPlaceholder="이름, 연락처, 템플릿 검색…"
          headerActions={
            <span
              data-component="messages-scheduled-list-badge"
              className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full bg-v3-primary-light px-3 py-1 text-[0.72rem] font-semibold text-v3-primary"
            >
              {(hasScheduledFilters ? filteredJobs.length : smsUpcomingJobs.length)}개
            </span>
          }
          emptyState={!(isLoading || filteredJobs.length > 0) ? (
            <ListEmptyState
              message={
                hasScheduledFilters ? "조건에 맞는 예약 발송 항목이 없습니다." : "발송 예정 항목이 없습니다."
              }
            />
          ) : undefined}
        >
          <div data-component="messages-scheduled-list" className="space-y-3 pb-2">
            <AnimatedSlotList<UpcomingMessageTriggerJob>
                items={filteredJobs}
                isLoading={isLoading}
                loadingCount={5}
                className="space-y-2"
                itemDataComponent="messages-scheduled-list-item"
                getSlotState={({ item, isLoading: slotLoading }) => ({
                  isActive: !slotLoading && item?.id === selectedJobId,
                  isInteractive: !slotLoading && Boolean(item),
                })}
                onSlotClick={(item) => {
                  setSelectedJobId(item.id);
                  setScheduledDetailTab("info");
                }}
                render={({ item }) => {
                  if (!item) return null;
                  const statusMeta = getScheduledJobStatusMeta(item.status);

                  return (
                    <AnimatedSlotListItemContent
                      dataComponent="messages-scheduled-list-item"
                      icon={Clock3}
                      iconContainerClassName="text-v3-primary"
                      title={item.payload.recipientName || "-"}
                      subtitle={`${getHistoryTemplateLabel(item.templateKey)} · ${formatScheduledPreviewDate(item.scheduledFor)}`}
                      status={
                        <div
                          data-component="messages-scheduled-list-item-badges"
                          className="flex shrink-0 flex-col items-end gap-1"
                        >
                          <span
                            data-component="messages-scheduled-list-item-status"
                            className={cn(
                              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.66rem] font-semibold",
                              statusMeta.className,
                            )}
                          >
                            {item.status === "processing" ? (
                              <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                            ) : null}
                            {statusMeta.label}
                          </span>
                          <span
                            data-component="messages-scheduled-list-item-recipient"
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
        </ListPanel>

        <DetailPanel data-component="desktop_messages_scheduled_split-layout_detail-panel"
          avatar={selectedJob ? (
            <div
              data-component="messages-scheduled-detail-avatar"
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[16px] bg-v3-primary-light text-v3-primary"
            >
              <Clock3 className="h-5 w-5" />
            </div>
          ) : undefined}
          title={selectedJob ? `${selectedJob.payload.recipientName || "수신자"} 예약 발송` : undefined}
          subtitle={
            selectedJob
              ? `${getHistoryTemplateLabel(selectedJob.templateKey)} · ${selectedJobPhone}`
              : undefined
          }
          badges={
            selectedJob ? (
              <span
                data-component="messages-scheduled-detail-status"
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-3 py-1 text-[0.7rem] font-semibold",
                  getScheduledJobStatusMeta(selectedJob.status).className,
                )}
              >
                {selectedJob.status === "processing" ? (
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                ) : null}
                {getScheduledJobStatusMeta(selectedJob.status).label}
              </span>
            ) : null
          }
          trailing={
            selectedJob ? (
              <div
                data-component="messages-scheduled-detail-scheduled-at"
                className="inline-flex items-center gap-1 rounded-full bg-v3-primary-light px-3 py-1 text-[0.72rem] font-semibold text-v3-primary"
              >
                <CalendarClock className="h-3.5 w-3.5" />
                {formatScheduledPreviewDate(selectedJob.scheduledFor)}
              </div>
            ) : null
          }
          tabs={
            selectedJob ? (
              <DetailTabs
                tabs={SCHEDULED_DETAIL_TABS}
                activeTab={scheduledDetailTab}
                onTabChange={handleScheduledDetailTabChange}
              />
            ) : undefined
          }
          emptyState={
            !isLoading && !selectedJob ? (
              <DetailEmptyState
                name="messages-scheduled-detail-empty"
                icon={Users}
                message={
                  filteredJobs.length === 0 && hasScheduledFilters
                    ? "조건에 맞는 예약 발송 항목이 없습니다."
                    : "발송 예정 메시지를 선택하면 상세 정보가 표시됩니다."
                }
                className="flex-none min-h-0"
              />
            ) : undefined
          }
        >
          {isLoading ? (
            <div data-component="messages-scheduled-detail-skeleton" className="space-y-4">
              {[0, 1, 2].map((index) => (
                <div
                  key={index}
                  data-component="messages-scheduled-detail-skeleton-card"
                  className="rounded-[18px] bg-v3-dim-white p-4"
                >
                  <Skeleton className="h-4 w-24 bg-white/80" />
                  <div data-component="messages-scheduled-detail-skeleton-lines" className="mt-4 space-y-3">
                    <Skeleton className="h-4 w-full bg-white/80" />
                    <Skeleton className="h-4 w-5/6 bg-white/80" />
                    <Skeleton className="h-4 w-2/3 bg-white/80" />
                  </div>
                </div>
              ))}
            </div>
          ) : selectedJob ? (
            <DetailTabPanels
              activeTab={scheduledDetailTab}
              dataComponent="messages-scheduled-detail-tab-panels"
              panelDataComponent="messages-scheduled-detail-tab-panel"
              panels={[
                {
                  key: "info",
                  children: (
                    <div data-component="messages-scheduled-detail" className="space-y-4">
                      <InfoCard title="예약 개요" data-component="messages-scheduled-detail-overview">
                        <InfoRow
                          data-component="messages-scheduled-detail-overview-rule"
                          label="발송 규칙"
                          value={selectedJob.ruleName}
                        />
                        <InfoRow
                          data-component="messages-scheduled-detail-overview-recipient"
                          label="수신자"
                          value={selectedJob.payload.recipientName || "-"}
                        />
                        <InfoRow
                          data-component="messages-scheduled-detail-overview-scheduled-time"
                          label="발신 예정 시간"
                          value={formatScheduledDetailDate(selectedJob.scheduledFor)}
                        />
                        <InfoRow
                          data-component="messages-scheduled-detail-overview-template"
                          label="템플릿"
                          value={getHistoryTemplateLabel(selectedJob.templateKey)}
                        />
                      </InfoCard>

                      <div
                        data-component="messages-scheduled-detail-grid"
                        className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
                      >
                        <InfoCard title="메시지 정보" data-component="messages-scheduled-detail-meta">
                          <InfoRow
                            data-component="messages-scheduled-detail-meta-recipient"
                            label="수신자 이름"
                            value={selectedJob.payload.recipientName || "-"}
                          />
                          <InfoRow
                            data-component="messages-scheduled-detail-meta-phone"
                            label="전화번호"
                            value={selectedJobPhone}
                          />
                          <InfoRow
                            data-component="messages-scheduled-detail-meta-scheduled-time"
                            label="발신 예정 시간"
                            value={formatScheduledDetailDate(selectedJob.scheduledFor)}
                          />
                          <InfoRow
                            data-component="messages-scheduled-detail-meta-template"
                            label="메시지 템플릿 이름"
                            value={getHistoryTemplateLabel(selectedJob.templateKey)}
                          />
                          <InfoRow
                            data-component="messages-scheduled-detail-meta-rule"
                            label="발송 규칙명"
                            value={selectedJob.ruleName}
                          />
                          <InfoRow
                            data-component="messages-scheduled-detail-meta-recipient-type"
                            label="수신 유형"
                            value={getScheduledRecipientLabel(selectedJob.recipientType)}
                          />
                          <InfoRow
                            data-component="messages-scheduled-detail-meta-event"
                            label="이벤트 기준"
                            value={getScheduledEventLabel(selectedJob.eventType)}
                          />
                        </InfoCard>

                        <InfoCard title="변수" data-component="messages-scheduled-detail-variables">
                          {selectedJobVariables.length > 0 ? (
                            selectedJobVariables.map(([key, value], index) => (
                              <InfoRow
                                key={`${selectedJob.id}-${key}`}
                                data-component={`messages-scheduled-detail-variable-${index + 1}`}
                                label={SCHEDULED_VARIABLE_LABELS[key] ?? key}
                                value={value || "-"}
                              />
                            ))
                          ) : (
                            <InfoRow
                              data-component="messages-scheduled-detail-variable-empty"
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
                      data-component="messages-scheduled-detail-message"
                      className="flex min-h-[420px] flex-col"
                      contentClassName="flex flex-1"
                    >
                      <div
                        data-component="messages-generated-msg-detail-content-body"
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
          ) : null}
        </DetailPanel>
      </SplitLayout>
    </div>
  );
}

function MessageSectionPlaceholder({ sectionId }: { sectionId: PlaceholderSectionId }) {
  const section = MESSAGE_SECTIONS.find((item) => item.id === sectionId);
  const copy = PLACEHOLDER_COPY[sectionId];
  const [selectedPreviewId, setSelectedPreviewId] = useState<string | null>(null);
  const [scheduledFilter, setScheduledFilter] = useState<ScheduledPreviewFilter>("all");
  const [scheduledSearchValue, setScheduledSearchValue] = useState("");
  const isScheduledSection = sectionId === "scheduled";
  const deferredScheduledSearchValue = useDeferredValue(scheduledSearchValue);
  const filteredPreviewItems = useMemo(() => {
    if (!isScheduledSection) return copy.items;

    return copy.items.filter((item) => {
      const matchesRecipientType =
        scheduledFilter === "all" ||
        (scheduledFilter === "customer" ? item.recipientType === "고객" : item.recipientType === "직원");

      if (!matchesRecipientType) {
        return false;
      }

      return matchesSearchQuery(deferredScheduledSearchValue, [
        item.recipientName ?? item.label,
        item.recipientType ?? item.badge,
        item.recipientPhone ?? "",
        item.templateTitle ?? "",
        item.scheduledAt ?? "",
        item.summary,
        item.detailTitle,
        item.detailDescription,
        item.messageBody ?? "",
      ]);
    });
  }, [copy.items, deferredScheduledSearchValue, isScheduledSection, scheduledFilter]);
  const selectedPreview = filteredPreviewItems.find((item) => item.id === selectedPreviewId) ?? null;
  const hasScheduledSearchQuery = deferredScheduledSearchValue.trim().length > 0;
  const hasScheduledFilters = scheduledFilter !== "all" || hasScheduledSearchQuery;

  if (!section) return null;

  const Icon = section.icon;
  const detailSubtitle = isScheduledSection
    ? selectedPreview
      ? `${selectedPreview.templateTitle ?? "메시지"} · ${selectedPreview.recipientPhone ?? "연락처 미정"}`
      : "왼쪽 목록에서 발송 예정 메시지를 선택해 주세요."
    : selectedPreview?.detailDescription ?? "왼쪽 목록에서 미리보기 항목을 선택하면 이 영역에 상세 구성 가이드가 표시됩니다.";

  return (
    <div data-component="messages-section-placeholder-layout" className="flex min-h-[560px] flex-1 flex-col">
      <SplitLayout data-component="desktop_messages_split-layout-2" hasSelection={!!selectedPreview} onBack={() => setSelectedPreviewId(null)}>
        <ListPanel data-component="desktop_messages_split-layout_list-panel-2"
          title={section.label}
          subtitle={copy.description}
          tabs={isScheduledSection ? SCHEDULED_PREVIEW_TABS : undefined}
          activeTab={isScheduledSection ? scheduledFilter : undefined}
          onTabChange={
            isScheduledSection
              ? (value) => {
                  setScheduledFilter(value as ScheduledPreviewFilter);
                  setSelectedPreviewId(null);
                }
              : undefined
          }
          searchValue={isScheduledSection ? scheduledSearchValue : undefined}
          onSearchChange={
            isScheduledSection
              ? (value) => {
                  setScheduledSearchValue(value);
                  setSelectedPreviewId(null);
                }
              : undefined
          }
          searchPlaceholder={isScheduledSection ? "이름, 연락처, 템플릿 검색…" : undefined}
          headerActions={
            <span
              data-component="messages-section-placeholder-list-badge"
              className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full bg-v3-primary-light px-3 py-1 text-[0.72rem] font-semibold text-v3-primary"
            >
              {(isScheduledSection ? filteredPreviewItems.length : copy.items.length)}개
            </span>
          }
          emptyState={!(filteredPreviewItems.length > 0) ? (
            <ListEmptyState
              message={
                hasScheduledFilters ? "조건에 맞는 예약 발송 항목이 없습니다." : "발송 예정 항목이 없습니다."
              }
            />
          ) : undefined}
        >
          <div data-component="messages-section-placeholder-list" className="space-y-3 pb-2">
            <AnimatedSlotList<PlaceholderPreviewItem>
                items={filteredPreviewItems}
                isLoading={false}
                className="space-y-2"
                itemDataComponent="messages-section-placeholder-list-item"
                getSlotState={({ item }) => ({
                  isActive: item?.id === selectedPreviewId,
                  isInteractive: Boolean(item),
                })}
                onSlotClick={(item) => {
                  setSelectedPreviewId(item.id);
                }}
                render={({ item }) => {
                  if (!item) return null;

                  const title = item.recipientName ?? item.label;
                  const badge = item.recipientType ?? item.badge;
                  const summary = item.templateTitle && item.scheduledAt
                    ? `${item.templateTitle} · ${item.scheduledAt}`
                    : item.summary;

                  return (
                    <AnimatedSlotListItemContent
                      dataComponent="messages-section-placeholder-list-item"
                      icon={Icon}
                      iconContainerClassName="text-v3-primary"
                      title={title}
                      subtitle={summary}
                      status={
                        <span
                          data-component="messages-section-placeholder-list-item-badge"
                          className="inline-flex shrink-0 items-center rounded-full bg-white/85 px-2 py-0.5 text-[0.66rem] font-semibold text-v3-primary"
                        >
                          {badge}
                        </span>
                      }
                    />
                  );
                }}
              />
            </div>
        </ListPanel>

        <DetailPanel data-component="desktop_messages_section_split-layout_detail-panel"
          avatar={!isScheduledSection || selectedPreview ? (
            <div
              data-component="messages-section-placeholder-detail-avatar"
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[16px] bg-v3-primary-light text-v3-primary"
            >
              <Icon className="h-5 w-5" />
            </div>
          ) : undefined}
          title={selectedPreview?.detailTitle ?? (isScheduledSection ? undefined : `${section.label} 상세`)}
          subtitle={isScheduledSection && !selectedPreview ? undefined : detailSubtitle}
          badges={
            isScheduledSection && selectedPreview ? (
              <span
                data-component="messages-section-placeholder-detail-status"
                className="rounded-full bg-emerald-500/10 px-3 py-1 text-[0.7rem] font-semibold text-emerald-600"
              >
                발송 예정
              </span>
            ) : null
          }
          trailing={
            isScheduledSection && selectedPreview?.scheduledAt ? (
              <div
                data-component="messages-section-placeholder-detail-scheduled-at"
                className="inline-flex items-center gap-1 rounded-full bg-v3-primary-light px-3 py-1 text-[0.72rem] font-semibold text-v3-primary"
              >
                <CalendarClock className="h-3.5 w-3.5" />
                {selectedPreview.scheduledAt}
              </div>
            ) : null
          }
          emptyState={
            isScheduledSection && !selectedPreview ? (
              <DetailEmptyState
                name="messages-section-placeholder-scheduled-detail-empty"
                icon={Users}
                message={
                  filteredPreviewItems.length === 0 && hasScheduledFilters
                    ? "조건에 맞는 예약 발송 항목이 없습니다."
                    : "발송 예정 메시지를 선택하면 상세 정보가 표시됩니다."
                }
                className="flex-none min-h-0"
              />
            ) : undefined
          }
        >
          {selectedPreview ? (
            isScheduledSection ? (
              <div data-component="messages-section-placeholder-detail" className="space-y-4">
                <div
                  data-component="messages-section-placeholder-scheduled-detail-grid"
                  className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]"
                >
                  <InfoCard
                    title="메시지 본문"
                    data-component="messages-section-placeholder-scheduled-detail-content"
                    className="flex flex-col xl:row-span-2"
                    contentClassName="flex flex-1"
                  >
                    <div
                      data-component="messages-section-placeholder-scheduled-detail-content-body"
                      className={cn(
                        "flex min-h-[240px] flex-1",
                        APP_CONTENT_BODY_CARD_OUTLINED_CLASS_NAME,
                      )}
                    >
                      <pre
                        data-component="messages-section-placeholder-scheduled-detail-content-text"
                        className="whitespace-pre-wrap font-sans text-[0.78rem] leading-relaxed text-v3-dark"
                      >
                        {selectedPreview.messageBody ?? selectedPreview.detailDescription}
                      </pre>
                    </div>
                  </InfoCard>

                  <InfoCard
                    title="메시지 정보"
                    data-component="messages-section-placeholder-scheduled-detail-meta"
                  >
                    <InfoRow
                      data-component="messages-section-placeholder-scheduled-detail-meta-recipient"
                      label="수신자 이름"
                      value={selectedPreview.recipientName ?? "-"}
                    />
                    <InfoRow
                      data-component="messages-section-placeholder-scheduled-detail-meta-phone"
                      label="전화번호"
                      value={selectedPreview.recipientPhone ?? "-"}
                    />
                    <InfoRow
                      data-component="messages-section-placeholder-scheduled-detail-meta-scheduled-time"
                      label="발신 예정 시간"
                      value={selectedPreview.scheduledAt ?? "-"}
                    />
                    <InfoRow
                      data-component="messages-section-placeholder-scheduled-detail-meta-template"
                      label="메시지 템플릿 이름"
                      value={selectedPreview.templateTitle ?? "-"}
                    />
                  </InfoCard>

                  <InfoCard
                    title="변수"
                    data-component="messages-section-placeholder-scheduled-detail-variables"
                  >
                    {selectedPreview.variableAssignments?.length ? (
                      selectedPreview.variableAssignments.map((variable) => (
                        <InfoRow
                          key={`${selectedPreview.id}-${variable.token}`}
                          data-component={`messages-section-placeholder-scheduled-detail-variable-${variable.token}`}
                          label={variable.label}
                          value={variable.value}
                        />
                      ))
                    ) : (
                      <InfoRow
                        data-component="messages-section-placeholder-scheduled-detail-variable-empty"
                        label="변수"
                        value={<span className="font-normal text-v3-text-muted">변수 정보가 없습니다.</span>}
                      />
                    )}
                  </InfoCard>
                </div>
              </div>
            ) : (
              <div data-component="messages-section-placeholder-detail" className="space-y-4">
                <AppContentCard
                  data-component="messages-section-placeholder-detail-overview"
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
                  data-component="messages-section-placeholder-detail-checklist"
                  variant="muted"
                  title="구성 제안"
                  titleVariant="eyebrow"
                  contentClassName="space-y-3"
                >
                  <div data-component="messages-section-placeholder-detail-checklist-items" className="space-y-3">
                    {selectedPreview.checklist.map((item) => (
                      <div
                        key={item}
                        data-component="messages-section-placeholder-detail-checklist-item"
                        className="flex items-center gap-3 rounded-[16px] bg-white px-4 py-3"
                      >
                        <div
                          data-component="messages-section-placeholder-detail-checklist-marker"
                          className="h-2.5 w-2.5 rounded-full bg-v3-primary"
                        />
                        <p className="text-[0.78rem] text-v3-dark">{item}</p>
                      </div>
                    ))}
                  </div>
                </AppContentCard>
              </div>
            )
          ) : isScheduledSection ? null : (
            <DetailEmptyState
              name="messages-section-placeholder-detail-empty"
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

function MessageHistorySection() {
  const [searchValue, setSearchValue] = useState("");
  const [statusFilter, setStatusFilter] = useState<MessageHistoryFilter>("all");
  const [relativeDateFilter, setRelativeDateFilter] = useState<MessageHistoryRelativeDateFilter>("all");
  const [dateYear, setDateYear] = useState("");
  const [dateMonth, setDateMonth] = useState("");
  const deferredSearchValue = useDeferredValue(searchValue);
  const { data: historyData = [], isLoading, isError } = useMessageHistory();
  const { mutateAsync: retryHistory, isPending: isRetrying } = useRetryMessageHistory();
  const { data: clients = [] } = useAllClients();
  const { toast } = useToast();
  const smsHistoryData = useMemo(
    () => historyData.filter((record) => isHistoryRecordInChannel(record, "sms")),
    [historyData],
  );
  const historyRecords = useMemo(
    () =>
      smsHistoryData.map((record) => {
        const matchedClient = findMessageHistoryClient(record, clients);
        const matchedClientName = matchedClient?.name.trim() ?? "";
        const normalizedRecord = normalizeHistoryRecord(record, {
          recipientNameFallback: matchedClientName,
          recipientListLabelFallback: matchedClientName,
        });

        if (!matchedClientName) return normalizedRecord;

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

  const filteredRecords = useMemo(
    () =>
      historyRecords.filter((record) => {
        const matchesStatus = statusFilter === "all" || record.status === statusFilter;
        const matchesRelativeDate = matchesHistoryRelativeDate(record.sentAt, relativeDateFilter);
        const matchesDate = matchesHistoryDateParts(record.sentAt, dateYear, dateMonth);
        return matchesStatus && matchesRelativeDate && matchesDate && matchesHistoryQuery(record, deferredSearchValue);
      }),
    [dateMonth, dateYear, deferredSearchValue, historyRecords, relativeDateFilter, statusFilter]
  );
  const historyRecordIds = useMemo(() => filteredRecords.map((record) => record.id), [filteredRecords]);
  const {
    selectedId: selectedRecordId,
    setSelectedId: setSelectedRecordId,
    setSplitLayoutMode,
  } = useSplitLayoutSelection(historyRecordIds);

  const emptyStateCopy = getMessageHistoryEmptyStateCopy(
    statusFilter,
    deferredSearchValue.trim().length > 0
  );
  const activeFilterMeta = MESSAGE_HISTORY_FILTER_META[statusFilter];

  const selectedRecord = useMemo(() => {
    if (selectedRecordId === null) return null;
    return filteredRecords.find((record) => record.id === selectedRecordId) ?? null;
  }, [filteredRecords, selectedRecordId]);

  const canRetry = !!selectedRecord
    && typeof selectedRecord.id === "number"
    && selectedRecord.status === "failed";

  const handleRetry = useCallback(async () => {
    if (!selectedRecord || typeof selectedRecord.id !== "number") return;

    try {
      const retriedRecord = await retryHistory(selectedRecord.id);

      if (retriedRecord.status === "failed") {
        throw new Error(retriedRecord.errorMessage || "메시지 재발송에 실패했습니다.");
      }

      toast({ description: "재발송 요청을 등록했습니다." });
    } catch (error) {
      toast({
        variant: "destructive",
        description: error instanceof Error ? error.message : "재발송 요청 중 오류가 발생했습니다.",
      });
    }
  }, [retryHistory, selectedRecord, toast]);

  return (
    <SplitLayout data-component="desktop_messages_split-layout-3"
      hasSelection={!!selectedRecord}
      onBack={() => setSelectedRecordId(null)}
      onModeChange={setSplitLayoutMode}
    >
      <ListPanel data-component="desktop_messages_split-layout_list-panel-3"
        title="발송 기록"
        subtitle="발송된 메시지 기록을 볼 수 있어요."
        tabs={MESSAGE_HISTORY_TABS}
        activeTab={statusFilter}
        onTabChange={(value) => {
          setStatusFilter(value as MessageHistoryFilter);
          setSelectedRecordId(null);
        }}
        searchValue={searchValue}
        onSearchChange={setSearchValue}
        searchPlaceholder="고객명, 연락처, 템플릿, 내용 검색…"
        headerActions={
          <span
            data-component="messages-history-list-count"
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[0.72rem] font-semibold",
              activeFilterMeta.badgeTone
            )}
          >
            <activeFilterMeta.icon className="h-3.5 w-3.5" />
            {filteredRecords.length}건
          </span>
        }
        emptyState={!isError && !isLoading && filteredRecords.length === 0 ? (
          <ListEmptyState message={emptyStateCopy.title} />
        ) : undefined}
        subHeader={
          !isError ? (
            <div data-component="messages-history-list-filters" className="flex items-center justify-between gap-2">
              <div data-component="messages-history-list-filter-relative" className="w-[110px] shrink-0">
                <Select value={relativeDateFilter} onValueChange={(value) => setRelativeDateFilter(value as MessageHistoryRelativeDateFilter)}>
                  <SelectTrigger
                    aria-label="발송 기간"
                    size="sm"
                    data-component="messages-history-list-filter-relative-trigger"
                    className="w-full"
                  >
                    <SelectValue placeholder="기간 선택" />
                  </SelectTrigger>
                  <SelectContent data-component="messages-history-list-filter-relative-content">
                    {MESSAGE_HISTORY_RELATIVE_DATE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div
                data-component="messages-history-list-filter-date"
                className="ml-auto flex flex-1 items-center justify-end gap-1.5"
              >
                {(hasDatePartFilter || relativeDateFilter !== "all") && (
                  <button
                    type="button"
                    aria-label="필터 초기화"
                    title="필터 초기화"
                    data-component="messages-history-list-filter-reset"
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
                  dataComponent="messages-history-list-filter-date-year"
                  contentDataComponent="messages-history-list-filter-date-year-content"
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
                  dataComponent="messages-history-list-filter-date-month"
                  contentDataComponent="messages-history-list-filter-date-month-content"
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
            data-component="messages-history-list-error"
            className="rounded-[18px] border border-red-200 bg-red-50 p-6 text-center"
          >
            <p className="text-sm font-semibold text-red-700">발송 기록을 불러오지 못했습니다.</p>
            <p className="mt-1 text-[0.8rem] text-red-600">잠시 후 다시 시도해 주세요.</p>
          </div>
        ) : (
          <>
            <AnimatedSlotList<MessageHistoryRecord>
              items={filteredRecords}
              isLoading={isLoading}
              loadingCount={4}
              className="space-y-2"
              getSlotState={({ item, isLoading: slotLoading }) => {
                const isActive = !slotLoading && item && item.id === selectedRecord?.id;
                return {
                  isActive: Boolean(isActive),
                  isInteractive: !slotLoading && Boolean(item),
                };
              }}
              onSlotClick={(record) => setSelectedRecordId(record.id)}
              render={({ item: record, isLoading: slotLoading }) => {
                if (slotLoading) {
                  return (
                    <>
                      <div
                        data-component="messages-history-list-skeleton-icon"
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] bg-v3-dim-white"
                      >
                        <Skeleton className="h-4 w-4 rounded-md bg-white/80" />
                      </div>
                      <div data-component="messages-history-list-skeleton-copy" className="min-w-0 flex-1 space-y-1.5">
                        <Skeleton className="h-4 w-36 bg-v3-dim-white" />
                        <Skeleton className="h-3 w-44 bg-v3-dim-white" />
                      </div>
                    </>
                  );
                }

                if (!record) return null;
                const statusMeta = getMessageHistoryListStatusMeta(record.status);
                const ItemIcon = record.icon;

                return (
                  <AnimatedSlotListItemContent
                    dataComponent="messages-history-list-item"
                    icon={ItemIcon}
                    iconContainerClassName={getMessageHistoryAvatarClassName(record.status)}
                    title={record.title}
                    subtitle={record.recipientListLabel}
                    status={
                      <div
                        data-component="messages-history-list-item-meta"
                        className="flex shrink-0 flex-col items-end justify-end gap-1 text-right"
                      >
                        <StatusBadge
                          data-component="messages-history-list-item-status"
                          variant={statusMeta.variant}
                          size="sm"
                        >
                          {statusMeta.label}
                        </StatusBadge>
                        <span
                          data-component="messages-history-list-item-date"
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
          </>
        )}
      </ListPanel>

      <MessageHistoryDetailPanel
        selectedRecord={selectedRecord}
        canRetry={canRetry}
        isRetrying={isRetrying}
        onRetry={handleRetry}
      />
    </SplitLayout>
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
  const selectedUserTemplate = userTemplateId ? userTemplates.find((template) => template.id === userTemplateId) : null;
  const SelectedBuiltinForm = builtinType ? FormComponents[builtinType] : null;
  const selectedTemplateItem = useMemo(
    () => visibleItems.find((item) => item.id === activeTemplateId) ?? null,
    [activeTemplateId, visibleItems]
  );
  const selectedTemplateIcon = selectedTemplateItem?.icon ?? FileText;
  const SelectedTemplateIcon = selectedTemplateIcon;
  const selectedTemplateTitle = selectedTemplateItem?.label ?? selectedUserTemplate?.name ?? "메시지 템플릿";
  const selectedTemplateSubtitle = selectedUserTemplate
    ? `지점 템플릿 · ${selectedUserTemplate.variables.length}개 변수`
    : "기본 템플릿은 오너 관리자 페이지에서 관리됩니다.";
  const selectedBuiltinSystemKey = builtinType ? BUILTIN_TEMPLATE_SYSTEM_KEYS[builtinType] : "";
  const { data: selectedBuiltinSystemTemplate } = useSystemTemplate(selectedBuiltinSystemKey);
  const builtinPreviewMeta = builtinType ? BUILTIN_TEMPLATE_PREVIEW_META[builtinType] : null;
  const templatePreviewMessage =
    templatePreviewOverride ??
    selectedUserTemplate?.content ??
    selectedBuiltinSystemTemplate?.content ??
    "";
  const templatePreviewHeadline = selectedUserTemplate ? selectedTemplateTitle : builtinPreviewMeta?.headline;
  const templatePreviewSubtitle = selectedUserTemplate ? "지점 템플릿" : builtinPreviewMeta?.subtitle;
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
        data-component="messages-template-send-layout"
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
          data-component="messages-template-detail-summary"
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
          name="messages-template-missing"
          message="선택한 템플릿 정보를 불러오지 못했습니다."
        />
      ) : null}
    </>
  );

  return (
    <PageSection name="messages">
      <div
        data-component="messages-sections"
        className="flex flex-1 min-h-0 flex-col gap-4 lg:flex-row lg:items-stretch"
      >
        <SectionNav
          ariaLabel="메시지 기능"
          items={MESSAGE_SECTIONS}
          activeId={activeSection}
          onSelect={(id) => setActiveSection(id as MessageSectionId)}
        />

        <div data-component="messages-section-content" className="flex min-h-0 min-w-0 flex-1 flex-col">
          {activeSection === "scheduled" ? (
            <section data-component="messages-scheduled-section" className="flex min-h-0 flex-1 flex-col">
              <MessageScheduledSection />
            </section>
          ) : activeSection === "send" || activeSection === "templates" ? (
            <MessageApprovalGate>
            <section
              data-component={activeSection === "send" ? "messages-send-section" : "messages-templates-section"}
              className="flex min-h-0 flex-1 flex-col"
            >
              <SplitLayout data-component="desktop_messages_split-layout-4"
                hasSelection={!!activeTemplateId}
                onModeChange={setTemplateSplitLayoutMode}
                onBack={() => {
                  setSelectedValue(null);
                  setTemplateDetailTab("details");
                  setTemplatePreviewOverride(null);
                }}
              >
                <ListPanel data-component="desktop_messages_split-layout_list-panel-4"
                  title="메시지 템플릿"
                  tabs={TEMPLATE_FILTERS}
                  activeTab={templateFilter}
                  onTabChange={(value) => handleTemplateFilterChange(value as TemplateFilter)}
                  headerActions={
                    templateFilter === "branch" ? (
                      <div data-component="messages-templates-actions" className="flex items-center gap-1.5">
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
                    <div data-component="messages-templates-list" className="space-y-2 pb-2">
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
                                  data-component="messages-template-skeleton-icon"
                                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] bg-v3-dim-white"
                                >
                                  <Skeleton className="h-4 w-4 rounded-md bg-white/70" />
                                </div>
                                <div data-component="messages-template-skeleton-copy" className="min-w-0 flex-1">
                                  <Skeleton className="h-4 w-32 bg-v3-dim-white" />
                                </div>
                              </>
                            );
                          }

                          if (!item) return null;

                          return (
                            <AnimatedSlotListItemContent
                              dataComponent="messages-template-item"
                              icon={item.icon}
                              title={item.label}
                            />
                          );
                        }}
                      />
                    </div>
                  ) : null}
                </ListPanel>

                <DetailPanel data-component="desktop_messages_templates_split-layout_detail-panel"
                  avatar={
                    activeTemplateId ? (
                      <div
                        data-component="messages-template-detail-avatar"
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
                        data-component="messages-template-detail-badge"
                        className={cn(
                          "inline-flex items-center rounded-full px-3 py-1 text-[0.68rem] font-semibold",
                          selectedUserTemplate
                            ? "bg-v3-dim-white text-v3-text-muted"
                            : "bg-v3-primary-light text-v3-primary"
                        )}
                      >
                        {selectedUserTemplate ? "지점 템플릿" : "기본 템플릿"}
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
                      name="messages-template-empty-selection"
                      message="왼쪽 목록에서 템플릿을 선택해 주세요."
                    />
                  ) : (
                    <DetailTabPanels
                      activeTab={templateDetailTab}
                      dataComponent="messages-template-detail-tabpanes"
                      panelDataComponent="messages-template-detail-pane"
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
                              data-component="messages-template-preview-layout"
                              className="flex min-h-0 w-full flex-wrap items-start justify-center gap-4"
                            >
                              <MessagePhonePreview
                                className="h-full min-h-0 overflow-hidden py-0"
                                content={templatePreviewMessage}
                                templateName={selectedTemplateTitle}
                                headline={templatePreviewHeadline}
                                subtitle={templatePreviewSubtitle}
                                dataComponentPrefix="message"
                                panelDataComponent="messages-template-preview-phone-panel"
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
            <section data-component="messages-history-section" className="flex min-h-0 flex-1 flex-col">
              <MessageHistorySection />
            </section>
          ) : activeSection === "triggers" ? (
            <MessageApprovalGate>
              <section data-component="messages-triggers-section" className="flex h-full min-h-0 flex-1 flex-col">
                <TriggerRulesManager dataComponentPrefix="message" channel="sms" />
              </section>
            </MessageApprovalGate>
          ) : activeSection === "settings" ? (
            <section data-component="messages-settings-section" className="flex min-h-0 flex-1 flex-col">
              <MessageTenantApplicationSettings />
            </section>
          ) : (
            <MessageApprovalGate>
              <section
                data-component={`messages-${activeSection}-section`}
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
