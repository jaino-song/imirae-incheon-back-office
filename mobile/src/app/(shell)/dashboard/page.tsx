"use client";

import { redirect, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Calendar, File, Send, User } from "lucide-react";

const ALL_FILTER = "전체";
const DASHBOARD_ROUTE_BODY_CLASS = "mobile-dashboard-route";

import { useDashboardAnalytics } from "@/hooks/useDashboardAnalytics";
import { clientQueryKeys, useClients, useDeleteClient } from "@/hooks/useClients";
import { useClientMessageHistory } from "@/hooks/useClientMessageHistory";
import { useSyncStaleEformsignStatuses } from "@/hooks/useSyncStaleEformsignStatuses";
import type { Client } from "@/lib/client/types";
import { useLocale } from "@/providers/LocaleProvider";
import { t } from "@/lib/i18n/translations";
import { toast } from "@/hooks/use-toast";
import { useInitialUser } from "@/providers/UserProvider";
import { ClientFormDialog } from "@/components/app/clients/ClientFormDialog";
import { MobileTwoButtonModal } from "@/components/app/ui/MobileTwoButtonModal";
import { ClientDetailContent, type DetailTabId } from "@/components/app/clients/client-detail";
import { DashboardRedesign } from "@/components/app/mobile-redesign/DashboardRedesign";
import { deriveDashboardAnalyticsFromClients } from "@/lib/dashboard/analytics";
import type {
  DashboardRedesignFilter,
  DashboardRedesignProps,
} from "@/components/app/mobile-redesign/DashboardRedesign";
import { MobileDetailSheet } from "@/components/app/mobile-redesign/detail-sheet";
import type {
  DashboardAnalytic,
  ListRow,
  SectionRows,
} from "@/components/app/mobile-redesign/mockup-data";
import { getMobileClientBadges } from "@/lib/client/badges";
import { compactDashboardBadges, type DashboardStatusBadge } from "./dashboard-badges";
import {
  dueForContractRequired,
  dueForServiceEndDate,
  dueForServiceStartDate,
  dueForServiceStatus,
  type DashboardDueInfo,
} from "./dashboard-due";
import "@/components/app/mobile-redesign/redesign.css";

const AVATAR_TONES: NonNullable<ListRow["avatarTone"]>[] = [
  "primary",
  "green",
  "burgundy",
  "orange",
  "purple",
];

function pickAvatarTone(name: string, fallback: number): NonNullable<ListRow["avatarTone"]> {
  const code = name.charCodeAt(0) || fallback;
  return AVATAR_TONES[code % AVATAR_TONES.length];
}

function clientInitial(name: string) {
  return name.trim().charAt(0) || "?";
}

function clientMeta(c: Client) {
  const type = c.type ?? "유형 미정";
  return c.primaryEmployee?.name ? `${type} · ${c.primaryEmployee.name}` : `${type} · 제공인력 미배정`;
}

type DueInfo = DashboardDueInfo;

type DashboardStatusRow = ListRow & {
  badges: DashboardStatusBadge[];
  statusOrder: number;
};

const DASHBOARD_STATUS_ORDER = {
  waiting: 10,
  upcoming: 20,
  sendPending: 30,
  reviewNeeded: 40,
  active: 50,
  replacementRequested: 60,
} as const;

function dashboardBadgesForClient(client: Client, dueInfo: DueInfo | null): DashboardStatusBadge[] {
  return getMobileClientBadges(client).map((badge) => ({
    label: badge.label,
    tone: badge.tone,
    order: badge.priority,
    due: dueInfo?.due,
    dueSub: dueInfo?.dueSub,
    dueTone: dueInfo?.dueTone,
  }));
}

function withDashboardStatus(
  row: ListRow,
  statusOrder: number,
  badges?: DashboardStatusBadge[],
): DashboardStatusRow {
  return {
    ...row,
    badges: badges ?? [
      {
        label: row.badge,
        tone: row.badgeTone,
        order: statusOrder,
        due: row.due,
        dueSub: row.dueSub,
        dueTone: row.dueTone,
      },
    ],
    statusOrder,
  };
}

function mergeDashboardRows(rows: DashboardStatusRow[]): ListRow[] {
  const mergedRows: Array<
    DashboardStatusRow & {
      sourceIndex: number;
      fullBadges: DashboardStatusBadge[];
    }
  > = [];
  const byClient = new Map<string | number, (typeof mergedRows)[number]>();

  rows.forEach((row, index) => {
    const key = row.id ?? `${row.name}-${row.meta}`;
    const existing = byClient.get(key);

    if (!existing) {
      const merged = {
        ...row,
        sourceIndex: index,
        fullBadges: [...row.badges],
      };
      byClient.set(key, merged);
      mergedRows.push(merged);
      return;
    }

    existing.fullBadges.push(...row.badges);

    if (row.statusOrder >= existing.statusOrder) {
      existing.badge = row.badge;
      existing.badgeTone = row.badgeTone;
      existing.due = row.due;
      existing.dueSub = row.dueSub;
      existing.dueTone = row.dueTone;
      existing.statusOrder = row.statusOrder;
    }
  });

  return mergedRows
    .sort((a, b) => a.sourceIndex - b.sourceIndex)
    .map((row) => {
      const compactedBadges = compactDashboardBadges(row.fullBadges);
      const primaryBadge = compactedBadges[0];

      return {
        id: row.id,
        name: row.name,
        meta: row.meta,
        initial: row.initial,
        badge: primaryBadge?.label ?? row.badge,
        badgeTone: primaryBadge?.tone ?? row.badgeTone,
        badges: compactedBadges.map(({ label, tone }) => ({ label, tone })),
        due: primaryBadge?.due ?? row.due,
        dueSub: primaryBadge?.dueSub ?? row.dueSub,
        dueTone: primaryBadge?.dueTone ?? row.dueTone,
        avatarTone: row.avatarTone,
        onClick: row.onClick,
      };
    });
}

export default function DashboardPage() {
  // 60s staleTime: dashboard revisits within the window reuse the cache
  // instead of re-firing analytics + clients (and the eformsign sync burst
  // their invalidations cascade into) on every mount.
  const { data: analytics, isLoading: analyticsLoading } = useDashboardAnalytics({
    staleTime: 60_000,
  });
  const { data: clientsData, isLoading: clientsLoading } = useClients(1, 50, undefined, {
    staleTime: 60_000,
  });
  const user = useInitialUser();
  const [activeFilter, setActiveFilter] = useState<string>(ALL_FILTER);

  const clients = useMemo<Client[]>(() => clientsData?.data ?? [], [clientsData?.data]);
  useSyncStaleEformsignStatuses(clients, { enabled: !clientsLoading });

  useEffect(() => {
    document.body.classList.add(DASHBOARD_ROUTE_BODY_CLASS);
    return () => {
      document.body.classList.remove(DASHBOARD_ROUTE_BODY_CLASS);
    };
  }, []);

  const router = useRouter();
  const queryClient = useQueryClient();
  const locale = useLocale();
  const deleteClient = useDeleteClient();
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTabId>("basic");
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [formDialogOpen, setFormDialogOpen] = useState(false);
  const [deleteTargetClientId, setDeleteTargetClientId] = useState<number | null>(null);
  const {
    notificationLogs: detailNotificationLogs,
    isLoading: isNotificationLogsLoading,
    isError: isNotificationLogsError,
    refetch: refetchNotificationLogs,
  } = useClientMessageHistory(selectedClient);

  const openClient = useCallback((c: Client) => {
    setSelectedClient(c);
    setDetailTab(c.pendingScheduleChange ? "scheduleChange" : "basic");
  }, []);
  const handleClientUpdated = useCallback((updatedClient: Client) => {
    setSelectedClient(updatedClient);
    queryClient.setQueryData(clientQueryKeys.detail(updatedClient.id), updatedClient);
    queryClient.setQueriesData<{ data: Client[] }>(
      { queryKey: clientQueryKeys.lists() },
      (previous) => previous
        ? {
            ...previous,
            data: previous.data.map((client) =>
              client.id === updatedClient.id ? updatedClient : client,
            ),
          }
        : previous,
    );
  }, [queryClient]);
  const closeDetail = useCallback(() => setSelectedClient(null), []);
  const handleEdit = useCallback((c: Client) => {
    setEditingClient(c);
    setFormDialogOpen(true);
  }, []);
  const handleMessage = useCallback((c: Client) => router.push(`/messages/new?clientId=${c.id}`), [router]);
  const handleIssueContract = useCallback(() => router.push("/contracts/new"), [router]);
  const handleDeleteRequest = useCallback((id: number) => setDeleteTargetClientId(id), []);
  const handleDeleteConfirm = async () => {
    if (deleteTargetClientId == null) return;
    try {
      await deleteClient.mutateAsync(deleteTargetClientId);
      if (selectedClient?.id === deleteTargetClientId) setSelectedClient(null);
      setDeleteTargetClientId(null);
      toast({
        title: t(locale, "clients.delete-success"),
        description: t(locale, "clients.delete-success-description"),
      });
    } catch {
      toast({
        title: t(locale, "clients.delete-fail"),
        description: t(locale, "clients.delete-fail-description"),
        variant: "destructive",
      });
    }
  };

  const dashboardData = useMemo<
    Omit<DashboardRedesignProps, "activeFilter" | "onFilterChange"> & { allRows: ListRow[] }
  >(() => {
    const derivedAnalytics = deriveDashboardAnalyticsFromClients(clients);
    const active = analytics?.activeClients ?? derivedAnalytics.activeClients;
    const upcoming = analytics?.upcomingThisMonth ?? derivedAnalytics.upcomingThisMonth;
    const pendingReview =
      analytics?.contractsPendingSignature ?? derivedAnalytics.contractsPendingSignature;
    const pendingSend = analytics?.contractsNotSent ?? derivedAnalytics.contractsNotSent;

    const dashboardAnalytics: DashboardAnalytic[] = [
      { label: "서비스 진행 중", value: String(active), tone: "primary", icon: User },
      { label: "7일 내 시작 예정", value: String(upcoming), tone: "orange", icon: Calendar },
      {
        label: "검토 필요 문서",
        value: String(pendingReview),
        tone: "green",
        icon: File,
        urgent: pendingReview > 0,
      },
      {
        label: "계약서 미완료",
        value: String(pendingSend),
        tone: "burgundy",
        icon: Send,
        urgent: pendingSend > 0,
      },
    ];

    if (clientsLoading) {
      const filters: DashboardRedesignFilter[] = [
        { label: ALL_FILTER, count: "", skeleton: true },
        { label: "조치 필요", count: "", skeleton: true },
        { label: "시작 예정", count: "", skeleton: true },
        { label: "종료 예정", count: "", skeleton: true },
      ];

      return { analytics: dashboardAnalytics, sections: [], filters, allRows: [], loading: true };
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const weekFromNow = new Date(today);
    weekFromNow.setDate(today.getDate() + 7);
    weekFromNow.setHours(23, 59, 59, 999);
    const monthFromNow = new Date(today);
    monthFromNow.setDate(today.getDate() + 30);
    monthFromNow.setHours(23, 59, 59, 999);

    const actionRequired = clients
      .filter((c) => {
        if (c.serviceStatus === "replacement_requested") return true;
        if (c.documentStatus && c.documentStatus !== "completed" && c.eDocId) return true;
        if (!c.eDocId && c.serviceStatus === "active") return true;
        return false;
      })
      .sort((a, b) => (b.updatedAt ? new Date(b.updatedAt).getTime() : 0) - (a.updatedAt ? new Date(a.updatedAt).getTime() : 0) || b.id - a.id);

    const upcomingClients = clients
      .filter((c) => {
        if (!c.startDate || c.serviceStatus === "terminated")
          return false;
        const d = new Date(c.startDate);
        if (Number.isNaN(d.getTime())) return false;
        d.setHours(0, 0, 0, 0);
        return d >= today && d <= weekFromNow;
      })
      .sort((a, b) => new Date(a.startDate!).getTime() - new Date(b.startDate!).getTime());

    const endingSoon = clients
      .filter((c) => {
        if (!c.endDate || c.serviceStatus !== "active") return false;
        const d = new Date(c.endDate);
        if (Number.isNaN(d.getTime())) return false;
        d.setHours(0, 0, 0, 0);
        return d >= today && d <= monthFromNow;
      })
      .sort((a, b) => new Date(a.endDate!).getTime() - new Date(b.endDate!).getTime());

    const toActionRow = (c: Client, i: number): DashboardStatusRow => {
      let dueInfo: DueInfo | null = null;
      let statusOrder: number;

      if (c.serviceStatus === "replacement_requested") {
        dueInfo = dueForServiceStatus(c);
        statusOrder = DASHBOARD_STATUS_ORDER.replacementRequested;
      } else if (getMobileClientBadges(c).some((badge) => badge.key === "contract_required")) {
        dueInfo = dueForContractRequired(c);
        statusOrder = c.documentStatus && c.documentStatus !== "completed" && c.eDocId
          ? DASHBOARD_STATUS_ORDER.reviewNeeded
          : DASHBOARD_STATUS_ORDER.sendPending;
      } else if (c.documentStatus && c.documentStatus !== "completed" && c.eDocId) {
        dueInfo = dueForServiceStatus(c);
        statusOrder = DASHBOARD_STATUS_ORDER.reviewNeeded;
      } else {
        dueInfo = dueForServiceStatus(c);
        statusOrder = DASHBOARD_STATUS_ORDER.sendPending;
      }

      const badges = dashboardBadgesForClient(c, dueInfo);
      const primaryBadge = badges[0];

      return withDashboardStatus({
        id: c.id,
        name: c.name,
        meta: clientMeta(c),
        initial: clientInitial(c.name),
        badge: primaryBadge?.label ?? "-",
        badgeTone: primaryBadge?.tone ?? "muted",
        avatarTone: pickAvatarTone(c.name, i),
        onClick: () => openClient(c),
        ...(dueInfo ?? {}),
      }, statusOrder, badges);
    };

    const toUpcomingRow = (c: Client, i: number): DashboardStatusRow => {
      const dueInfo = dueForServiceStartDate(c.startDate);
      const hasEmployee = Boolean(c.primaryEmployee);
      const badges = dashboardBadgesForClient(c, dueInfo);
      const primaryBadge = badges[0];

      return withDashboardStatus({
        id: c.id,
        name: c.name,
        meta: clientMeta(c),
        initial: clientInitial(c.name),
        badge: primaryBadge?.label ?? "-",
        badgeTone: primaryBadge?.tone ?? "muted",
        avatarTone: pickAvatarTone(c.name, i),
        onClick: () => openClient(c),
        ...(dueInfo ?? {}),
      }, hasEmployee ? DASHBOARD_STATUS_ORDER.upcoming : DASHBOARD_STATUS_ORDER.waiting, badges);
    };

    const toEndingRow = (c: Client, i: number): DashboardStatusRow => {
      const dueInfo = dueForServiceEndDate(c.endDate);
      const badges = dashboardBadgesForClient(c, dueInfo);
      const primaryBadge = badges[0];

      return withDashboardStatus({
        id: c.id,
        name: c.name,
        meta: clientMeta(c),
        initial: clientInitial(c.name),
        badge: primaryBadge?.label ?? "-",
        badgeTone: primaryBadge?.tone ?? "muted",
        avatarTone: pickAvatarTone(c.name, i),
        onClick: () => openClient(c),
        ...(dueInfo ?? {}),
      }, DASHBOARD_STATUS_ORDER.active, badges);
    };

    const actionRows = actionRequired.map(toActionRow);
    const upcomingRows = upcomingClients.map(toUpcomingRow);
    const endingRows = endingSoon.map(toEndingRow);
    const allRows = mergeDashboardRows([...actionRows, ...upcomingRows, ...endingRows]);

    const allSections: SectionRows[] = [
      { title: `조치 필요 · ${actionRows.length}건`, rows: actionRows },
      { title: `시작 예정 · ${upcomingRows.length}명`, rows: upcomingRows },
      { title: `종료 예정 · ${endingRows.length}명`, rows: endingRows },
    ].filter((s) => s.rows.length > 0);

    const filters: DashboardRedesignFilter[] = [
      { label: ALL_FILTER, count: String(allRows.length) },
      { label: "조치 필요", count: String(actionRows.length) },
      { label: "시작 예정", count: String(upcomingRows.length) },
      { label: "종료 예정", count: String(endingRows.length) },
    ];

    return { analytics: dashboardAnalytics, sections: allSections, filters, allRows, loading: false };
  }, [analytics, clients, clientsLoading, openClient]);

  const visibleSections = useMemo(() => {
    if (activeFilter === ALL_FILTER) {
      return dashboardData.allRows.length > 0
        ? [{ title: `${ALL_FILTER} · ${dashboardData.allRows.length}건`, rows: dashboardData.allRows }]
        : [];
    }
    return dashboardData.sections.filter((s) => s.title.startsWith(activeFilter));
  }, [dashboardData.allRows, dashboardData.sections, activeFilter]);

  if (!user) {
    redirect("/logout");
  }

  return (
    <>
      <MobileDetailSheet data-component="mobile_dashboard_detail-sheet"
        name="dashboard"
        isOpen={Boolean(selectedClient)}
        onClose={closeDetail}
        list={
          <DashboardRedesign
            analytics={dashboardData.analytics}
            sections={visibleSections}
            filters={dashboardData.filters}
            activeFilter={activeFilter}
            onFilterChange={setActiveFilter}
            analyticsLoading={(analyticsLoading || clientsLoading) && !analytics}
            loading={dashboardData.loading}
          />
        }
        detail={
          selectedClient ? (
            <ClientDetailContent
              data-component="mobile_dashboard_detail-sheet_stack_detail-page_content"
              client={selectedClient}
              activeTab={detailTab}
              notificationLogs={detailNotificationLogs}
              isNotificationLogsLoading={isNotificationLogsLoading}
              isNotificationLogsError={isNotificationLogsError}
              onRetryNotificationLogs={() => {
                void refetchNotificationLogs();
              }}
              onTabChange={setDetailTab}
              onMessage={() => handleMessage(selectedClient)}
              onIssueContract={handleIssueContract}
              onEdit={handleEdit}
              onDelete={handleDeleteRequest}
              onClientUpdated={handleClientUpdated}
            />
          ) : (
            <div className="detail-body" data-component="mobile-dashboard-detail-empty" />
          )
        }
      />

      <MobileTwoButtonModal
        open={deleteTargetClientId != null}
        title={t(locale, "common.delete")}
        description={t(locale, "clients.delete-confirm")}
        cancelLabel={t(locale, "common.cancel")}
        confirmLabel={t(locale, "common.delete")}
        loading={deleteClient.isPending}
        onOpenChange={(open) => {
          if (!open && !deleteClient.isPending) {
            setDeleteTargetClientId(null);
          }
        }}
        onCancel={() => setDeleteTargetClientId(null)}
        onConfirm={handleDeleteConfirm}
      />

      <ClientFormDialog
        open={formDialogOpen}
        onClose={() => {
          setFormDialogOpen(false);
          setEditingClient(null);
        }}
        client={editingClient}
      />
    </>
  );
}
