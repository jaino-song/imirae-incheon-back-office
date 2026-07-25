"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { User, Users, Workflow } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";

import { clientQueryKeys, fetchClient, useClient, useDeleteClient } from "@/hooks/useClients";
import { useEmployees } from "@/hooks/useEmployees";
import { useInfiniteClients } from "@/hooks/useInfiniteClients";
import { useListInfiniteScroll } from "@/hooks/useListInfiniteScroll";
import { useClientMessageHistory } from "@/hooks/useClientMessageHistory";
import { Client } from "@/lib/client/types";
import { getMobileClientBadges } from "@/lib/client/badges";
import { getStatusCategory } from "@/lib/eformsign/status-codes";
import { useLocale } from "@/providers/LocaleProvider";
import { eformsignApi, withEformsignReauth } from "@/services/api";
import { t } from "@/lib/i18n/translations";
import { todayIsoDate } from "@/lib/contracts/date-input";
import { formatDateForDisplay } from "@/lib/date/format-date-for-display";
import { parsePositiveIntQueryParam } from "@/lib/query-params";
import { toast } from "@/hooks/use-toast";
import { ClientDetailModal } from "@/components/app/clients/ClientDetailModal";
import { MobileTwoButtonModal } from "@/components/app/ui/MobileTwoButtonModal";
import { matchesKoreanSearch } from "@/lib/search/korean-search";
import { useFormStore } from "@/stores/form-store";
import {
  ListCard,
  ListCountSkeleton,
  ListItemRow,
  ListLoadMoreButton,
  ListLoadMoreSentinel,
  ListRowBadges,
  ListRowsSkeleton,
  MobileSectionNav,
} from "@/components/app/mobile-redesign/primitives";
import { ClientRegistrationPolicySettings } from "@/components/app/mobile-redesign/ClientRegistrationPolicySettings";
import {
  MobileDetailSheet,
  MobileSearchBar,
} from "@/components/app/mobile-redesign/detail-sheet";
import { ClientDetailContent, GROUPS, type ClientGroup, type DetailTabId } from "@/components/app/clients/client-detail";
import "@/components/app/mobile-redesign/redesign.css";

const CLIENTS_ROUTE_BODY_CLASS = "mobile-clients-route";
const ALL_FILTER = "전체";
const CONTRACT_REQUIRED_FILTER = "계약서 필요";
const CLIENT_SECTIONS = [
  { id: "list", label: "고객 목록", icon: Users },
  { id: "automation", label: "자동화", icon: Workflow },
] as const;

type ClientSectionId = (typeof CLIENT_SECTIONS)[number]["id"];

function defaultClientMeta(c: Client) {
  const type = c.type ?? "유형 미정";
  return c.primaryEmployee?.name
    ? `${type} · ${c.primaryEmployee.name}`
    : `${type} · 제공인력 미배정`;
}

function primaryEmployeeMeta(c: Client) {
  return c.primaryEmployee?.name ?? "제공인력 미배정";
}

function compactDateToIsoDate(value: string | null | undefined): string | null {
  const digits = (value ?? "").replace(/\D/g, "");
  if (digits.length < 8) return null;

  const year = digits.slice(0, 4);
  const month = digits.slice(4, 6);
  const day = digits.slice(6, 8);
  const iso = `${year}-${month}-${day}`;
  const date = new Date(`${iso}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : iso;
}

function yymmddToIsoDate(value: string | null | undefined): string | null {
  const digits = (value ?? "").replace(/\D/g, "");
  if (digits.length !== 6) return null;

  const yy = Number(digits.slice(0, 2));
  const month = digits.slice(2, 4);
  const day = digits.slice(4, 6);
  const year = yy >= 70 ? 1900 + yy : 2000 + yy;
  const iso = `${year}-${month}-${day}`;
  const date = new Date(`${iso}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : iso;
}

function formatKoreanDate(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;

  const dateOnlyMatch = dateStr.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (dateOnlyMatch) {
    const year = dateOnlyMatch[1];
    const month = dateOnlyMatch[2].padStart(2, "0");
    const day = dateOnlyMatch[3].padStart(2, "0");
    return `${year}.${month}.${day}`;
  }

  const normalized = compactDateToIsoDate(dateStr) ?? yymmddToIsoDate(dateStr) ?? dateStr;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return null;
  return formatDateForDisplay(date, "");
}

function labeledDateMeta(label: string, dateStr: string | null | undefined, c: Client): string {
  const date = formatKoreanDate(dateStr);
  return `${label} ${date ?? "-"} · ${primaryEmployeeMeta(c)}`;
}

function clientMeta(c: Client) {
  switch (c.serviceStatus) {
    case "pre_booking":
      return labeledDateMeta("상담 등록일", c.createdAt, c);
    case "waiting":
      return labeledDateMeta("예정일", c.dueDate, c);
    case "active":
    case "completed":
      return labeledDateMeta("종료일", c.endDate, c);
    case "terminated":
      return labeledDateMeta("중단일", c.updatedAt ?? c.endDate ?? c.createdAt, c);
    case "replacement_requested":
      return labeledDateMeta("교체 요청일", c.updatedAt ?? c.createdAt, c);
    default:
      return defaultClientMeta(c);
  }
}

// "최근 활동순" 정렬 키 — clients는 활동 timestamp가 없어 서비스 시작일(startDate) 기준, 동률은 최신 id.
function clientRecency(c: Client): number {
  const t = c.startDate ? new Date(c.startDate).getTime() : NaN;
  return Number.isFinite(t) ? t : 0;
}

function documentStatusFromStatusType(statusType: string | null | undefined): Client["documentStatus"] {
  const normalized = statusType?.trim().padStart(3, "0");
  if (!normalized) return null;

  const category = getStatusCategory(normalized);
  if (category === "completed") return "completed";
  if (category === "expired") return "rejected";
  if (normalized === "020") return "opened";
  if (["001", "002", "010", "043"].includes(normalized)) return "created";
  if (["030", "060", "070"].includes(normalized)) return "requested";
  return null;
}

export function buildAllClientRowsForList(clients: Client[]): Client[] {
  return [...clients].sort((a, b) => clientRecency(b) - clientRecency(a) || b.id - a.id);
}

const UNKNOWN_CLIENT_GROUP: ClientGroup = {
  key: "unknown",
  title: "상태 미정",
  badge: "상태 미정",
  badgeTone: "muted",
  badgeMini: "muted",
  match: () => false,
  counter: "명",
};

export function groupForClient(c: Client): ClientGroup {
  return GROUPS.find((g) => g.match(c)) ?? UNKNOWN_CLIENT_GROUP;
}

function hasContractRequiredBadge(c: Client): boolean {
  return getMobileClientBadges(c).some((badge) => badge.key === "contract_required");
}

function contractPrefillDate(value: string | null | undefined): string | undefined {
  if (!value) return undefined;

  const dateOnlyMatch = value.match(/^(\d{4}-\d{2}-\d{2})/);
  return dateOnlyMatch?.[1] ?? compactDateToIsoDate(value) ?? yymmddToIsoDate(value) ?? undefined;
}

export default function ClientsPage() {
  const locale = useLocale();
  const router = useRouter();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const selectedClientIdFromParam = parsePositiveIntQueryParam(searchParams.get("id"));

  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [detailSheetTab, setDetailSheetTab] = useState<DetailTabId>("basic");
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [deleteTargetClientId, setDeleteTargetClientId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<string>(ALL_FILTER);
  const [activeSection, setActiveSection] = useState<ClientSectionId>("list");
  const selectClientRequestRef = useRef(0);
  const prefillContractCreation = useFormStore((state) => state.prefillFromContract);

  useEffect(() => {
    document.body.classList.add(CLIENTS_ROUTE_BODY_CLASS);
    return () => {
      document.body.classList.remove(CLIENTS_ROUTE_BODY_CLASS);
    };
  }, []);

  const { allClients, allFilteredClients, total, isLoading, isFetching } = useInfiniteClients({
    filter: "all",
    search: searchQuery,
    filterFn: () => true,
    searchFn: (c, query) =>
      matchesKoreanSearch(c.name, query) ||
      (c.primaryEmployee?.name
        ? matchesKoreanSearch(c.primaryEmployee.name, query)
        : false),
  });
  const isClientsFetching = isLoading || (isFetching && allClients.length === 0);

  const deleteClient = useDeleteClient();
  const { data: employees = [] } = useEmployees();
  const { data: clientFromParam } = useClient(selectedClientIdFromParam ?? 0);
  const detailClient = selectedClient ?? (selectedClientIdFromParam !== null ? clientFromParam ?? null : null);
  const {
    notificationLogs: detailNotificationLogs,
    isLoading: isNotificationLogsLoading,
    isError: isNotificationLogsError,
    refetch: refetchNotificationLogs,
  } = useClientMessageHistory(detailClient);
  const { data: syncedContractDoc } = useQuery({
    queryKey: ["eformsign-docs", "sync-status", detailClient?.eDocId],
    queryFn: async () => {
      if (!detailClient?.eDocId) {
        throw new Error("documentId is required");
      }
      return withEformsignReauth(() => eformsignApi.syncDocumentStatus(detailClient.eDocId!));
    },
    enabled: Boolean(detailClient?.eDocId && detailSheetTab === "contracts"),
    staleTime: 1000 * 30,
    retry: 1,
  });
  const { data: detailContractDocument } = useQuery({
    queryKey: ["eformsign-docs", "document", detailClient?.eDocId],
    queryFn: async () => {
      if (!detailClient?.eDocId) {
        throw new Error("documentId is required");
      }
      return withEformsignReauth(() => eformsignApi.getDocument(detailClient.eDocId!));
    },
    enabled: Boolean(detailClient?.eDocId && (detailSheetTab === "basic" || detailSheetTab === "contracts")),
    staleTime: 1000 * 60,
    retry: 1,
  });

  const syncedDetailClient = useMemo(() => {
    if (!detailClient) return null;

    const documentStatus = documentStatusFromStatusType(syncedContractDoc?.statusType);
    if (!documentStatus || syncedContractDoc?.documentId !== detailClient.eDocId) {
      return detailClient;
    }

    return {
      ...detailClient,
      documentStatus,
      hasSigned: documentStatus === "completed" ? true : detailClient.hasSigned,
    };
  }, [detailClient, syncedContractDoc]);

  useEffect(() => {
    if (!detailClient || syncedContractDoc?.documentId !== detailClient.eDocId) return;

    const documentStatus = documentStatusFromStatusType(syncedContractDoc.statusType);
    if (!documentStatus) return;

    queryClient.invalidateQueries({ queryKey: clientQueryKeys.lists() });
    queryClient.invalidateQueries({ queryKey: clientQueryKeys.detail(detailClient.id) });
  }, [detailClient, queryClient, syncedContractDoc]);

  const handleSelectClient = async (client: Client) => {
    const requestId = selectClientRequestRef.current + 1;
    selectClientRequestRef.current = requestId;
    setSelectedClient(client);
    setDetailSheetTab(client.pendingScheduleChange ? "scheduleChange" : "basic");

    try {
      const freshClient = await queryClient.fetchQuery({
        queryKey: clientQueryKeys.detail(client.id),
        queryFn: () => fetchClient(client.id),
        staleTime: 0,
      });
      if (selectClientRequestRef.current !== requestId) return;

      setSelectedClient(freshClient);
      setDetailSheetTab(freshClient.pendingScheduleChange ? "scheduleChange" : "basic");

      if (!freshClient.eDocId || freshClient.documentStatus === "completed") return;

      const syncedDoc = await withEformsignReauth(() =>
        eformsignApi.syncDocumentStatus(freshClient.eDocId!),
      );
      if (selectClientRequestRef.current !== requestId) return;

      const documentStatus = documentStatusFromStatusType(syncedDoc.statusType);
      if (!documentStatus || syncedDoc.documentId !== freshClient.eDocId) return;

      setSelectedClient({
        ...freshClient,
        documentStatus,
        hasSigned: documentStatus === "completed" ? true : freshClient.hasSigned,
      });
      queryClient.invalidateQueries({ queryKey: clientQueryKeys.lists() });
      queryClient.invalidateQueries({ queryKey: clientQueryKeys.detail(freshClient.id) });
    } catch {
      // Keep the already-open list row detail. Row selection should not be blocked by refresh failures.
    }
  };

  const handleClientUpdated = (updatedClient: Client) => {
    setSelectedClient(updatedClient);
    queryClient.setQueryData(clientQueryKeys.detail(updatedClient.id), updatedClient);
    void queryClient.invalidateQueries({ queryKey: clientQueryKeys.lists() });
    void queryClient.invalidateQueries({ queryKey: clientQueryKeys.detail(updatedClient.id) });
  };

  const handleCloseDetailSheet = () => {
    selectClientRequestRef.current += 1;
    setSelectedClient(null);
    if (selectedClientIdFromParam !== null) {
      router.replace("/clients");
    }
  };

  const handleEdit = (client: Client) => {
    // 기존 ClientFormDialog(데스크탑 폼) 대신 mockup 디자인의 wizard로 라우팅 — `?clientId`로 편집 모드 진입.
    setDetailModalOpen(false);
    router.push(`/clients/new?clientId=${client.id}`);
  };

  const handleMessage = (client: Client) => {
    router.push(`/messages/new?clientId=${client.id}`);
  };

  const handleIssueContract = (client: Client) => {
    const primaryEmployee =
      employees.find((employee) => employee.id === client.primaryEmployee?.id) ??
      employees.find((employee) => employee.name.trim() === client.primaryEmployee?.name?.trim());

    prefillContractCreation({
      clientId: client.id,
      name: client.name,
      phone: client.phone ?? "",
      birthday: client.birthday ?? "",
      dueDate: contractPrefillDate(client.dueDate),
      address: client.address ?? "",
      employeeId: primaryEmployee?.id ?? client.primaryEmployee?.id ?? null,
      employeeName: primaryEmployee?.name ?? client.primaryEmployee?.name ?? "",
      employeePhone: primaryEmployee?.phone ?? "",
      startDate: contractPrefillDate(client.startDate),
      endDate: contractPrefillDate(client.endDate),
      fullPrice: client.fullPrice ?? "",
      grant: client.grant ?? "",
      actualPrice: client.actualPrice ?? "",
      paymentDate: todayIsoDate(),
      voucherType: client.type ?? "",
      voucherDuration: client.duration != null ? String(client.duration) : "",
      area: "",
    });
    router.push("/contracts/new");
  };

  const handleDeleteRequest = (id: number) => {
    setDeleteTargetClientId(id);
  };

  const handleDeleteConfirm = async () => {
    if (deleteTargetClientId == null) return;
    try {
      await deleteClient.mutateAsync(deleteTargetClientId);
      if (detailClient?.id === deleteTargetClientId) {
        setSelectedClient(null);
        setDetailModalOpen(false);
      }
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

  const grouped = useMemo(() => {
    const counts: Record<string, number> = {};
    const map: Record<string, Client[]> = {};
    for (const g of GROUPS) {
      const matched = allFilteredClients.filter(g.match);
      counts[g.key] = matched.length;
      map[g.key] = matched;
    }
    return { counts, map };
  }, [allFilteredClients]);
  const contractRequiredClients = useMemo(
    () => allFilteredClients.filter(hasContractRequiredBadge),
    [allFilteredClients],
  );

  const filterItems = useMemo(() => {
    if (isClientsFetching) {
      return [
        { label: ALL_FILTER, count: "", skeleton: true },
        { label: CONTRACT_REQUIRED_FILTER, count: "", skeleton: true },
        ...GROUPS.map((g) => ({ label: g.title, count: "", skeleton: true })),
      ];
    }

    const items = [
      {
        label: ALL_FILTER,
        count: String(total ?? allClients.length),
      },
      {
        label: CONTRACT_REQUIRED_FILTER,
        count: String(contractRequiredClients.length),
      },
    ];
    for (const g of GROUPS) {
      items.push({
        label: g.title,
        count: String(grouped.counts[g.key] ?? 0),
      });
    }
    return items;
  }, [allClients.length, contractRequiredClients.length, grouped.counts, isClientsFetching, total]);

  const sectionsFull = useMemo(() => {
    type Section = {
      key: string;
      title: string;
      group: ClientGroup;
      fullRows: Client[];
      fullCount: number;
    };

    // 전체: 카테고리 grouping 없이 최근 활동순 단일 리스트 (총 8개부터 teaser → 무한 스크롤).
    if (activeFilter === ALL_FILTER) {
      const flat = buildAllClientRowsForList(allFilteredClients);
      return flat.length > 0
        ? [{ key: "all", title: "", group: GROUPS[0], fullRows: flat, fullCount: flat.length }]
        : [];
    }

    if (activeFilter === CONTRACT_REQUIRED_FILTER) {
      return contractRequiredClients.length > 0
        ? [{
            key: "contract_required",
            title: `${CONTRACT_REQUIRED_FILTER} · ${contractRequiredClients.length}명`,
            group: GROUPS[0],
            fullRows: contractRequiredClients,
            fullCount: contractRequiredClients.length,
          }]
        : [];
    }

    // 개별 필터: 해당 상태 그룹 단일 섹션.
    const sections: Section[] = [];
    for (const g of GROUPS) {
      if (g.title !== activeFilter) continue;
      const docs = grouped.map[g.key];
      if (!docs || docs.length === 0) continue;
      sections.push({
        key: g.key,
        title: `${g.title} · ${docs.length}${g.counter}`,
        group: g,
        fullRows: docs,
        fullCount: docs.length,
      });
    }
    return sections;
  }, [activeFilter, contractRequiredClients, grouped.map, allFilteredClients]);

  const maxFullCount = useMemo(
    () => sectionsFull.reduce((m, s) => Math.max(m, s.fullCount), 0),
    [sectionsFull],
  );

  const { visibleCount, isInitialLoad, hasMore, sentinelRef, scrollContainerRef, loadMore } =
    useListInfiniteScroll({
      resetKey: `${activeFilter}::${searchQuery}`,
      totalItems: maxFullCount,
    });

  const visibleSections = useMemo(
    () =>
      sectionsFull
        .map((s) => ({ ...s, rows: s.fullRows.slice(0, visibleCount) }))
        .filter((s) => s.rows.length > 0),
    [sectionsFull, visibleCount],
  );

  return (
    <>
      <MobileDetailSheet
        data-component="mobile_clients_detail-sheet"
        name="clients"
        isOpen={Boolean(detailClient)}
        onClose={handleCloseDetailSheet}
        list={
          <div
            className="shell-content flex-col gap-[calc(8px*var(--glint-ui-scale,1))]"
            data-component="mobile-clients-content"
          >
            <MobileSectionNav
              ariaLabel="고객 섹션"
              items={CLIENT_SECTIONS}
              activeId={activeSection}
              onSelect={setActiveSection}
            />
            {activeSection === "list" ? (
              <ListCard
              title="고객"
              count={
                isClientsFetching
                  ? <ListCountSkeleton dataComponentPrefix="mobile-clients" />
                  : `${total ?? allClients.length}명`
              }
              actionLabel="+ 추가"
              actionHref="/clients/new"
              filters={filterItems}
              activeFilter={activeFilter}
              onFilterChange={setActiveFilter}
              scrollRef={scrollContainerRef}
              loadMore={
                isInitialLoad && hasMore ? (
                  <ListLoadMoreButton
                    onLoadMore={loadMore}
                    dataComponentPrefix="mobile-clients"
                  />
                ) : null
              }
              beforeFilters={
                <MobileSearchBar
                  placeholder="고객 이름, 매니저 검색"
                  label="clients"
                  value={searchQuery}
                  onChange={setSearchQuery}
                />
              }
            >
              {isClientsFetching ? (
                <ListRowsSkeleton dataComponentPrefix="mobile-clients" />
              ) : visibleSections.length === 0 ? (
                <div
                  style={{
                    padding: "32px 16px",
                    textAlign: "center",
                    fontSize: "0.82rem",
                    color: "hsl(var(--v3-text-muted))",
                  }}
                  data-component="mobile-clients-empty"
                >
                  {searchQuery.trim() || activeFilter !== ALL_FILTER
                    ? "조건에 맞는 고객이 없습니다."
                    : "등록된 고객이 없습니다."}
                </div>
              ) : (
                <>
                {visibleSections.map((section) => (
                  <div
                    className="section-block"
                    key={section.key}
                    data-component="mobile-clients-section"
                  >
                    {section.rows.map((c, idx) => {
                      const g = groupForClient(c);
                      const badges = getMobileClientBadges(c);
                      const avatarTone = badges[0]?.tone ?? g.badgeTone;
                      return (
                      <ListItemRow
                        key={c.id}
                        style={{ animationDelay: `${Math.min(idx, 4) * 40}ms` }}
	                        dataComponent="mobile-clients-row"
	                        left={
	                          <div className={`list-avatar av-${avatarTone}`} data-component="mobile-clients-row-avatar">
	                            <User size={16} strokeWidth={2} />
	                          </div>
	                        }
                        name={c.name}
                        meta={clientMeta(c)}
                        right={<ListRowBadges badges={badges} />}
                        onClick={() => handleSelectClient(c)}
                      />
                      );
                    })}
                  </div>
                ))}
                {!isInitialLoad && hasMore && (
                  <ListLoadMoreSentinel
                    sentinelRef={sentinelRef}
                    dataComponentPrefix="mobile-clients"
                  />
                )}
                </>
              )}
              </ListCard>
            ) : (
              <ListCard title="고객 자동화" filters={[]}>
                <ClientRegistrationPolicySettings />
              </ListCard>
            )}
          </div>
        }
        detail={
          detailClient ? (
            <ClientDetailContent
              data-component="mobile_clients_detail-sheet_stack_detail-page_content"
              client={syncedDetailClient ?? detailClient}
              contractDocument={detailContractDocument ?? null}
              activeTab={detailSheetTab}
              notificationLogs={detailNotificationLogs}
              isNotificationLogsLoading={isNotificationLogsLoading}
              isNotificationLogsError={isNotificationLogsError}
              onRetryNotificationLogs={() => {
                void refetchNotificationLogs();
              }}
              isIssuingContract={false}
              onTabChange={setDetailSheetTab}
              onMessage={() => handleMessage(syncedDetailClient ?? detailClient)}
              onIssueContract={handleIssueContract}
              onEdit={handleEdit}
              onDelete={handleDeleteRequest}
              onClientUpdated={handleClientUpdated}
            />
          ) : (
            <div className="detail-body" data-component="mobile-clients-detail-empty" />
          )
        }
      />

      <ClientDetailModal
        open={detailModalOpen}
        onClose={() => setDetailModalOpen(false)}
        client={detailClient}
        onEdit={handleEdit}
        onDelete={handleDeleteRequest}
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

    </>
  );
}
