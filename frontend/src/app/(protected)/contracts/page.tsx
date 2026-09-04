"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { EformsignDocClientSummary } from "@babyjamjam/shared/types/eformsign";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
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
  Workflow,
} from "lucide-react";
import {
  useContractClientCandidate,
  useDeleteEformsignDocument,
} from "@/hooks/useEformsignDocuments";
import { useEformsignAuth } from "@/hooks/useEformsignAuth";
import { useEformsignDocsLiveStream } from "@/hooks/useEformsignDocsLiveStream";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useInfiniteContracts, type ContractsSectionParam } from "@/hooks/useInfiniteContracts";
import { ServiceRecordHeaderCard } from "@/features/service-records/components/ServiceRecordHeaderCard";
import { useClientServiceRecords } from "@/features/service-records/hooks/use-service-records";
import type { EformsignDocument, EformsignDocumentOption } from "@/lib/eformsign/types";
import { useDebounce } from "use-debounce";
import {
  DocumentFilterType,
  contractStatusBadgeType,
  mapDocStatusLabel,
  getStatusCategory,
  foldContractStats,
} from "@/lib/eformsign/status-codes";
import {
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
import { ContractStatsBar } from "@/components/app/contracts/ContractStatsBar";
import { ContractAutomationsManager } from "@/components/app/contracts/ContractAutomationsManager";
import type { StatusType } from "@/components/app/v3";
import { TwoButtonModal } from "@/components/app/ui/TwoButtonModal";
import { ClientFormDialog } from "@/components/app/clients/ClientFormDialog";
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
import { eformsignApi, withEformsignReauth } from "@/services/api";
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
import { resolveDocumentCustomerName } from "@/lib/eformsign/display-name";
import { formatIsoDateInput } from "@/lib/date/format-iso-input";
import { useAllVoucherPriceInfos } from "@/hooks/useVoucherData";
import { inferVoucherDurationFromAmounts } from "@/lib/voucher/duration";
import { contractCandidateToClientPrefill } from "@/lib/client/contract-client-prefill";
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
import {
  useEformsignDocumentJobs,
  useEnqueueEformsignDocumentFinalization,
} from "@/hooks/useEformsignDocumentJobs";

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

/**
 * Every headless-finalize refusal used to surface as the generic message below,
 * so an operator could not tell "already handled, waiting for the status to
 * catch up" apart from a real failure and kept re-clicking. These are the
 * reasons the backend returns with fallbackHint "manual_check"
 * (finalize-document-headless.usecase.ts); anything else — including sanitized
 * vendor text, which is internal English — falls back to the generic message.
 */
const FINALIZE_MANUAL_CHECK_MESSAGES: Record<string, string> = {
  dispatch_already_accepted:
    "이 단계는 이미 처리를 접수했어요. 문서 상태가 갱신되면 다음 단계를 진행할 수 있어요.",
  dispatch_uncertain_manual_reconciliation_required:
    "직전 요청의 처리 결과를 확인하지 못했어요. eformsign에서 문서 상태를 확인한 뒤 다시 시도해 주세요.",
  operation_in_progress: "이 문서를 처리하는 중이에요. 잠시 후 다시 시도해 주세요.",
  operation_lock_unavailable: "처리 순서를 확보하지 못했어요. 잠시 후 다시 시도해 주세요.",
  operation_lock_lost: "처리 순서를 확보하지 못했어요. 잠시 후 다시 시도해 주세요.",
  authorization_denied:
    "이 문서를 완료 처리할 수 없어요. 고객 등록과 제공인력 배정이 저장되었는지 확인해 주세요.",
  eformsign_terminal_failure:
    "eformsign에서 문서가 종료 상태로 처리됐어요. 문서 상태를 확인해 주세요.",
  // Raised by finalizeHeadless itself once its provider-step loop is exhausted.
  provider_workflow_incomplete:
    "제공기관 단계가 아직 남아 있어요. 목록을 새로고침한 뒤 다시 시도해 주세요.",
};

const FINALIZE_MANUAL_CHECK_FALLBACK_MESSAGE =
  "완료 처리 결과를 확인하지 못했어요. eformsign에서 문서 상태를 확인한 뒤 다시 시도해 주세요.";

type InfoCardRow = {
  label: string;
  value: React.ReactNode;
};

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

function getSignatureProgress(
  category: "completed" | "expired" | "in-progress",
  hasOpenedDocument: boolean,
  isCustomerSigned: boolean
) {
  const isCompleted = category === "completed";
  const isSigned = isCompleted || isCustomerSigned;
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
  return formatDateForDisplay(
    `${normalizedYear}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`,
    "",
  ) || null;
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
    const looksLikeDate = /\d{4}/.test(trimmed) && /[-./]/.test(trimmed);
    return looksLikeDate ? formatDateForDisplay(trimmed, trimmed) : trimmed;
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
  const rangeValue =
    values.find((value) => value.includes("~")) ??
    values.find((value) => /\s-\s/.test(value));
  if (!rangeValue) {
    return null;
  }

  const dateParts = rangeValue.includes("~")
    ? rangeValue.split(/\s*~\s*/)
    : rangeValue.split(/\s+-\s+/);
  if (dateParts.length !== 2) {
    return rangeValue;
  }

  const [startDate, endDate] = dateParts;
  const formattedStartDate = formatSingleFieldDate(startDate) ?? startDate;
  const formattedEndDate = formatSingleFieldDate(endDate) ?? endDate;
  return `${formattedStartDate} ~ ${formattedEndDate}`;
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
  "data-component": dataComponent,
  title,
  rows,
  loading = false,
  className,
}: {
  "data-component": string;
  title: string;
  rows: InfoCardRow[];
  loading?: boolean;
  className?: string;
}) {
  return (
    <InfoCard data-component={dataComponent} title={title} className={className}>
      {rows.map((row, index) => (
        <InfoRow
          key={row.label}
          label={row.label}
          value={loading ? (
            <div
              data-component={`${dataComponent}_row-${index + 1}_skeleton`}
              className="flex w-full justify-end"
            >
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
  { id: "automations", label: "자동화", icon: Workflow },
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
  const [registerClientDocumentId, setRegisterClientDocumentId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [serviceRecordActiveTab, setServiceRecordActiveTab] = useState("all");
  const [serviceRecordSearchQuery, setServiceRecordSearchQuery] = useState("");
  const [selectedServiceRecordDocId, setSelectedServiceRecordDocId] = useState<string | null>(null);
  const [isDocumentJobsPopoverOpen, setIsDocumentJobsPopoverOpen] = useState(false);
  const documentJobsEnabled = isFeatureEnabled("eformsignDocumentJobs");

  const { isAuthenticated, isLoading: isLoadingAuth, error: authError } = useEformsignAuth({
    requireAccessToken: false,
    syncOnWindowFocus: false,
  });
  useEformsignDocsLiveStream(isAuthenticated);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const documentJobsQuery = useEformsignDocumentJobs({
    isAuthenticated: isAuthenticated && documentJobsEnabled,
    isPopoverOpen: isDocumentJobsPopoverOpen,
  });
  const deleteDocument = useDeleteEformsignDocument();
  const registerCandidateQuery = useContractClientCandidate(registerClientDocumentId);
  const registerClientPrefill = useMemo(
    () => (registerCandidateQuery.data
      ? contractCandidateToClientPrefill(registerCandidateQuery.data)
      : undefined),
    [registerCandidateQuery.data],
  );
  const registerClientOpen =
    registerClientDocumentId !== null
    && (registerCandidateQuery.isSuccess || registerCandidateQuery.isError);
  useEffect(() => {
    if (registerClientDocumentId !== null && registerCandidateQuery.isError) {
      toast({
        variant: "destructive",
        title: "계약 정보를 불러오지 못했어요",
        description: "고객 정보를 직접 입력해 주세요",
      });
    }
  }, [registerCandidateQuery.isError, registerClientDocumentId, toast]);
  const { data: documentClientSummaries = [], isPending: isClientSummariesPending } = useQuery({
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
      return resolveDocumentCustomerName(doc, mappedName);
    },
    [documentClientSummaryById],
  );
  const activeListTab = activeSection === "service-records" ? serviceRecordActiveTab : activeTab;
  const filterType: DocumentFilterType = activeListTab === "all" ? null : (activeListTab as DocumentFilterType);
  // Search is applied server-side (chosung-aware), so each keystroke would be a
  // request — debounce to one request per pause, matching mobile's
  // useDebouncedValue(searchQuery.trim(), 300). Each surface debounces its own
  // term so a section switch immediately uses that section's settled term.
  const [debouncedSearchQuery] = useDebounce(searchQuery.trim(), 300);
  const [debouncedServiceRecordSearchQuery] = useDebounce(serviceRecordSearchQuery.trim(), 300);
  const activeSearchQuery =
    activeSection === "service-records" ? debouncedServiceRecordSearchQuery : debouncedSearchQuery;
  // 템플릿 필터는 section 파라미터로 서버가 결정한다(산모 계약서 = 등록된 계약서
  // 템플릿 화이트리스트, 제공기록지 = 설정된 티어 템플릿). 클라이언트는 어느 섹션의
  // 목록인지만 알려준다 — frontend와 mobile이 같은 필터를 보장받는 단일 결정 지점.
  const contractsSection: ContractsSectionParam | undefined =
    activeSection === "maternity" || activeSection === "service-records"
      ? activeSection
      : undefined;
  const canFetchDocuments = isAuthenticated;

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
    section: contractsSection,
    search: activeSearchQuery,
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
  const isInitialLoading = isBootstrappingAuth || isLoadingInfinite;
  // Content loading: fetching filtered data after initial load is complete
  const isContentLoading = !isInitialLoading && isLoadingInfinite;
  // Stats are derived from the "전체" tab's data and are independent of which
  // tab is currently being fetched — only show the skeleton until the very
  // first stats payload lands.
  const isStatsLoading = isBootstrappingAuth || isCountsLoading;
  const isServiceRecordListLoading = isInitialLoading;

  // Search happens server-side (it is part of the query key), so what the
  // server returns is what renders — total_rows/hasNextPage describe the
  // searched set and pagination stops when the matches run out.
  const documents = infiniteDocuments;

  const serviceRecordDocuments = useMemo(
    () => infiniteDocuments.filter(
      (doc) => matchesDocumentStatusTab(doc, serviceRecordActiveTab),
    ),
    [infiniteDocuments, serviceRecordActiveTab],
  );

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

  // Deep link used by notifications and the dashboard 검토 필요 card
  // (/contracts?documentId=…): select the document and clear the param.
  // Selection survives the replace — selectedDocument resolves reactively once
  // the list page containing the document loads.
  useEffect(() => {
    const documentIdParam = searchParams.get("documentId");
    if (!documentIdParam) return;

    setActiveSection("maternity");
    setSelectedDocId(documentIdParam);
    router.replace("/contracts", { scroll: false });
  }, [router, searchParams]);

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

      setRegisterClientDocumentId(null);
      setDeleteTargetDocumentId(null);
      toast({
        variant: "success",
        title: "문서를 삭제했어요",
        description: "선택한 문서를 목록에서 지웠어요",
      });
    } catch (deleteError) {
      console.error("Failed to delete contract document:", deleteError);
      toast({
        title: "문서를 삭제하지 못했어요",
        description:
          deleteError instanceof Error
            ? deleteError.message
            : "잠시 후 다시 시도해 주세요",
        variant: "destructive",
      });
    }
  };

  if (authError || error) {
    return (
      <div data-component="desktop_contracts_error" className="p-[calc(24px*var(--glint-ui-scale,1))]">
        <div data-component="desktop_contracts_error_banner" className="rounded-[18px] bg-v3-burgundy-light p-[calc(24px*var(--glint-ui-scale,1))] text-center text-v3-burgundy">
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
      <ContractStatsBar
        name="contracts"
        showDocumentJobs={documentJobsEnabled}
        isLoading={isStatsLoading}
        items={[
          { icon: CheckCircle2, value: stats.reviewNeeded, label: "검토 필요", counter: "건", colorIndex: 0 },
          { icon: FileSignature, value: stats.signed, label: "서명 완료", counter: "건", colorIndex: 1 },
          { icon: Send, value: stats.sendRequired, label: "이용자 완료 필요", counter: "건", colorIndex: 1 },
          { icon: FileText, value: stats.drafting, label: "작성 대기중", counter: "건" },
          { icon: AlertTriangle, value: stats.expired, label: "기간 만료", counter: "건", colorIndex: 3 },
        ]}
        summary={documentJobsEnabled ? documentJobsQuery.summary : null}
        documentJobs={documentJobsEnabled ? (documentJobsQuery.data ?? null) : null}
        isJobsLoading={documentJobsEnabled && (
          documentJobsQuery.summaryQuery.isLoading || documentJobsQuery.isLoading
        )}
        jobsError={documentJobsEnabled ? documentJobsQuery.error : null}
        onRetryJobs={documentJobsEnabled ? () => void documentJobsQuery.refetch() : undefined}
        onJobsPopoverOpenChange={setIsDocumentJobsPopoverOpen}
      />

      <div
        data-component="desktop_contracts_sections"
        data-slot="contracts-sections"
        className="flex flex-1 min-h-0 flex-col gap-[calc(16px*var(--glint-ui-scale,1))] lg:flex-row"
      >
        <SectionNav
          data-component="desktop_contracts_sections_section-nav"
          items={NAV_SECTIONS}
          activeId={activeSection}
          onSelect={(id) => {
            setRegisterClientDocumentId(null);
            setActiveSection(id as SectionId);
          }}
        />

        <div
          data-component="desktop_contracts_sections_section-content"
          className="flex-1 min-w-0 min-h-0 flex flex-col"
        >
          {activeSection === "maternity" ? (
            <section
              data-component="desktop_contracts_sections_section-content_maternity-section"
              className="flex flex-1 min-h-0 flex-col"
            >
        <SplitLayout data-component="desktop_contracts_sections_section-content_maternity-section_split-layout"
          hasSelection={!!selectedDocument || isCreating || hasContractCreationSession}
          onBack={() => {
            setSelectedDocId(null);
            setIsCreating(false);
          }}
        >
          <ListPanel data-component="desktop_contracts_sections_section-content_maternity-section_split-layout_list-panel"
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
                data-component="desktop_contracts_sections_section-content_maternity-section_split-layout_list-panel_header_send-contract"
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
                data-component="desktop_contracts_sections_section-content_maternity-section_split-layout_list-panel_list"
                items={documents}
                isLoading={isInitialLoading || isContentLoading}
                loadingCount={3}
                className="space-y-2"
                getItemKey={(doc) => doc.id}
                itemVariant="card"
                itemDataComponent="desktop_contracts_sections_section-content_maternity-section_split-layout_list-panel_list_item"
                getSlotState={({ item, isLoading }) => {
                  const isActive = !isLoading && item && selectedDocument?.id === item.id;
                  return {
                    isActive: Boolean(isActive),
                    isInteractive: !isLoading && Boolean(item),
                  };
                }}
                onSlotClick={(doc) => {
                  setIsCreating(false);
                  setRegisterClientDocumentId(null);
                  setSelectedDocId(doc.id);
                }}
                // Load more props
                hasMore={hasNextPage}
                onLoadMore={() => fetchNextPage()}
                isFetchingMore={isFetchingNextPage}
                render={({ item: doc, isLoading }) => {
                  const customerName = resolveCustomerName(doc);

                  return (
                    <ContractsListItem
                      data-component="desktop_contracts_sections_section-content_maternity-section_split-layout_list-panel_item"
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
              data-component="desktop_contracts_sections_section-content_maternity-section_split-layout_creation-session"
              className={isCreating ? "contents" : "hidden"}
            >
                <ContractCreationForm
                  onClose={handleCloseContractCreation}
                  onSessionStateChange={handleContractCreationSessionChange}
                  activeStep={contractCreationActiveStep}
                  onActiveStepChange={setContractCreationActiveStep}
                  renderLayout={({ content, footer, footerClassName }) => (
                    <DetailPanel data-component="desktop_contracts_sections_section-content_maternity-section_split-layout_creation-session_detail-panel"
                      title="전자계약서 작성"
                      subtitle="고객에게 전자계약서를 발송합니다"
                      avatar={
                        <div
                          data-component="desktop_contracts_sections_section-content_maternity-section_split-layout_creation-session_detail-panel_avatar"
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
              name="desktop_contracts_sections_section-content_maternity-section_split-layout_detail-skeleton"
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
              data-component="desktop_contracts_sections_section-content_maternity-section_split-layout_detail-panel-document"
              key={selectedDocument.id}
              document={selectedDocument}
              documentClientSummary={documentClientSummaryById.get(selectedDocument.id) ?? null}
              onDeleteRequest={handleDeleteRequest}
              onRegisterClient={isClientSummariesPending ? undefined : setRegisterClientDocumentId}
            />
          ) : !isCreating && !hasContractCreationSession ? (
            <EmptyState icon={FileText} message="계약을 선택하면 상세 정보가 표시됩니다" />
          ) : null}
        </SplitLayout>
            </section>
          ) : null}

          {activeSection === "service-records" ? (
            <section
              data-component="desktop_contracts_sections_section-content_service-records-section"
              className="flex flex-1 min-h-0 flex-col"
            >
              <SplitLayout data-component="desktop_contracts_sections_section-content_service-records-section_split-layout"
                hasSelection={!!selectedServiceRecordDocument}
                onBack={() => setSelectedServiceRecordDocId(null)}
              >
                <ListPanel data-component="desktop_contracts_sections_section-content_service-records-section_split-layout_list-panel"
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
                    data-component="desktop_contracts_sections_section-content_service-records-section_split-layout_list-panel_list"
                    items={serviceRecordDocuments}
                    isLoading={isServiceRecordListLoading || isContentLoading}
                    loadingCount={3}
                    className="space-y-2"
                    getItemKey={(doc) => doc.id}
                    itemVariant="card"
                    itemDataComponent="desktop_contracts_sections_section-content_service-records-section_split-layout_list-panel_list_item"
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
                        data-component="desktop_contracts_sections_section-content_service-records-section_split-layout_list-panel_item"
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
                    name="desktop_contracts_sections_section-content_service-records-section_split-layout_detail-skeleton"
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
                    data-component="desktop_contracts_sections_section-content_service-records-section_split-layout_detail-panel-document"
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
            <section
              data-component="desktop_contracts_sections_section-content_caregiver-section"
              className="flex flex-1 min-h-0 flex-col"
            >
              <SplitLayout data-component="desktop_contracts_sections_section-content_caregiver-section_split-layout" hasSelection={false}>
                <ListPanel data-component="desktop_contracts_sections_section-content_caregiver-section_split-layout_list-panel"
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
                <DetailPanel data-component="desktop_contracts_sections_section-content_caregiver-section_split-layout_detail-panel"
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
            <section
              data-component="desktop_contracts_sections_section-content_documents-section"
              className="flex flex-1 min-h-0 flex-col"
            >
              <SplitLayout data-component="desktop_contracts_sections_section-content_documents-section_split-layout" hasSelection={false}>
                <ListPanel data-component="desktop_contracts_sections_section-content_documents-section_split-layout_list-panel"
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
                <DetailPanel data-component="desktop_contracts_sections_section-content_documents-section_split-layout_detail-panel"
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
            <section
              data-component="desktop_contracts_sections_section-content_notifications-section"
              className="flex flex-1 min-h-0 flex-col"
            >
              <SplitLayout data-component="desktop_contracts_sections_section-content_notifications-section_split-layout" hasSelection={false}>
                <ListPanel data-component="desktop_contracts_sections_section-content_notifications-section_split-layout_list-panel"
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
                <DetailPanel data-component="desktop_contracts_sections_section-content_notifications-section_split-layout_detail-panel"
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

          {activeSection === "automations" ? (
            <ContractAutomationsManager dataComponent="desktop_contracts_sections_section-content_automations-section" />
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
        data-component="desktop_contracts_modals_delete-approval"
        title="문서를 삭제하시겠습니까?"
        description="전자문서가 취소되어 수신자가 더 이상 서명할 수 없습니다. 복구할 수 없습니다."
        approvalLabel="삭제"
        pendingLabel="삭제 중..."
        approvalVariant="destructive"
        isPending={deleteDocument.isPending}
        onApprove={() => void handleDeleteConfirm()}
      />

      {registerClientDocumentId !== null && (
        <ClientFormDialog
          data-component="desktop_contracts_modals_register-client"
          open={registerClientOpen}
          onClose={() => setRegisterClientDocumentId(null)}
          prefill={registerClientPrefill}
          notice={registerCandidateQuery.isError
            ? "계약서에서 정보를 불러오지 못했습니다. 계약서의 전화번호와 동일하게 입력해야 자동 연결됩니다."
            : "전화번호를 변경하면 이 계약서와 자동 연결되지 않을 수 있습니다."}
          onSuccess={() => {
            setRegisterClientDocumentId(null);
            void queryClient.invalidateQueries({ queryKey: ["eformsign-client-names"] });
            void queryClient.invalidateQueries({ queryKey: ["eformsign-documents"] });
          }}
        />
      )}
    </PageSection>
  );
}

function ContractDetail({
  "data-component": dataComponent,
  document: doc,
  documentClientSummary,
  onDeleteRequest,
  onRegisterClient,
  reviewAction = "finalize",
}: {
  "data-component": string;
  document: EformsignDocument;
  documentClientSummary?: EformsignDocClientSummary | null;
  onDeleteRequest?: (documentId: string) => void;
  onRegisterClient?: (documentId: string) => void;
  reviewAction?: ContractReviewAction;
}) {
  const isMobile = useIsMobile();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const documentJobsEnabled = isFeatureEnabled("eformsignDocumentJobs");
  const enqueueFinalizationMutation = useEnqueueEformsignDocumentFinalization();
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
  const customerName = resolveDocumentCustomerName(detailedDocument, mappedCustomerName) || "–";
  const isServiceRecordDocument = reviewAction === "preview";
  const serviceRecordQuery = useClientServiceRecords(documentClientSummary?.clientId ?? null, {
    enabled: isServiceRecordDocument,
  });
  const serviceRecordHeader = serviceRecordQuery.data?.record?.header
    ?? serviceRecordQuery.data?.assignments.find((assignment) => assignment.header)?.header
    ?? null;
  const category = getStatusCategory(detailedDocument.current_status?.status_type);
  const contractEndDateIso = formatIsoDateInput(
    extractFieldDate(detailedDocument, {
      year: ["계약 종료 년도", "계약종료년도", "endYear"],
      month: ["계약 종료 월", "계약종료월", "endMonth"],
      day: ["계약 종료 일", "계약종료일", "endDay"],
      full: ["계약 종료일", "계약종료일", "endDate", "contractEndDate"],
    }) ?? "",
  );
  const statusLabel = mapDocStatusLabel(detailedDocument.current_status, contractEndDateIso || null);
  const statusType: StatusType = contractStatusBadgeType(statusLabel);
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
  const provider1Names =
    extractDocumentFieldValues(detailedDocument, [
      "제공인력 1 성명",
      "제공인력1성명",
      "제공인력 성명",
      "제공인력성명",
    ]);
  const provider1Contact = extractDocumentFieldValue(detailedDocument, [
    "제공인력 1 연락처",
    "제공인력1연락처",
    "제공인력 연락처",
    "제공인력연락처",
  ]);
  const provider2Names =
    extractDocumentFieldValues(detailedDocument, [
      "제공인력 2 성명",
      "제공인력2성명",
      "추가 제공인력 성명",
      "추가제공인력성명",
    ]);
  const provider2Contact = extractDocumentFieldValue(detailedDocument, [
    "제공인력 2 연락처",
    "제공인력2연락처",
    "추가 제공인력 연락처",
    "추가제공인력연락처",
  ]);
  const provider1Name = provider1Names.join(", ");
  const provider2Name = provider2Names.join(", ");
  const providers = [
    {
      name: provider1Name,
      contact: provider1Contact,
    },
    {
      name: provider2Name,
      contact: provider2Contact,
    },
  ].filter((provider) => provider.name || provider.contact);
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
  const isReviewNeeded = statusLabel === "검토 필요";
  const isCustomerSigned = statusLabel === "서명 완료" || isReviewNeeded;
  const steps = getSignatureProgress(category, hasOpenedDocument, isCustomerSigned);
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
      variant: "success",
      title: "최종 확인을 마쳤어요",
      description: `${reviewDocumentLabel}를 완료 처리했어요`,
    });
    resetFinalizeState();
    queryClient.invalidateQueries({ queryKey: ["eformsign-documents"] });
  };

  const reRequestMutation = useMutation({
    mutationFn: async () => {
      return withEformsignReauth(() =>
        eformsignApi.reRequestDocument(doc.id, {
          stepType: reRequestStepType,
          stepSeq: reRequestStepSeq,
          comment: "재요청입니다.",
          recipientPhone: hasEditedRecipientPhone
            ? {
                countryCode: "+82",
                phoneNumber: recipientPhoneDigits,
              }
            : undefined,
        }),
      );
    },
    onSuccess: () => {
      handleReRequestDialogChange(false);
      queryClient.invalidateQueries({ queryKey: ["eformsign-documents"] });
      toast({
        variant: "success",
        description: `${customerName}님에게 전자문서 작성을 재요청했어요`,
      });
    },
    onError: (error) => {
      toast({
        variant: "destructive",
        description: error instanceof Error ? error.message : "재요청하지 못했어요",
      });
    },
  });

  const openStaffCompletionMutation = useMutation({
    mutationFn: async (endDate?: string): Promise<
      | { kind: "queued" }
      | { kind: "headless" }
      | { kind: "iframe"; option: EformsignDocumentOption }
    > => {
      if (documentJobsEnabled) {
        await enqueueFinalizationMutation.mutateAsync({
          requestKey: createFinalizeProgressId(),
          documentId: doc.id,
          prefillEndDate: endDate,
        });
        return { kind: "queued" };
      }

      // BJJ-90: try the backend-driven finalize first when the flag is on.
      if (isFeatureEnabled("headlessDispatch")) {
        // Raised inside the try but acted on outside it: the catch below exists
        // to turn transport failures into an iframe retry, and it would swallow
        // this signal just as readily.
        let manualCheckRequired = false;
        let manualCheckReason: string | undefined;
        let transportOutcomeUnknown = false;
        try {
          const progressId = finalizeProgressIdRef.current ?? undefined;
          const headless = await eformsignApi.finalizeHeadless(doc.id, endDate, progressId);
          if (headless.ok) {
            return { kind: "headless" };
          }
          manualCheckRequired = headless.fallbackHint === "manual_check";
          manualCheckReason = headless.reason;
          console.warn(
            "[finalize] headless finalize ok=false",
            headless.reason,
            headless.fallbackHint,
          );
        } catch (headlessError) {
          transportOutcomeUnknown = true;
          console.warn("[finalize] headless finalize verdict is unknown", headlessError);
        }
        // The backend asks for the iframe only once it has confirmed with
        // eformsign that the step is still unfinished. When it could not
        // confirm, reopening the editor would invite re-approval of a step that
        // may already be done.
        if (manualCheckRequired || transportOutcomeUnknown) {
          // A transport failure carries no reason, so it keeps the generic text.
          throw new Error(
            (manualCheckReason
              ? FINALIZE_MANUAL_CHECK_MESSAGES[manualCheckReason]
              : undefined) ?? FINALIZE_MANUAL_CHECK_FALLBACK_MESSAGE,
          );
        }
      }

      // Provider authentication runs only inside the server boundary.
      // Client callers never receive or submit eformsign credentials.
      // The server selects configured provider identity and capabilities.
      // Keep this fallback limited to the server-mediated option request.
      // (No client-side token acquisition.)
      const option = await eformsignApi.generateStaffDocument(doc.id, endDate);
      return { kind: "iframe", option };
    },
    onSuccess: (result) => {
      closeFinalizeProgressStream();
      setFinalizeProgress(INITIAL_FINALIZE_PROGRESS);
      if (result.kind === "queued") {
        setIsPreviewOpen(false);
        setIsFinalizeOpen(false);
        setIsServiceRecordFinalizeConfirmOpen(false);
        setFinalizeEndDate("");
        toast({ description: "전자문서 작업을 시작했어요" });
        return;
      }
      if (result.kind === "headless") {
        setIsPreviewOpen(false);
        setIsFinalizeOpen(false);
        setFinalizeEndDate("");
        toast({
          variant: "success",
          title: "최종 확인을 마쳤어요",
          description: `${reviewDocumentLabel}를 완료 처리했어요`,
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
        title: "최종 확인을 마치지 못했어요",
        description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요",
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
      title: "최종 확인을 마치지 못했어요",
      description: message,
    });
    closeStaffCompletionModal();
  };

  const handleStaffCompletionCancel = () => {
    toast({
      title: "최종 확인을 취소했어요",
      description: "필요하면 다시 최종 확인을 진행할 수 있어요",
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
    if (documentJobsEnabled) {
      if (!isFinalizeEndDateValid) return;
      openStaffCompletionMutation.mutate(finalizeEndDate);
      return;
    }
    startFinalizeFlow(finalizeEndDate);
  };

  const handleServiceRecordReviewConfirm = () => {
    setIsPreviewOpen(false);
    setIsServiceRecordFinalizeConfirmOpen(true);
  };

  const handleServiceRecordFinalizeApprove = () => {
    setIsServiceRecordFinalizeConfirmOpen(false);
    if (documentJobsEnabled) {
      openStaffCompletionMutation.mutate(undefined);
      return;
    }
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
      : isCustomerSigned
        ? "이용자 서명 완료 — 계약 종료 1영업일 전부터 검토할 수 있습니다"
        : hasOpenedDocument
          ? "이용자 서명 대기중입니다"
          : "이용자 문서 열람 대기중입니다";
    activityItems.push({
      icon: isCustomerSigned ? FileSignature : Eye,
      iconVariant: "warning",
      text: pendingText,
      time: "현재",
    });
  }

  const documentTabCards = [
    isServiceRecordDocument ? (
      <ServiceRecordHeaderCard
        data-component={`${dataComponent}_content_document_header-card`}
        key="document-profile"
        header={serviceRecordHeader}
        isLoading={isCustomerInfoLoading}
        showStatusBadge={false}
      />
    ) : (
      <InfoRowsCard
        data-component={`${dataComponent}_content_document_client-card`}
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
      data-component={`${dataComponent}_content_document_contract-card`}
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

  const presentProviderCards = [
    provider1Name || provider1Contact ? (
    <InfoRowsCard
      data-component={`${dataComponent}_content_provider_primary-card`}
      key="provider-primary"
      title={providers.length === 1 ? "제공인력" : "제공인력 1"}
      loading={isBaseDetailLoading}
      rows={[
        { label: "성명", value: provider1Name || "–" },
        { label: "연락처", value: formatOptionalPhoneNumber(provider1Contact) },
      ]}
    />
    ) : null,
    provider2Name || provider2Contact ? (
    <InfoRowsCard
      data-component={`${dataComponent}_content_provider_secondary-card`}
      key="provider-secondary"
      title={providers.length === 1 ? "제공인력" : "제공인력 2"}
      loading={isBaseDetailLoading}
      rows={[
        { label: "성명", value: provider2Name || "–" },
        { label: "연락처", value: formatOptionalPhoneNumber(provider2Contact) },
      ]}
    />
    ) : null,
  ].filter(Boolean);

  const providerTabCards =
    presentProviderCards.length > 0
      ? presentProviderCards
      : [
          <InfoRowsCard
            data-component={`${dataComponent}_content_provider_primary-card`}
            key="provider-empty"
            title="제공인력"
            loading={isBaseDetailLoading}
            rows={[
              { label: "성명", value: "–" },
              { label: "연락처", value: "–" },
            ]}
          />,
        ];

  const serviceTabCards = [
    <InfoRowsCard
      data-component={`${dataComponent}_content_service_schedule-card`}
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
      data-component={`${dataComponent}_content_service_pricing-card`}
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

  const canRegisterClient = Boolean(onRegisterClient && !documentClientSummary?.clientId);

  const stepperActions = (
    <div
      data-component={`${dataComponent}_header_stepper-actions`}
      className="flex items-start gap-[calc(8px*var(--glint-ui-scale,1))]"
    >
      <button
        type="button"
        data-component={`${dataComponent}_header_stepper-actions_activity-trigger`}
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
      {(canReRequest || onDeleteRequest || canRegisterClient) && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              data-component={`${dataComponent}_header_stepper-actions_more-menu_trigger`}
              className="mt-[calc(8px*var(--glint-ui-scale,1))] h-[calc(32px*var(--glint-ui-scale,1))] w-[calc(32px*var(--glint-ui-scale,1))] rounded-full border-0 p-0 text-v3-text-muted hover:bg-v3-dim-white hover:text-v3-primary"
              aria-label="계약 작업 더보기"
            >
              <MoreVertical className="h-[calc(20px*var(--glint-ui-scale,1))] w-[calc(20px*var(--glint-ui-scale,1))]" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            data-component={`${dataComponent}_header_stepper-actions_more-menu_content`}
            align="end"
            sideOffset={8}
            className="min-w-[8rem]"
          >
            {canRegisterClient && (
              <DropdownMenuItem
                data-component={`${dataComponent}_header_stepper-actions_more-menu_content_register-client`}
                onSelect={() => onRegisterClient?.(doc.id)}
              >
                고객 등록
              </DropdownMenuItem>
            )}
            {canRegisterClient && (canReRequest || onDeleteRequest) && <DropdownMenuSeparator />}
            {canReRequest && (
              <DropdownMenuItem
                data-component={`${dataComponent}_header_stepper-actions_more-menu_content_rerequest`}
                onSelect={() => handleReRequestDialogChange(true)}
              >
                재요청
              </DropdownMenuItem>
            )}
            {canReRequest && onDeleteRequest && <DropdownMenuSeparator />}
            {onDeleteRequest && (
              <DropdownMenuItem
                data-component={`${dataComponent}_header_stepper-actions_more-menu_content_delete`}
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
    <DetailPanel data-component={dataComponent}
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
            <div
              className={
                reviewAction === "finalize"
                  ? "grid grid-cols-1 gap-[calc(12px*var(--glint-ui-scale,1))] sm:grid-cols-2 [&>button]:!w-full"
                  : undefined
              }
            >
              {reviewAction === "finalize" && (
                <Button
                  variant="positive-outline"
                  size="sm"
                  data-component={`${dataComponent}_header_preview-trigger`}
                  className="w-full"
                  onClick={() => setIsPreviewOpen(true)}
                >
                  <Eye className="h-4 w-4" />
                  문서 보기
                </Button>
              )}
              <ContractReviewActionButton
                data-component={`${dataComponent}_header_review-trigger`}
                action={reviewAction}
                onPreview={handleServiceRecordReviewConfirm}
                onFinalize={() => {
                  setFinalizeEndDate((current) => current || formatIsoDateInput(contractEndDateIso));
                  setIsFinalizeOpen(true);
                }}
              />
            </div>
          ) : (
            <Button
              variant="positive"
              size="sm"
              data-component={`${dataComponent}_header_preview-trigger`}
              className="w-[calc(220px*var(--glint-ui-scale,1))]"
              onClick={() => setIsPreviewOpen(true)}
            >
              <Eye className="h-4 w-4" />
              문서 보기
            </Button>
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
        data-component={`${dataComponent}_content`}
        data-panel-component={`${dataComponent}_content_panel`}
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
          <div
            data-component={`${dataComponent}_dialogs_rerequest_phone-field`}
            className="pb-[calc(8px*var(--glint-ui-scale,1))]"
          >
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
        data-component={`${dataComponent}_dialogs_service-record-review-confirm`}
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
              data-component={`${dataComponent}_dialogs_finalize_progress-section`}
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
                data-component={`${dataComponent}_dialogs_finalize_progress`}
                testIdPrefix="contracts-finalize-progress"
                className="w-full max-w-[calc(320px*var(--glint-ui-scale,1))]"
              />
            </div>
          ) : (
            <>
              <div
                data-component={`${dataComponent}_dialogs_finalize_end-date-field`}
                className="pb-[calc(8px*var(--glint-ui-scale,1))]"
              >
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
          <div data-component={`${dataComponent}_dialogs_activity_body`}>
            <div data-component={`${dataComponent}_dialogs_activity_body_timeline`}>
              <ActivityTimeline
                data-component={`${dataComponent}_dialogs_activity_body_timeline_activity-timeline`}
                items={activityItems}
                maxHeight="360px"
              />
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
        data-component={`${dataComponent}_dialogs_document-preview`}
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
