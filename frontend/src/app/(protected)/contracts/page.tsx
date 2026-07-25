"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { EformsignDocClientSummary } from "@babyjamjam/shared/types/eformsign";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { matchesSearchQuery } from "@/lib/search/korean-search";
import { formatDateForDisplay } from "@/lib/date/format-date-for-display";
import {
  FileText,
  FileSignature,
  ClipboardList,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Send,
  Calendar,
  User,
  Mail,
  MoreVertical,
  Eye,
  MapPin,
  Briefcase,
  Bell,
} from "lucide-react";
import {
  useDeleteEformsignDocument,
} from "@/hooks/useEformsignDocuments";
import { useEformsignAuth } from "@/hooks/useEformsignAuth";
import { useEformsignDocsLiveStream } from "@/hooks/useEformsignDocsLiveStream";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useInfiniteContracts } from "@/hooks/useInfiniteContracts";
import { ServiceRecordHeaderCard } from "@/features/service-records/components/ServiceRecordHeaderCard";
import { useClientServiceRecords } from "@/features/service-records/hooks/use-service-records";
import type { EformsignDocument, EformsignDocumentOption } from "@/lib/eformsign/types";
import {
  DocumentFilterType,
  mapDocStatusLabel,
  getStatusCategory,
  foldContractStats,
} from "@/lib/eformsign/status-codes";
import {
  StatsBar,
  SplitLayout,
  ListPanel,
  DetailPanel,
  DetailTabs,
  DetailTabPanels,
  StatusBadge,
  InfoCard,
  InfoRow,
  ActivityTimeline,
  AnimatedSlotList,
  HeaderActionButton,
  SteppedWizardStepper,
  Stepper,
  EmptyState,
  PageSection,
  DetailSkeleton,
  ListEmptyState,
  DetailEmptyState,
  SectionNav,
} from "@/components/app/v3";
import type { StatusType } from "@/components/app/v3";
import { TwoButtonModal } from "@/components/app/ui/TwoButtonModal";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { eformsignApi } from "@/services/api";
import { cn } from "@/lib/utils";
import {
  extractDocumentAddress,
  extractDocumentContactInfo,
  extractDocumentFieldValue,
  extractDocumentFieldValues,
  extractCustomerSignedTimestamp,
  extractOpenEvents,
  extractReRequestEvents,
} from "@/lib/eformsign/document-details";
import {
  UNKNOWN_CUSTOMER_NAME,
  customerName as getEformsignCustomerName,
} from "@/lib/eformsign/display-name";
import { formatIsoDateInput } from "@/lib/date/format-iso-input";
import { useAllVoucherPriceInfos } from "@/hooks/useVoucherData";
import { inferVoucherDurationFromAmounts } from "@/lib/voucher/duration";
import { ContractsListItem } from "@/components/app/contracts/ContractsListItem";
import {
  ContractReviewActionButton,
  type ContractReviewAction,
} from "@/components/app/contracts/ContractReviewActionButton";
import {
  ContractCreationForm,
  CONTRACT_CREATION_STEPPER_STEPS,
} from "@/components/app/contracts/ContractCreationForm";
import { StaffCompletionIframeModal } from "@/components/app/contracts/StaffCompletionIframeModal";
import {
  HeadlessProgressStepper,
  type HeadlessProgressEvent,
  type HeadlessProgressState,
  type HeadlessProgressStep,
  type HeadlessProgressStepKey,
} from "@/components/app/eformsign/HeadlessProgressStepper";
import { isFeatureEnabled } from "@/lib/feature-flags";

const FINALIZE_PROGRESS_STEPS: readonly HeadlessProgressStep[] = [
  { key: "client-started", label: "전자문서 클라이언트 시작", errorLabel: "전자문서 클라이언트 시작 실패" },
  { key: "info-inserted", label: "서비스 종료일 적용중", errorLabel: "서비스 종료일 적용 실패" },
  { key: "creating", label: "전자문서 최종 확인중", errorLabel: "전자문서 최종 확인 실패" },
  { key: "sent", label: "전자문서 처리 완료", errorLabel: "전자문서 처리 실패" },
];

const SERVICE_RECORD_FINALIZE_PROGRESS_STEPS: readonly HeadlessProgressStep[] =
  FINALIZE_PROGRESS_STEPS.filter((step) => step.key !== "info-inserted");

const INITIAL_FINALIZE_PROGRESS: HeadlessProgressState = {
  step: null,
  completed: false,
  failed: false,
};

type FinalizeProgressEvent = HeadlessProgressEvent;

function isFinalizeProgressStepKey(
  value: string,
  steps: readonly HeadlessProgressStep[] = FINALIZE_PROGRESS_STEPS,
): value is HeadlessProgressStepKey {
  return steps.some((item) => item.key === value);
}

function createFinalizeProgressId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `finalize-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const ContractDocumentPreviewModal = dynamic(
  () =>
    import("@/components/app/contracts/ContractDocumentPreviewModal").then(
      (module) => module.ContractDocumentPreviewModal
    ),
  { ssr: false }
);

const EXCLUDED_CUSTOMER_NAMES: string[] = [];

const TAB_ITEMS = [
  { label: "전체", value: "all" },
  { label: "대기", value: "in-progress" },
  { label: "완료", value: "completed" },
  { label: "기간 만료", value: "expired" },
];

const SERVICE_RECORD_TAB_ITEMS = [
  { label: "전체", value: "all" },
  { label: "진행중", value: "in-progress" },
  { label: "완료", value: "completed" },
];

const DETAIL_TABS = [
  { key: "document", label: "문서정보" },
  { key: "provider", label: "제공인력 정보" },
  { key: "service", label: "서비스 정보" },
] as const;

type DetailTabKey = (typeof DETAIL_TABS)[number]["key"];

type InfoCardRow = {
  label: string;
  value: React.ReactNode;
};

function displayCustomerName(doc: EformsignDocument | null): string | null {
  if (!doc) return null;
  const name = getEformsignCustomerName(doc);
  return name === UNKNOWN_CUSTOMER_NAME ? null : name;
}

function matchesDocumentSearch(
  doc: EformsignDocument,
  query: string,
  mappedCustomerName?: string | null,
): boolean {
  return matchesSearchQuery(query, [mappedCustomerName ?? displayCustomerName(doc), doc.document_name]);
}

function matchesDocumentStatusTab(doc: EformsignDocument, tab: string): boolean {
  if (tab === "all") return true;
  return getStatusCategory(doc.current_status?.status_type) === tab;
}

function formatDate(timestamp: number): string {
  return formatDateForDisplay(timestamp);
}

function formatDateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function mapCategoryToStatusType(category: "completed" | "expired" | "in-progress"): StatusType {
  switch (category) {
    case "completed":
      return "signed";
    case "expired":
      return "expired";
    case "in-progress":
      return "pending";
  }
}

function getSignatureProgress(
  category: "completed" | "expired" | "in-progress",
  hasOpenedDocument: boolean,
  isReviewNeeded: boolean
) {
  const isCompleted = category === "completed";
  const isSigned = isCompleted || isReviewNeeded;
  const steps = [
    { label: "문서 생성", done: true },
    { label: "발송 완료", done: true },
    { label: "이용자 문서 열람", done: isSigned || hasOpenedDocument },
    { label: "이용자 서명 완료", done: isSigned },
    { label: isCompleted ? "제공기관 검토 완료" : "제공기관 검토 필요", done: isCompleted },
    { label: "계약서 완료", done: isCompleted },
  ];
  return steps;
}

function normalizePhoneNumber(
  value:
    | string
    | null
    | undefined
    | {
        country_code?: string;
        phone_number?: string;
      }
): string {
  const rawValue =
    typeof value === "string"
      ? value
      : `${value?.country_code ?? ""}${value?.phone_number ?? ""}`;
  const digits = rawValue.replace(/\D/g, "");

  if (!digits) return "";
  if (digits.startsWith("0082")) return `0${digits.slice(4)}`;
  if (digits.startsWith("82")) return `0${digits.slice(2)}`;
  return digits;
}

function formatPhoneNumber(value: string): string {
  const digits = normalizePhoneNumber(value);

  if (digits.length <= 3) return digits;
  if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7, 11)}`;
}

function formatOptionalPhoneNumber(value: string | null | undefined): string {
  const digits = normalizePhoneNumber(value);
  return digits ? formatPhoneNumber(digits) : "–";
}

function formatCurrencyValue(value: string | null | undefined): string {
  if (!value) {
    return "–";
  }

  const digits = value.replace(/[^\d]/g, "");
  if (!digits) {
    return value;
  }

  return `${Number(digits).toLocaleString("ko-KR")}원`;
}

function formatFieldDate(year?: string | null, month?: string | null, day?: string | null): string | null {
  if (!year || !month || !day) {
    return null;
  }

  const normalizedYear = year.length === 2 ? `20${year}` : year;
  return `${normalizedYear}. ${month.padStart(2, "0")}. ${day.padStart(2, "0")}.`;
}

function formatSingleFieldDate(value?: string | null): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const match = trimmed.match(
    /^(\d{2,4})\s*(?:년|[./-])\s*(\d{1,2})\s*(?:월|[./-])\s*(\d{1,2})\s*(?:일)?\.?$/
  );
  if (!match) {
    return trimmed;
  }

  const [, year, month, day] = match;
  return formatFieldDate(year, month, day);
}

function extractFieldDate(
  document: Pick<EformsignDocument, "fields" | "detail_template_info"> | null | undefined,
  aliases: {
    year: string[];
    month: string[];
    day: string[];
    full?: string[];
  }
): string | null {
  const splitDate = formatFieldDate(
    extractDocumentFieldValue(document, aliases.year),
    extractDocumentFieldValue(document, aliases.month),
    extractDocumentFieldValue(document, aliases.day)
  );
  if (splitDate) {
    return splitDate;
  }

  return formatSingleFieldDate(
    aliases.full ? extractDocumentFieldValue(document, aliases.full) : null
  );
}

function pickServiceDaysValue(values: string[]): string | null {
  const matchedValue = values.find((value) => /^\d+일?$/.test(value.trim()));
  if (!matchedValue) {
    return null;
  }

  return matchedValue.endsWith("일") ? matchedValue : `${matchedValue}일`;
}

function pickContractDurationValue(values: string[]): string | null {
  return (
    values.find((value) => value.includes("~")) ??
    values.find((value) => value.includes("-")) ??
    null
  );
}

function normalizeDocumentYear(value: string | null | undefined, fallbackTimestamp: number): number {
  const digits = value?.replace(/[^\d]/g, "") ?? "";
  if (digits) {
    const normalized = digits.length === 2 ? `20${digits}` : digits.slice(0, 4);
    const year = Number(normalized);
    if (Number.isInteger(year) && year >= 2000 && year <= 2999) {
      return year;
    }
  }

  return new Date(fallbackTimestamp).getFullYear();
}

function InfoRowsCard({
  title,
  rows,
  loading = false,
  className,
}: {
  title: string;
  rows: InfoCardRow[];
  loading?: boolean;
  className?: string;
}) {
  return (
    <InfoCard data-component="desktop_contracts_detail-panel_info-card" title={title} className={className}>
      {rows.map((row, index) => (
        <InfoRow
          key={row.label}
          label={row.label}
          value={loading ? (
            <div data-component="info-row-skeleton" className="flex w-full justify-end">
              <Skeleton
                className={cn(
                  "bg-v3-border/70",
                  row.label === "주소" ? "h-10 w-[78%] rounded-[12px]" : "h-4 rounded-full",
                  row.label !== "주소" && ([
                    "w-24",
                    "w-20",
                    "w-28",
                    "w-32",
                    "w-36",
                    "w-24",
                  ][index % 6]),
                )}
              />
            </div>
          ) : row.value}
        />
      ))}
    </InfoCard>
  );
}

function canReRequestDocument(doc: EformsignDocument): boolean {
  return (
    getStatusCategory(doc.current_status?.status_type) === "in-progress" &&
    doc.current_status?.step_type === "05" &&
    Boolean(doc.current_status?.step_index)
  );
}

const NAV_SECTIONS = [
  { id: "maternity", label: "산모 계약서", icon: FileSignature },
  { id: "service-records", label: "제공기록지", icon: ClipboardList },
  { id: "caregiver", label: "제공인력 계약서", icon: Briefcase, disabled: true },
  { id: "documents", label: "전자문서 목록", icon: FileText, disabled: true },
  { id: "notifications", label: "알림 설정", icon: Bell, disabled: true },
] as const;

type SectionId = (typeof NAV_SECTIONS)[number]["id"];

export default function ContractsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [activeSection, setActiveSection] = useState<SectionId>("maternity");
  const [activeTab, setActiveTab] = useState<string>("all");
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [hasContractCreationSession, setHasContractCreationSession] = useState(false);
  const [contractCreationActiveStep, setContractCreationActiveStep] = useState(0);
  const [deleteTargetDocumentId, setDeleteTargetDocumentId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [serviceRecordActiveTab, setServiceRecordActiveTab] = useState("all");
  const [serviceRecordSearchQuery, setServiceRecordSearchQuery] = useState("");
  const [selectedServiceRecordDocId, setSelectedServiceRecordDocId] = useState<string | null>(null);

  const { isAuthenticated, isLoading: isLoadingAuth, error: authError } = useEformsignAuth({
    syncOnWindowFocus: false,
  });
  useEformsignDocsLiveStream(isAuthenticated);
  const { toast } = useToast();
  const deleteDocument = useDeleteEformsignDocument();
  const { data: feedbackTemplateConfig, isLoading: isFeedbackTemplateLoading } = useQuery({
    queryKey: ["eformsign-docs", "feedback-template-id"],
    queryFn: () => eformsignApi.getFeedbackTemplateId(),
    enabled: isAuthenticated,
    staleTime: 1000 * 60 * 60,
  });
  const { data: documentClientSummaries = [] } = useQuery({
    queryKey: ["eformsign-client-names"],
    queryFn: () => eformsignApi.getDocumentClientNames(),
    enabled: isAuthenticated,
    staleTime: 1000 * 60 * 5,
  });
  const documentClientSummaryById = useMemo(
    () => new Map(documentClientSummaries.map((summary) => [summary.documentId, summary])),
    [documentClientSummaries],
  );
  const resolveCustomerName = useCallback(
    (doc: EformsignDocument | null): string | null => {
      if (!doc) return null;
      const mappedName = documentClientSummaryById.get(doc.id)?.clientName.trim();
      return mappedName || displayCustomerName(doc);
    },
    [documentClientSummaryById],
  );
  // BJJ-multi-tier: match documents created on ANY configured 제공기록지 tier's template, not
  // just the base 5회 one. Falls back to the single base id for older backend responses.
  // Memoized so the array identity is stable for the useMemo deps below.
  const feedbackTemplateIds = useMemo(
    () => feedbackTemplateConfig?.templateIds
      ?? (feedbackTemplateConfig?.templateId ? [feedbackTemplateConfig.templateId] : []),
    [feedbackTemplateConfig],
  );
  const activeListTab = activeSection === "service-records" ? serviceRecordActiveTab : activeTab;
  const filterType: DocumentFilterType = activeListTab === "all" ? null : (activeListTab as DocumentFilterType);
  const templateFilter = useMemo(
    () => feedbackTemplateIds.length > 0
      ? {
          templateId: feedbackTemplateIds.join(","),
          templateMatch: activeSection === "service-records" ? "include" as const : "exclude" as const,
        }
      : undefined,
    [activeSection, feedbackTemplateIds],
  );
  const canFetchDocuments =
    isAuthenticated &&
    !isFeedbackTemplateLoading &&
    (activeSection !== "service-records" || feedbackTemplateIds.length > 0);

  // Fetch filtered docs with infinite scroll for the current tab
  const {
    documents: infiniteDocuments,
    isLoading: isLoadingInfinite,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    error,
  } = useInfiniteContracts({
    enabled: canFetchDocuments,
    filterType,
    excludedNames: EXCLUDED_CUSTOMER_NAMES,
    templateFilter,
  });
  // 전체 탭 StatsBar 카운터: 서버가 지점(인천=회사 전체) 상태 신호를 한 번 모아 내려주고
  // foldContractStats로 접는다. 무한 스크롤 목록과 분리되어, 스크롤하지 않아도 정확하다.
  const { data: statusCounts, isLoading: isCountsLoading } = useQuery({
    queryKey: ["eformsign-status-counts"],
    queryFn: () => eformsignApi.getDocumentStatusCounts(),
    enabled: isAuthenticated,
    staleTime: 1000 * 60 * 5,
  });
  const isBootstrappingAuth = isLoadingAuth && !isAuthenticated;
  // Initial loading: first auth bootstrap or first "all" data fetch
  const isInitialLoading = isBootstrappingAuth || isFeedbackTemplateLoading || isLoadingInfinite;
  // Content loading: fetching filtered data after initial load is complete
  const isContentLoading = !isInitialLoading && isLoadingInfinite;
  // Stats are derived from the "전체" tab's data and are independent of which
  // tab is currently being fetched — only show the skeleton until the very
  // first stats payload lands.
  const isStatsLoading = isBootstrappingAuth || isCountsLoading;
  const isServiceRecordListLoading = isInitialLoading;

  // Use infinite scroll documents, with optional local search filter
  const documents = useMemo(
    () => infiniteDocuments.filter(
      (doc) => matchesDocumentSearch(doc, searchQuery, resolveCustomerName(doc)),
    ),
    [infiniteDocuments, resolveCustomerName, searchQuery],
  );

  const serviceRecordDocuments = useMemo(() => {
    if (feedbackTemplateIds.length === 0) return [];
    return infiniteDocuments.filter(
      (doc) =>
        matchesDocumentStatusTab(doc, serviceRecordActiveTab) &&
        matchesDocumentSearch(doc, serviceRecordSearchQuery, resolveCustomerName(doc)),
    );
  }, [
    feedbackTemplateIds,
    infiniteDocuments,
    resolveCustomerName,
    serviceRecordActiveTab,
    serviceRecordSearchQuery,
  ]);

  const stats = useMemo(
    () => foldContractStats(statusCounts?.documents ?? []),
    [statusCounts],
  );

  const selectedDocument = useMemo(() => {
    if (!selectedDocId) return null;
    return documents.find((d) => d.id === selectedDocId) ?? null;
  }, [selectedDocId, documents]);

  const selectedServiceRecordDocument = useMemo(() => {
    if (!selectedServiceRecordDocId) return null;
    return serviceRecordDocuments.find((d) => d.id === selectedServiceRecordDocId) ?? null;
  }, [selectedServiceRecordDocId, serviceRecordDocuments]);

  const handleTabChange = (value: string) => {
    setActiveTab(value);
    setSelectedDocId(null);
  };

  const handleServiceRecordTabChange = (value: string) => {
    setServiceRecordActiveTab(value);
    setSelectedServiceRecordDocId(null);
  };

  const handleStartContractCreation = useCallback(() => {
    setSelectedDocId(null);
    setContractCreationActiveStep(0);
    setIsCreating(true);
  }, []);

  useEffect(() => {
    if (searchParams.get("create") !== "1") return;

    setActiveSection("maternity");
    handleStartContractCreation();
    router.replace("/contracts", { scroll: false });
  }, [handleStartContractCreation, router, searchParams]);

  const handleCloseContractCreation = useCallback(() => {
    setIsCreating(false);
    setHasContractCreationSession(false);
    setContractCreationActiveStep(0);
  }, []);

  const handleContractCreationSessionChange = useCallback((hasSession: boolean) => {
    setHasContractCreationSession(hasSession);
    if (!hasSession) {
      setContractCreationActiveStep(0);
    }
  }, []);

  const handleDeleteRequest = (documentId: string) => {
    setDeleteTargetDocumentId(documentId);
  };

  const handleDeleteConfirm = async () => {
    if (deleteTargetDocumentId == null) return;

    try {
      const response = await deleteDocument.mutateAsync(deleteTargetDocumentId);
      const deleted = response.result?.success_result?.includes(deleteTargetDocumentId);

      if (!deleted) {
        const failedItem = response.result?.fail_result?.find(
          (item) => item.document_id === deleteTargetDocumentId
        );
        throw new Error(failedItem?.message || "문서 삭제에 실패했습니다.");
      }

      if (selectedDocId === deleteTargetDocumentId) {
        setSelectedDocId(null);
      }
      if (selectedServiceRecordDocId === deleteTargetDocumentId) {
        setSelectedServiceRecordDocId(null);
      }

      setDeleteTargetDocumentId(null);
      toast({
        title: "문서 삭제 완료",
        description: "선택한 문서를 삭제했습니다.",
      });
    } catch (deleteError) {
      console.error("Failed to delete contract document:", deleteError);
      toast({
        title: "문서 삭제 실패",
        description:
          deleteError instanceof Error
            ? deleteError.message
            : "문서 삭제 중 오류가 발생했습니다. 다시 시도해주세요.",
        variant: "destructive",
      });
    }
  };

  if (authError || error) {
    return (
      <div data-component="contracts-error-container" className="p-[calc(24px*var(--glint-ui-scale,1))]">
        <div data-component="contracts-error-banner" className="rounded-[18px] bg-v3-burgundy-light p-[calc(24px*var(--glint-ui-scale,1))] text-center text-v3-burgundy">
          {authError
            ? "인증에 실패했습니다. 페이지를 새로고침 해주세요."
            : "문서를 불러오는데 실패했습니다."}
        </div>
      </div>
    );
  }

  return (
    <PageSection name="contracts">
      {/* TODO: 통계 카운트는 아직 제공기록지 문서를 포함한다. 후속 작업에서 통계 엔드포인트를 분리한다. */}
      <StatsBar
        name="contracts"
        isLoading={isStatsLoading}
        items={[
          { icon: CheckCircle2, value: stats.reviewNeeded, label: "검토 필요", counter: "건", colorIndex: 0 },
          { icon: Send, value: stats.sendRequired, label: "이용자 완료 필요", counter: "건", colorIndex: 1 },
          { icon: FileText, value: stats.drafting, label: "작성 대기중", counter: "건" },
          { icon: AlertTriangle, value: stats.expired, label: "기간 만료", counter: "건", colorIndex: 3 },
        ]}
      />

      <div
        data-component="contracts-sections"
        className="flex flex-1 min-h-0 flex-col gap-[calc(16px*var(--glint-ui-scale,1))] lg:flex-row"
      >
        <SectionNav
          items={NAV_SECTIONS}
          activeId={activeSection}
          onSelect={(id) => setActiveSection(id as SectionId)}
        />

        <div className="flex-1 min-w-0 min-h-0 flex flex-col">
          {activeSection === "maternity" ? (
            <section data-component="contracts-maternity" className="flex flex-1 min-h-0 flex-col">
        <SplitLayout data-component="desktop_contracts_split-layout"
          hasSelection={!!selectedDocument || isCreating || hasContractCreationSession}
          onBack={() => {
            setSelectedDocId(null);
            setIsCreating(false);
          }}
        >
          <ListPanel data-component="desktop_contracts_split-layout_list-panel"
            title="계약 목록"
            tabs={TAB_ITEMS}
            activeTab={activeTab}
            onTabChange={handleTabChange}
            searchValue={searchQuery}
            onSearchChange={setSearchQuery}
            searchPlaceholder="고객명, 문서명 검색..."
            isLoading={isInitialLoading}
            isContentLoading={isContentLoading}
            headerActions={
              <HeaderActionButton
                onClick={handleStartContractCreation}
                icon={Send}
                label="전자문서 발송"
                data-component="contracts-header-send-contract"
                className={
                  isCreating || hasContractCreationSession
                    ? "bg-v3-primary text-white hover:bg-v3-primary"
                    : undefined
                }
              />
            }
            emptyState={documents.length === 0 && !isInitialLoading && !isContentLoading ? (
              <ListEmptyState
                message={searchQuery.trim() ? "검색 결과가 없습니다" : "계약 문서가 없습니다"}
              />
            ) : undefined}
          >
            <AnimatedSlotList<EformsignDocument>
                items={documents}
                isLoading={isInitialLoading || isContentLoading}
                loadingCount={3}
                className="space-y-2"
                getItemKey={(doc) => doc.id}
                itemVariant="card"
                getSlotState={({ item, isLoading }) => {
                  const isActive = !isLoading && item && selectedDocument?.id === item.id;
                  return {
                    isActive: Boolean(isActive),
                    isInteractive: !isLoading && Boolean(item),
                  };
                }}
                onSlotClick={(doc) => { setIsCreating(false); setSelectedDocId(doc.id); }}
                // Load more props
                hasMore={hasNextPage}
                onLoadMore={() => fetchNextPage()}
                isFetchingMore={isFetchingNextPage}
                render={({ item: doc, isLoading }) => {
                  const customerName = resolveCustomerName(doc);

                  return (
                    <ContractsListItem
                      document={doc}
                      customerName={customerName}
                      isLoading={isLoading}
                    />
                  );
                }}
              />
          </ListPanel>

          {(isCreating || hasContractCreationSession) && (
            <div
              data-component="contracts-create-retained-session"
              className={isCreating ? "contents" : "hidden"}
            >
                <ContractCreationForm
                  onClose={handleCloseContractCreation}
                  onSessionStateChange={handleContractCreationSessionChange}
                  activeStep={contractCreationActiveStep}
                  onActiveStepChange={setContractCreationActiveStep}
                  renderLayout={({ content, footer, footerClassName }) => (
                    <DetailPanel data-component="desktop_contracts_split-layout_detail-panel_creation"
                      title="전자계약서 작성"
                      subtitle="고객에게 전자계약서를 발송합니다"
                      avatar={
                        <div
                          data-component="contracts-create-avatar"
                          className="flex h-[calc(48px*var(--glint-ui-scale,1))] w-[calc(48px*var(--glint-ui-scale,1))] shrink-0 items-center justify-center rounded-[16px] bg-v3-primary-light text-v3-primary"
                        >
                          <Send className="h-[calc(20px*var(--glint-ui-scale,1))] w-[calc(20px*var(--glint-ui-scale,1))]" />
                        </div>
                      }
                      stepper={
                        <SteppedWizardStepper
                          steps={CONTRACT_CREATION_STEPPER_STEPS}
                          currentStep={contractCreationActiveStep}
                        />
                      }
                      footerClassName={footerClassName}
                      footer={footer}
                      mainAnimationKey={contractCreationActiveStep}
                    >
                      {content}
                    </DetailPanel>
                  )}
                />
            </div>
          )}
          {!isCreating && isInitialLoading ? (
            <DetailSkeleton
              name="contracts-detail-skeleton"
              headerBadge
              headerBanner
              sections={[
                { titleWidth: "w-16", rows: ["w-1/2", "w-2/3"] },
                { titleWidth: "w-16", rows: ["w-3/4", "w-1/2", "w-2/3"] },
                { titleWidth: "w-20", rows: ["w-full"] },
              ]}
            />
          ) : !isCreating && selectedDocument ? (
            <ContractDetail
              key={selectedDocument.id}
              document={selectedDocument}
              documentClientSummary={documentClientSummaryById.get(selectedDocument.id) ?? null}
              onDeleteRequest={handleDeleteRequest}
            />
          ) : !isCreating && !hasContractCreationSession ? (
            <EmptyState icon={FileText} message="계약을 선택하면 상세 정보가 표시됩니다" />
          ) : null}
        </SplitLayout>
            </section>
          ) : null}

          {activeSection === "service-records" ? (
            <section data-component="contracts-service-records" className="flex flex-1 min-h-0 flex-col">
              <SplitLayout data-component="desktop_contracts_split-layout-2"
                hasSelection={!!selectedServiceRecordDocument}
                onBack={() => setSelectedServiceRecordDocId(null)}
              >
                <ListPanel data-component="desktop_contracts_split-layout_list-panel-2"
                  title="제공기록지 목록"
                  tabs={SERVICE_RECORD_TAB_ITEMS}
                  activeTab={serviceRecordActiveTab}
                  onTabChange={handleServiceRecordTabChange}
                  searchValue={serviceRecordSearchQuery}
                  onSearchChange={setServiceRecordSearchQuery}
                  searchPlaceholder="고객명, 문서명 검색..."
                  isLoading={isServiceRecordListLoading}
                  isContentLoading={isContentLoading}
                  emptyState={
                    serviceRecordDocuments.length === 0 && !isServiceRecordListLoading && !isContentLoading ? (
                      <ListEmptyState
                        message={serviceRecordSearchQuery.trim() ? "검색 결과가 없습니다" : "아직 제공기록지가 없습니다"}
                      />
                    ) : undefined
                  }
                >
                  <AnimatedSlotList<EformsignDocument>
                    items={serviceRecordDocuments}
                    isLoading={isServiceRecordListLoading || isContentLoading}
                    loadingCount={3}
                    className="space-y-2"
                    getItemKey={(doc) => doc.id}
                    itemVariant="card"
                    getSlotState={({ item, isLoading }) => {
                      const isActive =
                        !isLoading && item && selectedServiceRecordDocument?.id === item.id;
                      return {
                        isActive: Boolean(isActive),
                        isInteractive: !isLoading && Boolean(item),
                      };
                    }}
                    onSlotClick={(doc) => setSelectedServiceRecordDocId(doc.id)}
                    hasMore={hasNextPage}
                    onLoadMore={() => fetchNextPage()}
                    isFetchingMore={isFetchingNextPage}
                    render={({ item: doc, isLoading }) => (
                      <ContractsListItem
                        document={doc}
                        customerName={resolveCustomerName(doc)}
                        subtitle="제공기록지"
                        isLoading={isLoading}
                      />
                    )}
                  />
                </ListPanel>
                {isServiceRecordListLoading ? (
                  <DetailSkeleton
                    name="contracts-service-record-detail-skeleton"
                    headerBadge
                    headerBanner
                    sections={[
                      { titleWidth: "w-16", rows: ["w-1/2", "w-2/3"] },
                      { titleWidth: "w-16", rows: ["w-3/4", "w-1/2", "w-2/3"] },
                      { titleWidth: "w-20", rows: ["w-full"] },
                    ]}
                  />
                ) : selectedServiceRecordDocument ? (
                  <ContractDetail
                    key={selectedServiceRecordDocument.id}
                    document={selectedServiceRecordDocument}
                    documentClientSummary={documentClientSummaryById.get(selectedServiceRecordDocument.id) ?? null}
                    onDeleteRequest={handleDeleteRequest}
                    reviewAction="preview"
                  />
                ) : (
                  <EmptyState icon={ClipboardList} message="제공기록지를 선택하면 상세 정보가 표시됩니다" />
                )}
              </SplitLayout>
            </section>
          ) : null}

          {activeSection === "caregiver" ? (
            <section data-component="contracts-caregiver" className="flex flex-1 min-h-0 flex-col">
              <SplitLayout data-component="desktop_contracts_split-layout-3" hasSelection={false}>
                <ListPanel data-component="desktop_contracts_split-layout_list-panel-3"
                  title="제공인력 계약 목록"
                  subtitle="아직 준비중입니다"
                  avatar={
                    <div className="flex h-[calc(48px*var(--glint-ui-scale,1))] w-[calc(48px*var(--glint-ui-scale,1))] shrink-0 items-center justify-center rounded-[16px] bg-v3-primary-light text-v3-primary">
                      <Briefcase className="h-[calc(20px*var(--glint-ui-scale,1))] w-[calc(20px*var(--glint-ui-scale,1))]" />
                    </div>
                  }
                  emptyState={<ListEmptyState message="아직 준비중입니다" />}
                >
                  {null}
                </ListPanel>
                <DetailPanel data-component="desktop_contracts_split-layout_detail-panel-2"
                  title="제공인력 계약서"
                  subtitle="아직 준비중입니다"
                  avatar={
                    <div className="flex h-[calc(48px*var(--glint-ui-scale,1))] w-[calc(48px*var(--glint-ui-scale,1))] shrink-0 items-center justify-center rounded-[16px] bg-v3-primary-light text-v3-primary">
                      <Briefcase className="h-[calc(20px*var(--glint-ui-scale,1))] w-[calc(20px*var(--glint-ui-scale,1))]" />
                    </div>
                  }
                >
                  <DetailEmptyState icon={Briefcase} message="아직 준비중입니다" />
                </DetailPanel>
              </SplitLayout>
            </section>
          ) : null}

          {activeSection === "documents" ? (
            <section data-component="contracts-documents" className="flex flex-1 min-h-0 flex-col">
              <SplitLayout data-component="desktop_contracts_split-layout-4" hasSelection={false}>
                <ListPanel data-component="desktop_contracts_split-layout_list-panel-4"
                  title="전자문서 목록"
                  subtitle="아직 준비중입니다"
                  avatar={
                    <div className="flex h-[calc(48px*var(--glint-ui-scale,1))] w-[calc(48px*var(--glint-ui-scale,1))] shrink-0 items-center justify-center rounded-[16px] bg-v3-primary-light text-v3-primary">
                      <FileText className="h-[calc(20px*var(--glint-ui-scale,1))] w-[calc(20px*var(--glint-ui-scale,1))]" />
                    </div>
                  }
                  emptyState={<ListEmptyState message="아직 준비중입니다" />}
                >
                  {null}
                </ListPanel>
                <DetailPanel data-component="desktop_contracts_split-layout_detail-panel-3"
                  title="전자문서"
                  subtitle="아직 준비중입니다"
                  avatar={
                    <div className="flex h-[calc(48px*var(--glint-ui-scale,1))] w-[calc(48px*var(--glint-ui-scale,1))] shrink-0 items-center justify-center rounded-[16px] bg-v3-primary-light text-v3-primary">
                      <FileText className="h-[calc(20px*var(--glint-ui-scale,1))] w-[calc(20px*var(--glint-ui-scale,1))]" />
                    </div>
                  }
                >
                  <DetailEmptyState icon={FileText} message="아직 준비중입니다" />
                </DetailPanel>
              </SplitLayout>
            </section>
          ) : null}

          {activeSection === "notifications" ? (
            <section data-component="contracts-notifications" className="flex flex-1 min-h-0 flex-col">
              <SplitLayout data-component="desktop_contracts_split-layout-5" hasSelection={false}>
                <ListPanel data-component="desktop_contracts_split-layout_list-panel-5"
                  title="알림 설정"
                  subtitle="아직 준비중입니다"
                  avatar={
                    <div className="flex h-[calc(48px*var(--glint-ui-scale,1))] w-[calc(48px*var(--glint-ui-scale,1))] shrink-0 items-center justify-center rounded-[16px] bg-v3-primary-light text-v3-primary">
                      <Bell className="h-[calc(20px*var(--glint-ui-scale,1))] w-[calc(20px*var(--glint-ui-scale,1))]" />
                    </div>
                  }
                  emptyState={<ListEmptyState message="아직 준비중입니다" />}
                >
                  {null}
                </ListPanel>
                <DetailPanel data-component="desktop_contracts_split-layout_detail-panel-4"
                  title="알림 설정"
                  subtitle="아직 준비중입니다"
                  avatar={
                    <div className="flex h-[calc(48px*var(--glint-ui-scale,1))] w-[calc(48px*var(--glint-ui-scale,1))] shrink-0 items-center justify-center rounded-[16px] bg-v3-primary-light text-v3-primary">
                      <Bell className="h-[calc(20px*var(--glint-ui-scale,1))] w-[calc(20px*var(--glint-ui-scale,1))]" />
                    </div>
                  }
                >
                  <DetailEmptyState icon={Bell} message="아직 준비중입니다" />
                </DetailPanel>
              </SplitLayout>
            </section>
          ) : null}
        </div>
      </div>

      <TwoButtonModal
        open={deleteTargetDocumentId != null}
        onOpenChange={(open) => {
          if (!open && !deleteDocument.isPending) {
            setDeleteTargetDocumentId(null);
          }
        }}
        dataComponent="contracts-delete-approval"
        title="문서를 삭제하시겠습니까?"
        description="삭제한 전자문서는 복구할 수 없습니다."
        approvalLabel="삭제"
        pendingLabel="삭제 중..."
        approvalVariant="destructive"
        isPending={deleteDocument.isPending}
        onApprove={() => void handleDeleteConfirm()}
      />
    </PageSection>
  );
}

function ContractDetail({
  document: doc,
  documentClientSummary,
  onDeleteRequest,
  reviewAction = "finalize",
}: {
  document: EformsignDocument;
  documentClientSummary?: EformsignDocClientSummary | null;
  onDeleteRequest?: (documentId: string) => void;
  reviewAction?: ContractReviewAction;
}) {
  const isMobile = useIsMobile();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const detailQuery = useQuery<EformsignDocument>({
    queryKey: ["eformsign-documents", "detail", doc.id],
    queryFn: async () => eformsignApi.getDocument(doc.id),
    placeholderData: doc,
    staleTime: 1000 * 60,
    refetchOnWindowFocus: false,
  });
  const detailedDocument = detailQuery.data ?? doc;
  const isBaseDetailLoading = detailQuery.isFetching || detailQuery.isPlaceholderData;
  const mappedCustomerName = documentClientSummary?.clientName.trim();
  const customerName = mappedCustomerName || displayCustomerName(detailedDocument) || "–";
  const isServiceRecordDocument = reviewAction === "preview";
  const serviceRecordQuery = useClientServiceRecords(documentClientSummary?.clientId ?? null, {
    enabled: isServiceRecordDocument,
  });
  const serviceRecordHeader = serviceRecordQuery.data?.record?.header
    ?? serviceRecordQuery.data?.assignments.find((assignment) => assignment.header)?.header
    ?? null;
  const category = getStatusCategory(detailedDocument.current_status?.status_type);
  const statusLabel = mapDocStatusLabel(detailedDocument.current_status);
  const statusType: StatusType =
    statusLabel === "검토 필요" ? "review" : mapCategoryToStatusType(category);
  const [activeDetailTab, setActiveDetailTab] = useState<DetailTabKey>("document");
  const [isReRequestDialogOpen, setIsReRequestDialogOpen] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isActivityOpen, setIsActivityOpen] = useState(false);
  const [isFinalizeOpen, setIsFinalizeOpen] = useState(false);
  const [isServiceRecordFinalizeConfirmOpen, setIsServiceRecordFinalizeConfirmOpen] = useState(false);
  const [finalizeEndDate, setFinalizeEndDate] = useState<string>("");
  const [finalizeProgress, setFinalizeProgress] = useState<HeadlessProgressState>(INITIAL_FINALIZE_PROGRESS);
  const finalizeProgressIdRef = useRef<string | null>(null);
  const finalizeEventSourceRef = useRef<EventSource | null>(null);
  const [isStaffCompletionOpen, setIsStaffCompletionOpen] = useState(false);
  const [staffCompletionOption, setStaffCompletionOption] = useState<EformsignDocumentOption | null>(null);
  const reviewDocumentLabel = reviewAction === "preview" ? "제공기록지" : "계약서";
  const finalizeProgressSteps = isServiceRecordDocument
    ? SERVICE_RECORD_FINALIZE_PROGRESS_STEPS
    : FINALIZE_PROGRESS_STEPS;
  const canReRequest = canReRequestDocument(detailedDocument);
  const reRequestStepType = detailedDocument.current_status?.step_type ?? "";
  const reRequestStepSeq = detailedDocument.current_status?.step_index ?? "";
  const currentRecipient = detailedDocument.current_status?.step_recipients?.[0];
  const contactInfo = extractDocumentContactInfo(detailedDocument);
  const initialRecipientPhone = normalizePhoneNumber(currentRecipient?.sms);
  const [recipientPhone, setRecipientPhone] = useState(initialRecipientPhone);
  const recipientPhoneDigits = normalizePhoneNumber(recipientPhone);
  const hasEditedRecipientPhone = recipientPhoneDigits !== initialRecipientPhone;
  const isRecipientPhoneValid =
    !hasEditedRecipientPhone || (recipientPhoneDigits.length >= 10 && recipientPhoneDigits.length <= 11);
  const documentAddress = extractDocumentAddress(detailedDocument);
  const customerAddress = documentAddress ?? null;
  const isCustomerInfoLoading = isBaseDetailLoading
    || (isServiceRecordDocument && serviceRecordQuery.isLoading);
  const customerBirthDate =
    extractDocumentFieldValue(detailedDocument, [
      "이용자 생년월일",
      "이용자생년월일",
      "고객 생년월일",
      "고객생년월일",
      "산모 생년월일",
      "산모생년월일",
    ]) ?? "–";
  const provider1Name =
    extractDocumentFieldValue(detailedDocument, [
      "제공인력 1 성명",
      "제공인력1성명",
      "제공인력 성명",
      "제공인력성명",
    ]) ?? "–";
  const provider1Contact = formatOptionalPhoneNumber(
    extractDocumentFieldValue(detailedDocument, [
      "제공인력 1 연락처",
      "제공인력1연락처",
      "제공인력 연락처",
      "제공인력연락처",
    ])
  );
  const provider2Name =
    extractDocumentFieldValue(detailedDocument, [
      "제공인력 2 성명",
      "제공인력2성명",
      "추가 제공인력 성명",
      "추가제공인력성명",
    ]) ?? "–";
  const provider2Contact = formatOptionalPhoneNumber(
    extractDocumentFieldValue(detailedDocument, [
      "제공인력 2 연락처",
      "제공인력2연락처",
      "추가 제공인력 연락처",
      "추가제공인력연락처",
    ])
  );
  const servicePriceValue = extractDocumentFieldValue(detailedDocument, [
    "서비스 비용",
    "서비스비용",
    "서비스 가격",
    "서비스가격",
    "fullPrice",
  ]);
  const governmentGrantValue = extractDocumentFieldValue(detailedDocument, [
    "정부지원금",
    "grant",
  ]);
  const outOfPocketValue = extractDocumentFieldValue(detailedDocument, [
    "본인부담금",
    "actualPrice",
  ]);
  const servicePrice = formatCurrencyValue(servicePriceValue);
  const governmentGrant = formatCurrencyValue(governmentGrantValue);
  const outOfPocket = formatCurrencyValue(outOfPocketValue);
  const servicePeriodValues = extractDocumentFieldValues(detailedDocument, [
    "서비스 기간",
    "서비스기간",
    "서비스 일수",
    "서비스일수",
    "days",
  ]);
  const voucherPriceYear = normalizeDocumentYear(
    extractDocumentFieldValue(detailedDocument, [
      "계약 시작 년도",
      "계약시작년도",
      "startYear",
      "voucherYear",
      "receiptYear",
    ]),
    detailedDocument.created_date
  );
  const allVoucherPriceInfosQuery = useAllVoucherPriceInfos(voucherPriceYear);
  const inferredServiceDays = useMemo(() => {
    const duration = inferVoucherDurationFromAmounts(allVoucherPriceInfosQuery.data, {
      fullPrice: servicePriceValue,
      grant: governmentGrantValue,
      actualPrice: outOfPocketValue,
    });

    return duration ? `${duration}일` : null;
  }, [
    allVoucherPriceInfosQuery.data,
    governmentGrantValue,
    outOfPocketValue,
    servicePriceValue,
  ]);
  const serviceDays = pickServiceDaysValue(servicePeriodValues) ?? inferredServiceDays ?? "–";
  const isServiceInfoLoading = isBaseDetailLoading || allVoucherPriceInfosQuery.isLoading;
  const contractDuration =
    pickContractDurationValue(servicePeriodValues) ??
    "–";
  const contractStartDate =
    extractFieldDate(detailedDocument, {
      year: ["계약 시작 년도", "계약시작년도", "startYear"],
      month: ["계약 시작 월", "계약시작월", "startMonth"],
      day: ["계약 시작 일", "계약시작일", "startDay"],
      full: ["계약 시작일", "계약시작일", "서비스 시작일", "서비스시작일", "startDate"],
    }) ?? "–";
  const contractEndDate =
    extractFieldDate(detailedDocument, {
      year: ["계약 종료 년도", "계약종료년도", "endYear"],
      month: ["계약 종료 월", "계약종료월", "endMonth"],
      day: ["계약 종료 일", "계약종료일", "endDay"],
      full: ["계약 종료일", "계약종료일", "서비스 종료일", "서비스종료일", "endDate"],
    }) ?? "–";
  const contractEndDateIso = (() => {
    const year = extractDocumentFieldValue(detailedDocument, ["계약 종료 년도", "계약종료년도", "endYear"]);
    const month = extractDocumentFieldValue(detailedDocument, ["계약 종료 월", "계약종료월", "endMonth"]);
    const day = extractDocumentFieldValue(detailedDocument, ["계약 종료 일", "계약종료일", "endDay"]);
    if (!year || !month || !day) return "";
    const yearNum = parseInt(year, 10);
    if (Number.isNaN(yearNum)) return "";
    const yearStr = (yearNum < 100 ? 2000 + yearNum : yearNum).toString().padStart(4, "0");
    return `${yearStr}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  })();
  const paymentDate =
    extractFieldDate(detailedDocument, {
      year: ["본인부담금 수령 년도", "본인부담금수령년도", "결제 년도", "결제년도", "paymentYear"],
      month: ["본인부담금 수령 월", "본인부담금수령월", "결제 월", "결제월", "paymentMonth"],
      day: ["본인부담금 수령 일", "본인부담금수령일", "결제 일", "결제일", "paymentDay"],
      full: ["본인부담금 수령일", "본인부담금수령일", "결제일", "paymentDate"],
    }) ?? "–";
  const receiptDate =
    extractFieldDate(detailedDocument, {
      year: ["영수증 년도", "영수증년도", "영수증 발행 년도", "영수증발행년도", "receiptYear"],
      month: ["영수증 월", "영수증월", "영수증 발행 월", "영수증발행월", "receiptMonth"],
      day: ["영수증 일", "영수증일", "영수증 발행 일", "영수증발행일", "receiptDay"],
      full: ["영수증 발행일", "영수증발행일", "영수증 날짜", "영수증날짜", "receiptDate"],
    }) ??
    // Contract creation currently stamps receipt fields with the document generation date.
    formatDate(detailedDocument.created_date);
  const reRequestEvents = extractReRequestEvents(detailedDocument);
  const openEvents = extractOpenEvents(detailedDocument);
  const hasOpenedDocument = openEvents.length > 0;
  const isReviewNeeded = mapDocStatusLabel(detailedDocument.current_status) === "검토 필요";
  const steps = getSignatureProgress(category, hasOpenedDocument, isReviewNeeded);
  const customerSignedTimestamp = extractCustomerSignedTimestamp(detailedDocument);
  const customerSignedDate =
    customerSignedTimestamp != null ? formatDateTime(customerSignedTimestamp) : null;
  const sentDate = formatDateTime(detailedDocument.created_date);
  const sentDateLabel = formatDate(detailedDocument.created_date);
  const contractCompletedDate =
    category === "completed" ? formatDateTime(detailedDocument.updated_date) : null;
  const contractCompletedDateLabel =
    category === "completed" ? formatDate(detailedDocument.updated_date) : null;

  const expiredDate = detailedDocument.current_status?.expired_date;
  const isFinalizeEndDateValid = /^\d{4}-\d{2}-\d{2}$/.test(finalizeEndDate);

  const handleReRequestDialogChange = (open: boolean) => {
    setIsReRequestDialogOpen(open);
    setRecipientPhone(initialRecipientPhone);
  };

  const closeFinalizeProgressStream = useCallback(() => {
    finalizeEventSourceRef.current?.close();
    finalizeEventSourceRef.current = null;
    finalizeProgressIdRef.current = null;
  }, []);

  const resetFinalizeState = () => {
    setIsFinalizeOpen(false);
    setIsServiceRecordFinalizeConfirmOpen(false);
    setFinalizeEndDate("");
    setFinalizeProgress(INITIAL_FINALIZE_PROGRESS);
    closeFinalizeProgressStream();
  };

  useEffect(() => {
    return () => {
      finalizeEventSourceRef.current?.close();
      finalizeEventSourceRef.current = null;
      finalizeProgressIdRef.current = null;
    };
  }, []);

  const closeStaffCompletionModal = () => {
    setIsStaffCompletionOpen(false);
    setStaffCompletionOption(null);
  };

  const handleFinalizeSuccess = () => {
    toast({
      title: "최종 확인 완료",
      description: `${reviewDocumentLabel}가 완료 처리되었습니다.`,
    });
    resetFinalizeState();
    queryClient.invalidateQueries({ queryKey: ["eformsign-documents"] });
  };

  const reRequestMutation = useMutation({
    mutationFn: async () => {
      return eformsignApi.reRequestDocument(doc.id, {
        stepType: reRequestStepType,
        stepSeq: reRequestStepSeq,
        comment: "재요청입니다.",
        recipientPhone: hasEditedRecipientPhone
          ? {
              countryCode: "+82",
              phoneNumber: recipientPhoneDigits,
            }
          : undefined,
      });
    },
    onSuccess: () => {
      handleReRequestDialogChange(false);
      queryClient.invalidateQueries({ queryKey: ["eformsign-documents"] });
      toast({
        description: `${customerName}님에게 전자문서 작성을 재요청했습니다.`,
      });
    },
    onError: (error) => {
      toast({
        variant: "destructive",
        description: error instanceof Error ? error.message : "재요청 중 오류가 발생했습니다.",
      });
    },
  });

  const openStaffCompletionMutation = useMutation({
    mutationFn: async (endDate?: string): Promise<{ kind: "headless" } | { kind: "iframe"; option: EformsignDocumentOption }> => {
      // BJJ-90: try the backend-driven finalize first when the flag is on.
      if (isFeatureEnabled("headlessDispatch")) {
        try {
          const progressId = finalizeProgressIdRef.current ?? undefined;
          const headless = await eformsignApi.finalizeHeadless(doc.id, endDate, progressId);
          if (headless.ok) {
            return { kind: "headless" };
          }
          console.warn("[finalize] headless finalize ok=false, falling back to iframe", headless.reason);
        } catch (headlessError) {
          console.warn("[finalize] headless finalize threw, falling back to iframe", headlessError);
        }
      }

      const authResult = await eformsignApi.authenticate(Date.now());
      if (!authResult.success) {
        throw new Error("eformsign 인증에 실패했습니다.");
      }

      const option = await eformsignApi.generateStaffDocument(doc.id, undefined, undefined, endDate);
      return { kind: "iframe", option };
    },
    onSuccess: (result) => {
      closeFinalizeProgressStream();
      setFinalizeProgress(INITIAL_FINALIZE_PROGRESS);
      if (result.kind === "headless") {
        setIsPreviewOpen(false);
        setIsFinalizeOpen(false);
        setFinalizeEndDate("");
        toast({
          title: "최종 확인 완료",
          description: `${reviewDocumentLabel}가 완료 처리되었습니다.`,
        });
        // Headless finalize completes within ~1s of the SDK success callback,
        // but eformsign's status field (060 → 070) and the matching webhook
        // can lag a few seconds behind. Invalidate immediately and again at
        // 2s/5s so the list eventually reflects the new status without
        // requiring the user to refresh the tab.
        queryClient.invalidateQueries({ queryKey: ["eformsign-documents"] });
        const delays = [2000, 5000];
        delays.forEach((delay) => {
          setTimeout(() => {
            queryClient.invalidateQueries({ queryKey: ["eformsign-documents"] });
            queryClient.invalidateQueries({
              queryKey: ["eformsign-documents", "detail", doc.id],
            });
          }, delay);
        });
        return;
      }
      setIsPreviewOpen(false);
      setStaffCompletionOption(result.option);
      setIsFinalizeOpen(false);
      setIsStaffCompletionOpen(true);
    },
    onError: (error) => {
      closeFinalizeProgressStream();
      setFinalizeProgress(INITIAL_FINALIZE_PROGRESS);
      toast({
        variant: "destructive",
        title: "최종 확인 실패",
        description: error instanceof Error ? error.message : "최종 확인 준비 중 오류가 발생했습니다.",
      });
    },
  });

  const isFinalizePending = openStaffCompletionMutation.isPending;

  const handleFinalizeDialogChange = (open: boolean) => {
    if (isFinalizePending) {
      return;
    }

    if (open) {
      setIsFinalizeOpen(true);
      return;
    }

    resetFinalizeState();
  };

  const handleStaffCompletionSuccess = () => {
    closeStaffCompletionModal();
    handleFinalizeSuccess();
  };

  const handleStaffCompletionError = (message: string) => {
    toast({
      variant: "destructive",
      title: "최종 확인 실패",
      description: message,
    });
    closeStaffCompletionModal();
  };

  const handleStaffCompletionCancel = () => {
    toast({
      title: "최종 확인 취소",
      description: "최종 확인이 취소되었습니다.",
    });
    closeStaffCompletionModal();
  };

  const startFinalizeFlow = (endDate?: string) => {
    if (isFinalizePending) {
      return;
    }

    const progressId = createFinalizeProgressId();
    finalizeProgressIdRef.current = progressId;
    setFinalizeProgress({ step: "client-started", completed: false, failed: false });

    // Close any prior stream defensively before opening a new one (e.g. retry).
    finalizeEventSourceRef.current?.close();
    const source = new EventSource(
      `/api/eformsign-docs/finalize-headless/progress?progressId=${encodeURIComponent(progressId)}`,
    );
    finalizeEventSourceRef.current = source;
    source.addEventListener("progress", (event) => {
      let data: FinalizeProgressEvent;
      try {
        data = JSON.parse((event as MessageEvent).data) as FinalizeProgressEvent;
      } catch {
        return;
      }
      if (data.step === "failed") {
        const fallbackStep =
          data.failedStep && isFinalizeProgressStepKey(data.failedStep, finalizeProgressSteps)
            ? data.failedStep
            : null;
        setFinalizeProgress((current) => ({
          step: fallbackStep ?? current.step ?? "client-started",
          completed: false,
          failed: true,
        }));
        return;
      }
      if (!isFinalizeProgressStepKey(data.step, finalizeProgressSteps)) return;
      const nextStep = data.step;
      setFinalizeProgress((current) =>
        current.failed
          ? current
          : {
            step: nextStep,
            completed: nextStep === "sent",
            failed: false,
          },
      );
    });

    openStaffCompletionMutation.mutate(endDate);
  };

  const handleFinalizeSubmit = () => {
    startFinalizeFlow(finalizeEndDate);
  };

  const handleServiceRecordReviewConfirm = () => {
    setIsPreviewOpen(false);
    setIsServiceRecordFinalizeConfirmOpen(true);
  };

  const handleServiceRecordFinalizeApprove = () => {
    setIsServiceRecordFinalizeConfirmOpen(false);
    setIsFinalizeOpen(true);
    startFinalizeFlow();
  };

  const activityItems: {
    icon: React.ComponentType<{ className?: string }>;
    iconVariant: "success" | "warning" | "info" | "danger";
    text: React.ReactNode;
    time: string;
  }[] = [
    {
      icon: FileText,
      iconVariant: "info",
      text: "문서가 생성되었습니다",
      time: formatDateTime(detailedDocument.created_date),
    },
    {
      icon: Send,
      iconVariant: "info",
      text: `${customerName}에게 발송되었습니다`,
      time: formatDateTime(detailedDocument.created_date),
    },
  ];

  const inFlightEvents = [
    ...reRequestEvents.map((event) => ({ ...event, type: "rerequest" as const })),
    ...openEvents.map((event) => ({ ...event, type: "open" as const })),
  ].sort((left, right) => left.timestamp - right.timestamp);

  for (const event of inFlightEvents) {
    if (event.type === "rerequest") {
      activityItems.push({
        icon: Send,
        iconVariant: "warning",
        text: `${customerName}에게 재요청을 보냈습니다`,
        time: formatDateTime(event.timestamp),
      });
      continue;
    }

    activityItems.push({
      icon: Eye,
      iconVariant: "info",
      text: `${customerName}님이 문서를 열람했습니다`,
      time: formatDateTime(event.timestamp),
    });
  }

  if (customerSignedTimestamp != null) {
    activityItems.push({
      icon: FileSignature,
      iconVariant: "info",
      text: `${customerName}님이 서명을 완료했습니다`,
      time: formatDateTime(customerSignedTimestamp),
    });
  }

  if (category === "completed") {
    activityItems.push({
      icon: FileSignature,
      iconVariant: "success",
      text: "제공기관 검토 완료",
      time: formatDateTime(detailedDocument.updated_date),
    });
    activityItems.push({
      icon: CheckCircle2,
      iconVariant: "success",
      text: "계약서가 완료되었습니다",
      time: formatDateTime(detailedDocument.updated_date),
    });
  } else if (category === "expired") {
    activityItems.push({
      icon: AlertTriangle,
      iconVariant: "danger",
      text: "문서 기간이 만료되었습니다",
      time: formatDateTime(detailedDocument.updated_date),
    });
  } else {
    const pendingText = isReviewNeeded
      ? "제공기관 검토 필요"
      : hasOpenedDocument
        ? "이용자 서명 대기중입니다"
        : "이용자 문서 열람 대기중입니다";
    activityItems.push({
      icon: isReviewNeeded ? FileSignature : Eye,
      iconVariant: "warning",
      text: pendingText,
      time: "현재",
    });
  }

  const documentTabCards = [
    isServiceRecordDocument ? (
      <ServiceRecordHeaderCard
        data-component="desktop_contracts_detail-panel_service-records_header-card"
        key="document-profile"
        header={serviceRecordHeader}
        isLoading={isCustomerInfoLoading}
        showStatusBadge={false}
      />
    ) : (
      <InfoRowsCard
        key="document-profile"
        title="고객 정보"
        loading={isCustomerInfoLoading}
        className="self-start"
        rows={[
        {
          label: "고객명",
          value: (
            <span className="flex w-full items-center justify-end gap-1.5 text-right">
              <User className="w-3.5 h-3.5 text-v3-text-muted" />
              {customerName}
            </span>
          ),
        },
        { label: "생년월일", value: customerBirthDate },
        {
          label: "주소",
          value: customerAddress ? (
            <span className="flex w-full min-w-0 items-start justify-end gap-1.5 text-right leading-5">
              <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-v3-text-muted" />
              <span className="break-keep whitespace-normal">{customerAddress}</span>
            </span>
          ) : (
            "–"
          ),
        },
        { label: "연락처", value: formatOptionalPhoneNumber(contactInfo.phone) },
        {
          label: "이메일",
          value: contactInfo.email ? (
            <span className="flex w-full items-center justify-end gap-1.5 text-right">
              <Mail className="w-3.5 h-3.5 text-v3-text-muted" />
              {contactInfo.email}
            </span>
          ) : (
            "–"
          ),
        },
        ]}
      />
    ),
    <InfoRowsCard
      key="document-contract"
      title="전자문서 정보"
      loading={isBaseDetailLoading}
      rows={[
        {
          label: "문서명",
          value: isServiceRecordDocument ? "제공기록지" : detailedDocument.document_name,
        },
        { label: "템플릿", value: detailedDocument.template?.name ?? "–" },
        { label: "문서번호", value: detailedDocument.document_number ?? "–" },
        { label: "발송일", value: sentDate },
        { label: "이용자 서명완료일", value: customerSignedDate ?? "–" },
        { label: "제공기관 최종확인일", value: contractCompletedDate ?? "–" },
        ...(contractCompletedDate
          ? [{ label: "서명 완료일", value: contractCompletedDate }]
          : []),
        {
          label: "문서 ID",
          value: (
            <span className="max-w-[calc(224px*var(--glint-ui-scale,1))] break-all font-mono text-[calc(12px*var(--glint-ui-scale,1))]">
              {detailedDocument.id}
            </span>
          ),
        },
      ]}
    />,
  ];

  const providerTabCards = [
    <InfoRowsCard
      key="provider-primary"
      title="제공인력 1"
      loading={isBaseDetailLoading}
      rows={[
        { label: "성명", value: provider1Name },
        { label: "연락처", value: provider1Contact },
      ]}
    />,
    <InfoRowsCard
      key="provider-secondary"
      title="제공인력 2"
      loading={isBaseDetailLoading}
      rows={[
        { label: "성명", value: provider2Name },
        { label: "연락처", value: provider2Contact },
      ]}
    />,
  ];

  const serviceTabCards = [
    <InfoRowsCard
      key="service-schedule"
      title="서비스 정보"
      loading={isServiceInfoLoading}
      rows={[
        { label: "계약 기간", value: contractDuration },
        { label: "서비스 일수", value: serviceDays },
        { label: "계약 시작일", value: contractStartDate },
        { label: "계약 종료일", value: contractEndDate },
        { label: "본인부담금 수령일", value: paymentDate },
        { label: "영수증 발행일", value: receiptDate },
      ]}
    />,
    <InfoRowsCard
      key="service-pricing"
      title="서비스 비용"
      loading={isServiceInfoLoading}
      rows={[
        { label: "서비스 비용", value: servicePrice },
        { label: "정부지원금", value: governmentGrant },
        { label: "본인부담금", value: outOfPocket },
        { label: "바우처 가격표 연도", value: `${voucherPriceYear}년` },
      ]}
    />,
  ];

  const stepperActions = (
    <div data-component="contracts-stepper-actions" className="flex items-start gap-[calc(8px*var(--glint-ui-scale,1))]">
      <button
        type="button"
        data-component="contracts-detail-activity-trigger"
        className="overflow-visible rounded-[18px] p-[calc(4px*var(--glint-ui-scale,1))] transition-colors duration-200 ease-out hover:bg-black/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-v3-primary/20"
        onClick={() => setIsActivityOpen(true)}
        aria-label="계약서 단계 보기"
        title="계약서 단계 보기"
      >
        <Stepper
          steps={steps}
          size={isMobile ? "sm" : "fluid"}
          collapseOnHeaderOverflow
        />
      </button>
      {(canReRequest || onDeleteRequest) && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              data-component="contracts-detail-more-trigger"
              className="mt-[calc(8px*var(--glint-ui-scale,1))] h-[calc(32px*var(--glint-ui-scale,1))] w-[calc(32px*var(--glint-ui-scale,1))] rounded-full border-0 p-0 text-v3-text-muted hover:bg-v3-dim-white hover:text-v3-primary"
              aria-label="계약 작업 더보기"
            >
              <MoreVertical className="h-[calc(20px*var(--glint-ui-scale,1))] w-[calc(20px*var(--glint-ui-scale,1))]" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            data-component="contracts-detail-more-content"
            align="end"
            sideOffset={8}
            className="min-w-[8rem]"
          >
            {canReRequest && (
              <DropdownMenuItem
                data-component="contracts-detail-more-rerequest"
                onSelect={() => handleReRequestDialogChange(true)}
              >
                재요청
              </DropdownMenuItem>
            )}
            {canReRequest && onDeleteRequest && <DropdownMenuSeparator />}
            {onDeleteRequest && (
              <DropdownMenuItem
                data-component="contracts-detail-more-delete"
                variant="destructive"
                onSelect={() => onDeleteRequest(doc.id)}
              >
                삭제
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );

  return (
    <DetailPanel data-component="desktop_contracts_split-layout_detail-panel-5"
      title={isServiceRecordDocument ? "제공기록지" : detailedDocument.document_name}
      badges={<StatusBadge status={statusType} label={statusLabel} />}
      subtitle={
        <span className="flex flex-nowrap items-center gap-[calc(16px*var(--glint-ui-scale,1))] whitespace-nowrap text-[calc(12px*var(--glint-ui-scale,1))]">
          <span className="flex shrink-0 items-center gap-[calc(4px*var(--glint-ui-scale,1))]">
            <Calendar className="h-[calc(14px*var(--glint-ui-scale,1))] w-[calc(14px*var(--glint-ui-scale,1))] shrink-0" />
            발송일: {sentDateLabel}
          </span>
          {contractCompletedDate && (
            <span className="flex shrink-0 items-center gap-[calc(4px*var(--glint-ui-scale,1))]">
              <CheckCircle2 className="h-[calc(14px*var(--glint-ui-scale,1))] w-[calc(14px*var(--glint-ui-scale,1))] shrink-0" />
              서명 완료일: {contractCompletedDateLabel}
            </span>
          )}
          {expiredDate != null && expiredDate > 0 && (
            <span className="flex shrink-0 items-center gap-[calc(4px*var(--glint-ui-scale,1))]">
              <Clock className="h-[calc(14px*var(--glint-ui-scale,1))] w-[calc(14px*var(--glint-ui-scale,1))] shrink-0" />
              만료일: {formatDate(expiredDate)}
            </span>
          )}
        </span>
      }
      trailing={isMobile ? undefined : stepperActions}
      headerAction={
        <>
          {isMobile && stepperActions}
          {isReviewNeeded ? (
            <ContractReviewActionButton
              action={reviewAction}
              onPreview={handleServiceRecordReviewConfirm}
              onFinalize={() => {
                setFinalizeEndDate((current) => current || formatIsoDateInput(contractEndDateIso));
                setIsFinalizeOpen(true);
              }}
            />
          ) : (
            <button
              type="button"
              data-component="contracts-detail-preview-trigger"
              className="flex w-[calc(220px*var(--glint-ui-scale,1))] items-center justify-center gap-[calc(12px*var(--glint-ui-scale,1))] rounded-xl bg-[hsl(var(--v3-primary))] px-[calc(16px*var(--glint-ui-scale,1))] py-[calc(10px*var(--glint-ui-scale,1))] text-center text-[calc(14px*var(--glint-ui-scale,1))] font-medium text-white transition-all duration-200"
              onClick={() => setIsPreviewOpen(true)}
            >
              <Eye className="h-[calc(16px*var(--glint-ui-scale,1))] w-[calc(16px*var(--glint-ui-scale,1))] shrink-0" />
              문서 보기
            </button>
          )}
        </>
      }
      tabs={
        <DetailTabs
          tabs={[...DETAIL_TABS]}
          activeTab={activeDetailTab}
          onTabChange={(key) => setActiveDetailTab(key as DetailTabKey)}
        />
      }
    >
      <DetailTabPanels
        activeTab={activeDetailTab}
        dataComponent="contracts-detail-content"
        panelDataComponent="contracts-detail-tab-panel"
        panels={[
          {
            key: "document",
            className: "grid gap-5 lg:grid-cols-2",
            children: documentTabCards,
          },
          {
            key: "provider",
            className: "grid gap-5 lg:grid-cols-2",
            children: providerTabCards,
          },
          {
            key: "service",
            className: "grid gap-5 lg:grid-cols-2",
            children: serviceTabCards,
          },
        ]}
      />

      <Dialog open={isReRequestDialogOpen} onOpenChange={handleReRequestDialogChange}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>재요청</DialogTitle>
            <DialogDescription>
              {customerName} 님에게 전자문서 작성을 재요청 할까요?
            </DialogDescription>
          </DialogHeader>
          <div data-component="contracts-rerequest-phone-field" className="pb-[calc(8px*var(--glint-ui-scale,1))]">
            <Label
              htmlFor={`contract-rerequest-phone-${doc.id}`}
              className="mb-[calc(8px*var(--glint-ui-scale,1))] block text-[calc(11.52px*var(--glint-ui-scale,1))] font-semibold uppercase tracking-[0.08em] text-v3-text-muted"
            >
              전송 전화번호
            </Label>
            <Input
              id={`contract-rerequest-phone-${doc.id}`}
              type="tel"
              inputMode="numeric"
              variant="v3"
              placeholder="010-1234-5678"
              value={formatPhoneNumber(recipientPhoneDigits)}
              onChange={(event) =>
                setRecipientPhone(normalizePhoneNumber(event.target.value).slice(0, 11))
              }
              maxLength={13}
              className={cn(
                "h-[calc(48px*var(--glint-ui-scale,1))] rounded-[16px] border-[1.5px] border-v3-border bg-white px-[calc(16px*var(--glint-ui-scale,1))] text-[calc(13.6px*var(--glint-ui-scale,1))] text-v3-dark shadow-none transition-all focus-visible:border-v3-primary focus-visible:shadow-[0_0_0_3px_hsla(214,100%,34%,0.08)]",
                hasEditedRecipientPhone &&
                  !isRecipientPhoneValid &&
                  "border-v3-burgundy focus-visible:border-v3-burgundy focus-visible:shadow-[0_0_0_3px_hsla(348,83%,47%,0.08)]"
              )}
            />
            {hasEditedRecipientPhone && !isRecipientPhoneValid && (
              <p className="mt-[calc(8px*var(--glint-ui-scale,1))] text-[calc(12px*var(--glint-ui-scale,1))] font-medium text-v3-burgundy">
                전송할 전화번호를 올바르게 입력해 주세요.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="neutral"
              onClick={() => handleReRequestDialogChange(false)}
              disabled={reRequestMutation.isPending}
            >
              취소
            </Button>
            <Button
              variant="positive"
              onClick={() => reRequestMutation.mutate()}
              disabled={reRequestMutation.isPending || !isRecipientPhoneValid}
            >
              재요청
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <TwoButtonModal
        open={isServiceRecordFinalizeConfirmOpen}
        onOpenChange={setIsServiceRecordFinalizeConfirmOpen}
        dataComponent="contracts-service-record-review-confirm"
        title="완료할까요?"
        description="제공기록지를 검토 완료 처리합니다."
        cancelLabel="취소"
        approvalLabel="완료"
        pendingLabel="처리 중..."
        isPending={isFinalizePending}
        onApprove={handleServiceRecordFinalizeApprove}
      />
      <Dialog open={isFinalizeOpen} onOpenChange={handleFinalizeDialogChange}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>{isServiceRecordDocument ? "제공기록지 검토" : "최종 확인"}</DialogTitle>
            <DialogDescription>
              {isServiceRecordDocument
                ? "제공기록지를 완료 처리하고 있습니다."
                : "서비스 완료일을 수정한 뒤 확정해 주세요."}
            </DialogDescription>
          </DialogHeader>
          {isFinalizePending || finalizeProgress.step !== null ? (
            <div
              data-component="contracts-finalize-progress-section"
              className="flex justify-center py-[calc(8px*var(--glint-ui-scale,1))]"
            >
              <HeadlessProgressStepper
                steps={finalizeProgressSteps}
                progress={finalizeProgress}
                ariaLabel={
                  isServiceRecordDocument
                    ? "제공기록지 검토 진행 상태"
                    : "전자계약서 최종 확인 진행 상태"
                }
                dataComponentPrefix="contracts-finalize-progress"
                testIdPrefix="contracts-finalize-progress"
                className="w-full max-w-[calc(320px*var(--glint-ui-scale,1))]"
              />
            </div>
          ) : (
            <>
              <div data-component="contracts-finalize-end-date-field" className="pb-[calc(8px*var(--glint-ui-scale,1))]">
                <Label
                  htmlFor={`contract-finalize-end-date-${doc.id}`}
                  className="mb-[calc(8px*var(--glint-ui-scale,1))] block text-[calc(11.52px*var(--glint-ui-scale,1))] font-semibold uppercase tracking-[0.08em] text-v3-text-muted"
                >
                  서비스 완료일
                </Label>
                <Input
                  id={`contract-finalize-end-date-${doc.id}`}
                  type="text"
                  inputMode="numeric"
                  variant="v3"
                  placeholder="YYYY-MM-DD"
                  pattern="\d{4}-\d{2}-\d{2}"
                  value={finalizeEndDate}
                  onChange={(event) => setFinalizeEndDate(formatIsoDateInput(event.target.value))}
                />
              </div>
              <DialogFooter className="sm:justify-stretch">
                <Button
                  variant="neutral"
                  size="sm"
                  className="flex-1"
                  onClick={() => handleFinalizeDialogChange(false)}
                >
                  취소
                </Button>
                <Button
                  variant="positive"
                  size="sm"
                  className="flex-1"
                  onClick={handleFinalizeSubmit}
                  disabled={!isFinalizeEndDateValid}
                >
                  완료
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
      <StaffCompletionIframeModal
        open={isStaffCompletionOpen}
        documentOption={staffCompletionOption}
        onOpenChange={(open) => {
          if (!open) {
            closeStaffCompletionModal();
          }
        }}
        onSuccess={handleStaffCompletionSuccess}
        onError={handleStaffCompletionError}
        onCancel={handleStaffCompletionCancel}
      />
      <Dialog open={isActivityOpen} onOpenChange={setIsActivityOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>계약서 단계</DialogTitle>
          </DialogHeader>
          <div data-component="contracts-activity-modal-body">
            <div data-component="contracts-activity-modal-timeline">
              <ActivityTimeline items={activityItems} maxHeight="360px" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="positive" onClick={() => setIsActivityOpen(false)}>
              닫기
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ContractDocumentPreviewModal
        open={isPreviewOpen}
        onClose={() => {
          if (!isFinalizePending) {
            setIsPreviewOpen(false);
          }
        }}
        document={detailedDocument}
        customerName={customerName}
        canDownloadReceipt={category === "completed" && reviewAction !== "preview"}
        onReviewConfirm={
          reviewAction === "preview" && isReviewNeeded
            ? handleServiceRecordReviewConfirm
            : undefined
        }
        isReviewConfirming={isFinalizePending}
      />
    </DetailPanel>
  );
}
