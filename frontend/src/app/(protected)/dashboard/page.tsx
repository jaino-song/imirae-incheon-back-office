"use client";

import { redirect, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  fetchDashboardClientPage,
  useDashboardOverview,
} from "@/hooks/useDashboardStats";
import { Client } from "@/lib/client/types";
import { getActionRequiredStatus } from "@/lib/client/action-required";
import { useInitialUser } from "@/providers/UserProvider";
import {
  StatsBar,
  SplitLayout,
  DetailEmptyState,
  DetailPanel,
  RecentActivitiesPanel,
  type ActionRequiredItem,
} from "@/components/app/v3";
import { ClientDetailPanel } from "@/components/app/clients/ClientDetailPanel";
import {
  Users,
  Calendar,
  Send,
  MoreVertical,
  ExternalLink,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import Link from "next/link";

import { Block } from "@/components/app/v3/Block";

const DASHBOARD_STAT_KEYS = [
  { icon: Users, valueKey: "activeClients" as const, label: "서비스 진행 중", colorIndex: 0, counter: "명" },
  { icon: Calendar, valueKey: "upcomingSoon" as const, label: "곧 시작 예정", colorIndex: 1, counter: "건" },
  { icon: Send, valueKey: "contractsRequired" as const, label: "계약서 필요", colorIndex: 3, counter: "건" },
];

function isToday(dateStr: string): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr);
  target.setHours(0, 0, 0, 0);
  return target.getTime() === today.getTime();
}

export default function DashboardPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const {
    data: overview,
    isLoading: overviewLoading,
    isError: overviewError,
    refetch: refetchOverview,
  } = useDashboardOverview(50);
  const user = useInitialUser();
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [extraClientPages, setExtraClientPages] = useState<Client[][]>([]);
  const [isFetchingNextClients, setIsFetchingNextClients] = useState(false);
  const dashboardClientIdParam = searchParams.get("clientId");

  const dashboardClientId = useMemo(() => {
    if (!dashboardClientIdParam) {
      return null;
    }

    const numericId = Number(dashboardClientIdParam);
    return Number.isInteger(numericId) && numericId > 0 ? numericId : null;
  }, [dashboardClientIdParam]);

  const initialClientsPage = overview?.clients;

  const clients = useMemo(() => {
    const initialClients = initialClientsPage?.data ?? [];
    return [...initialClients, ...extraClientPages.flat()];
  }, [extraClientPages, initialClientsPage?.data]);

  const hasMoreClients = Boolean(
    initialClientsPage && 1 + extraClientPages.length < initialClientsPage.totalPages
  );

  const updateDashboardClientQuery = useCallback((clientId: number | null) => {
    const currentClientId = searchParams.get("clientId");
    if (
      (clientId === null && currentClientId === null) ||
      (clientId !== null && currentClientId === String(clientId))
    ) {
      return;
    }

    const params = new URLSearchParams(searchParams.toString());
    if (clientId === null) {
      params.delete("clientId");
    } else {
      params.set("clientId", String(clientId));
    }

    const nextQuery = params.toString();
    router.replace(nextQuery ? `/dashboard?${nextQuery}` : "/dashboard", { scroll: false });
  }, [router, searchParams]);

  const fetchNextClients = useCallback(async () => {
    if (!initialClientsPage || isFetchingNextClients || !hasMoreClients) return;

    setIsFetchingNextClients(true);
    try {
      const nextPage = 2 + extraClientPages.length;
      const page = await fetchDashboardClientPage(nextPage, initialClientsPage.limit);
      setExtraClientPages((prev) => [...prev, page.data]);
    } finally {
      setIsFetchingNextClients(false);
    }
  }, [extraClientPages.length, hasMoreClients, initialClientsPage, isFetchingNextClients]);

  const refetchClients = useCallback(async () => {
    setExtraClientPages([]);
    await refetchOverview();
  }, [refetchOverview]);

  const handleSelectClient = useCallback((client: Client) => {
    setSelectedClient(client);
    updateDashboardClientQuery(client.id);
  }, [updateDashboardClientQuery]);

  const handleClearSelectedClient = useCallback(() => {
    setSelectedClient(null);
    updateDashboardClientQuery(null);
  }, [updateDashboardClientQuery]);

  useEffect(() => {
    if (!dashboardClientIdParam) {
      return;
    }

    if (dashboardClientId === null) {
      updateDashboardClientQuery(null);
      return;
    }

    const matchingClient = clients.find((client) => client.id === dashboardClientId);
    if (matchingClient) {
      setSelectedClient((current) => (
        current?.id === matchingClient.id ? current : matchingClient
      ));
      return;
    }

    if (!overviewLoading && hasMoreClients && !isFetchingNextClients) {
      void fetchNextClients();
      return;
    }

    if (!overviewLoading && !overviewError && !hasMoreClients && !isFetchingNextClients) {
      updateDashboardClientQuery(null);
    }
  }, [
    clients,
    dashboardClientId,
    dashboardClientIdParam,
    fetchNextClients,
    hasMoreClients,
    isFetchingNextClients,
    overviewError,
    overviewLoading,
    updateDashboardClientQuery,
  ]);

  const actionRequiredClients = useMemo(() => {
    return clients
      .map((client) => {
        const status = getActionRequiredStatus(client);
        if (!status) {
          return null;
        }

        return {
          client,
          reason: status.reason,
          priority: status.priority,
        } satisfies ActionRequiredItem;
      })
      .filter((item): item is ActionRequiredItem => item !== null)
      .sort((a, b) => a.priority - b.priority);
  }, [clients]);

  const upcomingClients = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const weekFromNow = new Date(today);
    weekFromNow.setDate(today.getDate() + 7);
    weekFromNow.setHours(23, 59, 59, 999);

    return clients
      .filter((c) => {
        if (!c.startDate) return false;
        const start = new Date(c.startDate);
        start.setHours(0, 0, 0, 0);
        return start >= today && start <= weekFromNow;
      })
      .sort((a, b) => new Date(a.startDate!).getTime() - new Date(b.startDate!).getTime());
  }, [clients]);

  const visibleUpcomingClients = useMemo(() => {
    return upcomingClients.filter((client) => !client.startDate || !isToday(client.startDate));
  }, [upcomingClients]);

  const dashboardStats = useMemo(() => {
    return {
      activeClients: clients.filter((client) => client.serviceStatus === "active").length,
      upcomingSoon: visibleUpcomingClients.length,
      contractsRequired: actionRequiredClients.filter((item) => (
        item.reason === "이용자 완료 필요" || item.reason === "발송 필요"
      )).length,
    };
  }, [actionRequiredClients, clients, visibleUpcomingClients]);

  const selectedClientData = useMemo(() => {
    if (!selectedClient) return null;
    return clients.find((client) => client.id === selectedClient.id) ?? selectedClient;
  }, [clients, selectedClient]);

  const handleScheduleChangeDecided = useCallback((clientId: number) => {
    setSelectedClient((currentClient) => {
      if (!currentClient || currentClient.id !== clientId) {
        return currentClient;
      }

      return { ...currentClient, pendingScheduleChange: null };
    });
  }, []);

  if (!user) {
    redirect("/logout");
  }

  return (
    <section
      data-component="dashboard"
      className="flex flex-col gap-4 h-[calc(100dvh-11rem)] md:h-[calc(100dvh-4rem)]"
    >
      <h1 className="sr-only">대시보드</h1>
      <Block name="dashboard-stats" className="shrink-0">
        <StatsBar
          name="dashboard"
          isLoading={overviewLoading}
          density="responsive-square"
          items={DASHBOARD_STAT_KEYS.map((s) => ({
            icon: s.icon,
            value: dashboardStats[s.valueKey],
            label: s.label,
            counter: s.counter,
            colorIndex: s.colorIndex,
          }))}
        />
      </Block>

      <Block
        name="dashboard-split"
        className="flex-1 min-h-0"
      >
        <SplitLayout data-component="desktop_dashboard_split-layout"
          hasSelection={!!selectedClientData}
          onBack={handleClearSelectedClient}
        >
          <Block name="dashboard-activities-panel" className="h-full min-h-0">
            <RecentActivitiesPanel
              actionRequiredItems={actionRequiredClients}
              upcomingItems={visibleUpcomingClients}
              isLoading={overviewLoading}
              isError={overviewError}
              onRetry={() => refetchClients()}
              selectedId={selectedClientData?.id}
              onSelect={handleSelectClient}
              hasMore={hasMoreClients}
              onLoadMore={() => void fetchNextClients()}
              isFetchingMore={isFetchingNextClients}
            />
          </Block>

          {selectedClientData ? (
            <ClientDetailPanel
              client={selectedClientData}
              dataComponentPrefix="desktop_dashboard_client-detail_panel"
              messageHistoryDataComponentPrefix="desktop_dashboard_client-detail_panel_message-history"
              idPrefix="dashboard-client-detail"
              tabsAriaLabel="고객 상세 정보"
              onScheduleChangeDecided={handleScheduleChangeDecided}
              trailing={
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label="고객 상세 메뉴"
                      className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-v3-dim-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-v3-primary focus-visible:ring-offset-2"
                    >
                      <MoreVertical className="w-5 h-5 text-v3-text-muted" aria-hidden="true" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-[140px]">
                    <DropdownMenuItem asChild className="gap-2">
                      <Link href={`/clients?id=${selectedClientData.id}`}>
                        <ExternalLink className="w-4 h-4" />
                        고객 상세 보기
                      </Link>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              }
            />
          ) : (
            <DetailPanel data-component="desktop_dashboard_split-layout_detail-panel"
              emptyState={
                <DetailEmptyState
                  name="dashboard-detail-empty"
                  message="항목을 선택하면 상세 정보가 표시됩니다"
                />
              }
            >
              {null}
            </DetailPanel>
          )}
        </SplitLayout>
      </Block>
    </section>
  );
}
