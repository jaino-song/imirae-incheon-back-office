"use client";

import { useMemo } from "react";
import {
  BarChart3,
  Bell,
  Calculator,
  Calendar,
  FileText,
  MessageCircle,
  MessageSquareText,
  Send,
  UserCheck,
  Users,
} from "lucide-react";

import { useAllClients } from "@/hooks/useClients";
import { useEmployees } from "@/hooks/useEmployees";
import { useMessageTemplates } from "@/hooks/use-message-templates";
import { useUnreadCount, usePushNotification } from "@/hooks/usePushNotification";
import { AllSettingsRedesign } from "@/components/app/mobile-redesign/AllSettingsRedesign";
import type { MenuGroup } from "@/components/app/mobile-redesign/mockup-data";
import { useMessageTriggerRules } from "@/features/message-triggers/hooks/use-message-triggers";

/** Canonical data-component base for the /all route. */
const ALL_PAGE_BASE = "mobile_all_page";

function safeArrayPayload<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (payload && typeof payload === "object") {
    const data = (payload as Record<string, unknown>).data;
    if (Array.isArray(data)) return data as T[];
    const items = (payload as Record<string, unknown>).items;
    if (Array.isArray(items)) return items as T[];
  }
  return [];
}

export default function AllMenuPage() {
  const clientsQuery = useAllClients();
  const employeesQuery = useEmployees();
  const messageTemplatesQuery = useMessageTemplates();
  const messageTriggerRulesQuery = useMessageTriggerRules();
  const pushNotification = usePushNotification();
  const unreadCountQuery = useUnreadCount(true);

  const clients = safeArrayPayload(clientsQuery.data);
  const employees = safeArrayPayload(employeesQuery.data);
  const messageTemplates = safeArrayPayload(messageTemplatesQuery.data);
  const messageTriggerRules = safeArrayPayload(messageTriggerRulesQuery.data);
  const automationTriggerCount = messageTriggerRules.length;
  const unreadNotifCount = typeof unreadCountQuery.data === "number" ? unreadCountQuery.data : 0;
  const isClientsInitialLoading = clientsQuery.isLoading && !clientsQuery.data;
  const isEmployeesInitialLoading = employeesQuery.isLoading && !employeesQuery.data;
  const isMessageTemplatesInitialLoading = messageTemplatesQuery.isLoading && !messageTemplatesQuery.data;
  const isMessageRulesInitialLoading = messageTriggerRulesQuery.isLoading && !messageTriggerRulesQuery.data;
  const isUnreadInitialLoading = unreadCountQuery.isLoading && unreadCountQuery.data === undefined;

  const menuGroups = useMemo<MenuGroup[]>(() => {
    return [
      {
        title: "지점 관리",
        rows: [
          {
            label: "상담",
            href: "/consultations",
            icon: MessageCircle,
            tone: "burgundy",
            badgeLoading: isUnreadInitialLoading,
            badgeSkeletonWidth: "18px",
            ...(unreadNotifCount > 0 ? { badge: String(unreadNotifCount) } : {}),
          },
          {
            label: "고객",
            href: "/clients",
            icon: Users,
            tone: "primary",
            value: isClientsInitialLoading ? undefined : `${clients.length}명`,
            valueLoading: isClientsInitialLoading,
            valueSkeletonWidth: "28px",
          },
          {
            label: "제공인력",
            href: "/employees",
            icon: UserCheck,
            tone: "purple",
            value: isEmployeesInitialLoading ? undefined : `${employees.length}명`,
            valueLoading: isEmployeesInitialLoading,
            valueSkeletonWidth: "28px",
          },
          {
            label: "전자문서",
            href: "/contracts",
            icon: FileText,
            tone: "green",
          },
          {
            label: "일정 캘린더",
            href: "/employees/schedule",
            icon: Calendar,
            tone: "orange",
            disabled: true,
            statusLabel: "출시 예정",
          },
          {
            label: "통계 보고서",
            href: "/dashboard/analytics",
            icon: BarChart3,
            tone: "green",
            disabled: true,
            statusLabel: "출시 예정",
          },
        ],
      },
      {
        title: "서비스 관리",
        rows: [
          { label: "가격표", href: "/prices", icon: Calculator, tone: "orange" },
          {
            label: "메시지",
            href: "/messages/new",
            icon: MessageSquareText,
            tone: "primary",
            value: isMessageTemplatesInitialLoading ? undefined : `${messageTemplates.length}건`,
            valueLoading: isMessageTemplatesInitialLoading,
            valueSkeletonWidth: "32px",
          },
          {
            label: "발송 자동화",
            href: "/messages/automation",
            icon: Send,
            tone: "gold",
            value: isMessageRulesInitialLoading ? undefined : `${automationTriggerCount}개`,
            valueLoading: isMessageRulesInitialLoading,
            valueSkeletonWidth: "28px",
          },
        ],
      },
      {
        title: "설정",
        rows: [
          {
            label: "알림 설정",
            href: "/notification",
            icon: Bell,
            tone: "muted",
            value: pushNotification.isLoading ? undefined : pushNotification.isSubscribed ? "활성" : "비활성",
            valueLoading: pushNotification.isLoading,
            valueSkeletonWidth: "38px",
          },
        ],
      },
    ];
  }, [
    clients.length,
    employees.length,
    messageTemplates.length,
    automationTriggerCount,
    unreadNotifCount,
    isClientsInitialLoading,
    isEmployeesInitialLoading,
    isMessageTemplatesInitialLoading,
    isMessageRulesInitialLoading,
    isUnreadInitialLoading,
    pushNotification.isLoading,
    pushNotification.isSubscribed,
  ]);

  return (
    <div data-component={ALL_PAGE_BASE} data-slot="all-page" className="md:hidden">
      <AllSettingsRedesign menuGroups={menuGroups} />
    </div>
  );
}
