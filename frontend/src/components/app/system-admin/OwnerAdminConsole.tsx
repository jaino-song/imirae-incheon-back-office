"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Bell,
  Building2,
  CheckCircle2,
  ChevronDown,
  KeyRound,
  MessageCircle,
  Pencil,
  Plus,
  ShieldCheck,
  UserKey,
  Users,
  type LucideIcon,
} from "lucide-react";

import { NotificationTestSection } from "@/components/app/settings/NotificationTestSection";
import { SystemAdminBranchForm } from "@/components/app/system-admin/SystemAdminBranchForm";
import { TagPill } from "@/components/app/ui/tag-pill";
import {
  AnimatedSlotList,
  AnimatedSlotListItemContent,
  DetailEmptyState,
  DetailPanel,
  DetailSkeleton,
  HeaderActionButton,
  InfoCard,
  InfoRow,
  ListEmptyState,
  ListPanel,
  PageSection,
  SectionNav,
  SplitLayout,
  StatsBar,
  type SplitLayoutMode,
  type StatsBarItem,
} from "@/components/app/v3";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  approveSystemAdminMessageSenderApproval,
  createSystemAdminBranch,
  getSystemAdminBranchRequests,
  updateSystemAdminBranch,
  type SystemAdminBranchInput,
  type SystemAdminBranchRequest,
} from "@/lib/api/system-admin";
import {
  approveUser,
  getSystemAdminUsers,
  rejectUser,
  updateUserRole,
  type SystemAdminUser,
} from "@/lib/api/users";
import { REGISTERABLE_ROLE_OPTIONS, ROLES } from "@/lib/constants/roles";
import { cn } from "@/lib/utils";
import { matchesSearchQuery } from "@/lib/search/korean-search";

type AdminSectionId = "branches" | "accounts" | "notifications";
type BranchFormMode = "create" | "edit";
type StatusVariant = "warning" | "info" | "success" | "destructive";
type AdminTagPillVariant = "amber" | "emerald" | "sky" | "indigo" | "neutral";

interface AdminDetailRow {
  label: string;
  value: string;
}

interface AdminRequestAction {
  type: "approve-message-sender";
  branchId: string;
}

interface AdminRequest {
  category: string;
  statusLabel: string;
  detailRows: readonly AdminDetailRow[];
  applicantRows?: readonly AdminDetailRow[];
  action?: AdminRequestAction;
}

interface PendingAccountApproval {
  userId: string;
  branchId?: string;
  requestedRole: string;
}

interface AdminRecord {
  id: string;
  title: string;
  listTitle: string;
  listSubtitle?: string;
  listSummary?: string;
  listStatusLabel?: string;
  category: string;
  statusLabel: string;
  statusVariant: StatusVariant;
  owner: string;
  summary: string;
  tags: readonly string[];
  detailRows: readonly AdminDetailRow[];
  applicantRows?: readonly AdminDetailRow[];
  requests?: readonly AdminRequest[];
  pendingAccountApproval?: PendingAccountApproval;
  accountRole?: string | null;
}

interface AdminSection {
  id: AdminSectionId;
  label: string;
  icon: LucideIcon;
  listTitle: string;
  listSubtitle?: string;
  searchPlaceholder?: string;
  tabs?: readonly {
    label: string;
    value: string;
    activeClassName?: string;
    indicatorClassName?: string;
  }[];
  stats: readonly StatsBarItem[];
  emptyMessage: string;
  detailEmptyMessage: string;
  records: readonly AdminRecord[];
}

interface SectionViewState {
  tab: string;
  search: string;
  selectedRecordId: string | null;
}

interface AdminListPill {
  label: string;
  variant: AdminTagPillVariant;
}

const BRANCH_MANAGEMENT_TABS: AdminSection["tabs"] = [
  { label: "전체 지점", value: "all" },
  { label: "메시지 신청", value: "messaging" },
  { label: "승인 완료", value: "approved" },
  { label: "미신청", value: "not_requested" },
];

const OWNER_ADMIN_SECTIONS = [
  {
    id: "branches",
    label: "지점 관리",
    icon: Building2,
    listTitle: "지점 관리",
    listSubtitle: undefined,
    searchPlaceholder: "지점명, 지역, 담당자 검색…",
    tabs: BRANCH_MANAGEMENT_TABS,
    stats: [],
    emptyMessage: "조건에 맞는 지점이 없습니다.",
    detailEmptyMessage: "지점을 선택하면 운영 정보와 승인 신청이 표시됩니다.",
    records: [],
  },
  {
    id: "accounts",
    label: "계정 관리",
    icon: UserKey,
    listTitle: "계정 관리",
    listSubtitle: "등록된 계정과 소속 정보를 확인할 수 있어요",
    searchPlaceholder: "이름, 이메일, 조직, 역할 검색…",
    tabs: [
      { label: "전체", value: "all" },
      {
        label: "가입 대기",
        value: "pending",
        activeClassName: "text-amber-700",
        indicatorClassName: "bg-amber-600",
      },
      {
        label: "지점장",
        value: "branch-manager",
        activeClassName: "text-amber-700",
        indicatorClassName: "bg-amber-600",
      },
      {
        label: "매니저",
        value: "manager",
        activeClassName: "text-sky-700",
        indicatorClassName: "bg-sky-600",
      },
      { label: "직원", value: "user" },
      {
        label: "오너",
        value: "owner",
        activeClassName: "text-emerald-700",
        indicatorClassName: "bg-emerald-600",
      },
    ],
    stats: [],
    emptyMessage: "조건에 맞는 계정이 없습니다.",
    detailEmptyMessage: "계정을 선택하면 권한과 소속 정보가 표시됩니다.",
    records: [],
  },
  {
    id: "notifications",
    label: "알림 테스트",
    icon: Bell,
    listTitle: "알림 테스트",
    listSubtitle: "실제 브라우저 푸시 발송 상태를 점검할 수 있어요",
    stats: [],
    emptyMessage: "사용 가능한 알림 테스트 도구가 없습니다.",
    detailEmptyMessage: "테스트 도구를 선택하면 실행 화면이 표시됩니다.",
    records: [
      {
        id: "notification-test-broadcast",
        title: "브라우저 알림 테스트",
        listTitle: "브라우저 알림 테스트",
        listSubtitle: "전체 구독 디바이스",
        listSummary: "실제 푸시 브로드캐스트를 전송합니다.",
        listStatusLabel: "실행 가능",
        category: "notifications",
        statusLabel: "실행 가능",
        statusVariant: "info",
        owner: "시스템",
        summary: "현재 구독된 모든 디바이스에 테스트 알림을 전송합니다.",
        tags: ["Push", "브로드캐스트"],
        detailRows: [
          { label: "대상", value: "현재 구독된 모든 디바이스" },
          { label: "용도", value: "브라우저 알림 설정 및 수신 상태 확인" },
        ],
      },
    ],
  },
] as const satisfies readonly AdminSection[];

const SECTION_ICON_CLASSNAMES: Record<AdminSectionId, string> = {
  branches: "bg-v3-green-light text-v3-green",
  accounts: "bg-v3-orange-light text-v3-orange",
  notifications: "bg-v3-primary-light text-v3-primary",
};

const CATEGORY_BADGE_STYLE: Record<string, { icon: string }> = {
  messaging: { icon: "bg-v3-orange-light text-v3-orange" },
  approved: { icon: "bg-v3-green-light text-v3-green" },
  not_requested: { icon: "bg-v3-dim-white text-v3-text-muted" },
  notifications: { icon: "bg-v3-primary-light text-v3-primary" },
  pending: { icon: "bg-amber-100 text-amber-700" },
  owner: { icon: "bg-v3-green-light text-v3-green" },
  admin: { icon: "bg-v3-orange-light text-v3-orange" },
  "branch-manager": { icon: "bg-v3-orange-light text-v3-orange" },
  manager: { icon: "bg-sky-100 text-sky-700" },
  user: { icon: "bg-v3-dim-white text-v3-text-muted" },
};

function getAdminRolePillVariant(roleLabel: string): AdminTagPillVariant {
  switch (roleLabel) {
    case "오너":
      return "emerald";
    case "가입 대기":
    case "지점장":
      return "amber";
    case "매니저":
      return "sky";
    default:
      return "neutral";
  }
}

function getBranchRequestPillVariant(category: string): AdminTagPillVariant {
  switch (category) {
    case "messaging":
      return "sky";
    case "approved":
      return "emerald";
    default:
      return "neutral";
  }
}

function getBranchRequestPills(record: AdminRecord): AdminListPill[] {
  const requestItems =
    record.requests && record.requests.length > 0
      ? record.requests.map((request) => ({
          label: request.statusLabel,
          variant: getBranchRequestPillVariant(request.category),
        }))
      : [
          {
            label: record.statusLabel,
            variant: getBranchRequestPillVariant(record.category),
          },
        ];
  const seenLabels = new Set<string>();

  return requestItems.filter((item) => {
    if (seenLabels.has(item.label)) return false;
    seenLabels.add(item.label);
    return true;
  });
}

function getListPillItems(sectionId: AdminSectionId, record: AdminRecord): AdminListPill[] {
  if (sectionId === "branches") return getBranchRequestPills(record);

  if (sectionId === "accounts" && record.listStatusLabel) {
    return [
      {
        label: record.listStatusLabel,
        variant: getAdminRolePillVariant(record.listStatusLabel),
      },
    ];
  }

  return record.tags.map((tag) => ({
    label: tag,
    variant: sectionId === "notifications" ? "indigo" : "neutral",
  }));
}

function getApplicantLabel(record: AdminRecord): string | null {
  const applicantName =
    record.applicantRows?.find((row) => row.label === "신청자")?.value ?? record.owner;
  return applicantName ? `지점장: ${applicantName}` : null;
}

function formatAccountDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";

  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function formatBirthDate(value: string | null): string {
  if (!value) return "-";

  const digits = value.replace(/\D/g, "");
  if (digits.length === 8) {
    return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  }
  if (digits.length === 6) {
    return `${digits.slice(0, 2)}-${digits.slice(2, 4)}-${digits.slice(4, 6)}`;
  }
  return value;
}

function getAccountRoleLabel(role: string | null): string {
  switch (role) {
    case "owner":
      return "오너";
    case "admin":
      return "지점장";
    case "manager":
      return "매니저";
    case "user":
      return "직원";
    default:
      return "미지정";
  }
}

function getDefaultPendingApprovalRole(user: SystemAdminUser): string {
  const isRegisterableRole = REGISTERABLE_ROLE_OPTIONS.some(
    (option) => option.value === user.requestedRole,
  );
  return isRegisterableRole && user.requestedRole ? user.requestedRole : ROLES.user;
}

function getAccountCategory(role: string | null): string {
  switch (role) {
    case "owner":
      return "owner";
    case "admin":
      return "branch-manager";
    case "manager":
      return "manager";
    default:
      return "user";
  }
}

function getAccountAuthProviderLabel(authProvider: string): string {
  switch (authProvider) {
    case "kakao":
      return "카카오";
    case "email":
      return "이메일";
    case "both":
      return "카카오 + 이메일";
    default:
      return authProvider || "-";
  }
}

function getAccountBranchLabel(user: SystemAdminUser): string {
  if (user.branches.length === 0) return user.role === "owner" ? "오너 전용" : "소속 없음";

  const [firstBranch, ...restBranches] = user.branches;
  return restBranches.length > 0 ? `${firstBranch.name} 외 ${restBranches.length}곳` : firstBranch.name;
}

function getAccountBranchSummary(user: SystemAdminUser): string {
  if (user.branches.length === 0) return user.role === "owner" ? "오너 계정" : "소속 없음";

  return user.branches
    .map((branch) =>
      branch.role ? `${branch.name} (${getAccountRoleLabel(branch.role)})` : branch.name,
    )
    .join(", ");
}

function getAccountStatus(user: SystemAdminUser): { label: string; variant: StatusVariant } {
  if (!user.phone || !user.birthDate) return { label: "추가 정보 필요", variant: "warning" };

  if (user.email && user.authProvider !== "kakao" && !user.emailVerified) {
    return { label: "이메일 인증 필요", variant: "info" };
  }

  return { label: "정상", variant: "success" };
}

function buildAccountStats(users: readonly SystemAdminUser[]): readonly StatsBarItem[] {
  const ownerUsers = users.filter((user) => user.role === "owner").length;
  const unverifiedUsers = users.filter(
    (user) => Boolean(user.email) && user.authProvider !== "kakao" && !user.emailVerified,
  ).length;
  const incompleteUsers = users.filter((user) => !user.phone || !user.birthDate).length;

  return [
    { icon: Users, value: users.length, label: "전체 계정", counter: "명" },
    { icon: ShieldCheck, value: ownerUsers, label: "오너 계정", counter: "명" },
    {
      icon: KeyRound,
      value: unverifiedUsers,
      label: "이메일 인증 필요",
      counter: "명",
      colorIndex: 1,
    },
    {
      icon: AlertTriangle,
      value: incompleteUsers,
      label: "추가 정보 필요",
      counter: "명",
      colorIndex: 2,
    },
  ];
}

function buildAccountRecords(users: readonly SystemAdminUser[]): AdminRecord[] {
  return users.map((user) => {
    const isPendingApproval = user.approvalStatus === "pending";
    const roleLabel = getAccountRoleLabel(user.role);
    const requestedRoleLabel = getAccountRoleLabel(user.requestedRole);
    const authProviderLabel = getAccountAuthProviderLabel(user.authProvider);
    const accountStatus = getAccountStatus(user);
    const pendingAccountApproval = isPendingApproval
      ? {
          userId: user.id,
          requestedRole: getDefaultPendingApprovalRole(user),
        }
      : undefined;

    return {
      id: user.id,
      title: isPendingApproval ? "가입 승인 대기" : `${roleLabel} 계정`,
      listTitle: user.name ?? user.email ?? "이름 미등록",
      listSubtitle: getAccountBranchLabel(user),
      listSummary: isPendingApproval ? `요청 권한: ${requestedRoleLabel}` : undefined,
      listStatusLabel: isPendingApproval ? "가입 대기" : roleLabel,
      category: isPendingApproval ? "pending" : getAccountCategory(user.role),
      statusLabel: isPendingApproval ? "가입 대기" : accountStatus.label,
      statusVariant: isPendingApproval ? "warning" : accountStatus.variant,
      owner: authProviderLabel,
      summary: isPendingApproval ? "가입 승인 검토가 필요한 계정입니다." : `${authProviderLabel} 로그인`,
      tags: [],
      detailRows: [
        { label: "이름", value: user.name ?? "-" },
        { label: "이메일", value: user.email ?? "-" },
        { label: "전화번호", value: user.phone ?? "-" },
        { label: "생년월일", value: formatBirthDate(user.birthDate) },
        {
          label: isPendingApproval ? "요청 권한" : "역할",
          value: isPendingApproval ? requestedRoleLabel : roleLabel,
        },
        { label: "인증 방식", value: authProviderLabel },
        {
          label: "이메일 인증",
          value:
            user.email && user.authProvider !== "kakao"
              ? user.emailVerified
                ? "완료"
                : "미완료"
              : "해당 없음",
        },
        { label: "가입일", value: formatAccountDate(user.createdAt) },
        { label: "소속", value: getAccountBranchSummary(user) },
      ],
      pendingAccountApproval,
      accountRole: user.role,
    };
  });
}

function formatOptionalDate(value: string | null): string {
  return value ? formatAccountDate(value) : "-";
}

function getBranchLocationLabel(branch: SystemAdminBranchRequest): string {
  const location = [branch.region, branch.district].filter(Boolean).join(" ");
  return location || branch.address || branch.slug;
}

function getBranchMessageStatus(
  branch: SystemAdminBranchRequest,
): { category: string; statusLabel: string; statusVariant: StatusVariant } {
  switch (branch.messageSenderApproval.approvalStatus) {
    case "pending":
      return { category: "messaging", statusLabel: "메시지 신청", statusVariant: "warning" };
    case "approved":
      return { category: "approved", statusLabel: "승인 완료", statusVariant: "success" };
    default:
      return { category: "not_requested", statusLabel: "미신청", statusVariant: "info" };
  }
}

function buildBranchStats(branches: readonly SystemAdminBranchRequest[]): readonly StatsBarItem[] {
  const pendingRequests = branches.filter(
    (branch) => branch.messageSenderApproval.approvalStatus === "pending",
  ).length;
  const approvedRequests = branches.filter(
    (branch) => branch.messageSenderApproval.approvalStatus === "approved",
  ).length;
  const inactiveBranches = branches.filter((branch) => !branch.isActive).length;

  return [
    { icon: Building2, value: branches.length, label: "전체 지점", counter: "곳" },
    {
      icon: MessageCircle,
      value: pendingRequests,
      label: "메시지 신청",
      counter: "건",
      colorIndex: 1,
    },
    {
      icon: CheckCircle2,
      value: approvedRequests,
      label: "승인 완료",
      counter: "건",
      colorIndex: 2,
    },
    { icon: AlertTriangle, value: inactiveBranches, label: "비활성 지점", counter: "곳" },
  ];
}

function buildBranchRecords(branches: readonly SystemAdminBranchRequest[]): AdminRecord[] {
  return branches.map((branch) => {
    const messageStatus = getBranchMessageStatus(branch);
    const requester = branch.messageSenderApproval.requestedBy;
    const applicantRows = requester
      ? [
          { label: "신청자", value: requester.name ?? "-" },
          { label: "전화번호", value: requester.phone ?? "-" },
          { label: "이메일", value: requester.email ?? "-" },
          { label: "역할", value: getAccountRoleLabel(requester.role) },
          { label: "신청 날짜", value: formatOptionalDate(branch.messageSenderApproval.requestedAt) },
        ]
      : undefined;
    const detailRows = [
      { label: "지점명", value: branch.name },
      { label: "지역", value: getBranchLocationLabel(branch) },
      { label: "주소", value: branch.address ?? "-" },
      { label: "대표 전화", value: branch.phone ?? "-" },
      { label: "이메일", value: branch.email ?? "-" },
      { label: "운영 상태", value: branch.isActive ? "운영 중" : "비활성" },
      { label: "지점장", value: branch.owner?.name ?? branch.owner?.email ?? "-" },
      { label: "수정일", value: formatOptionalDate(branch.updatedAt) },
    ];
    const pendingRequest: AdminRequest | null =
      branch.messageSenderApproval.approvalStatus === "pending"
        ? {
            category: "messaging",
            statusLabel: "메시지 승인 신청",
            applicantRows,
            detailRows: [
              { label: "기관명", value: branch.name },
              { label: "요청 기능", value: "SMS/LMS 발송" },
              { label: "상태", value: "접수 대기" },
            ],
            action: { type: "approve-message-sender", branchId: branch.id },
          }
        : null;

    return {
      id: branch.id,
      title: branch.name,
      listTitle: branch.name,
      listSubtitle: getBranchLocationLabel(branch),
      category: messageStatus.category,
      statusLabel: messageStatus.statusLabel,
      statusVariant: messageStatus.statusVariant,
      owner: branch.owner?.name ?? branch.owner?.email ?? "-",
      summary:
        branch.messageSenderApproval.approvalStatus === "pending"
          ? "메시지 발신번호 승인 신청이 접수되었습니다."
          : branch.messageSenderApproval.approvalStatus === "approved"
            ? "메시지 발신번호 승인이 완료된 지점입니다."
            : "메시지 발신번호 승인 신청이 아직 없습니다.",
      tags: [],
      detailRows,
      applicantRows: pendingRequest ? applicantRows : undefined,
      requests: pendingRequest ? [pendingRequest] : undefined,
    };
  });
}

function buildOwnerAdminSections(
  users: readonly SystemAdminUser[],
  branches: readonly SystemAdminBranchRequest[],
  options: {
    isAccountsLoading: boolean;
    hasAccountsError: boolean;
    isBranchesLoading: boolean;
    hasBranchesError: boolean;
  },
): readonly AdminSection[] {
  return OWNER_ADMIN_SECTIONS.map((section): AdminSection => {
    if (section.id === "branches") {
      return {
        ...section,
        stats: buildBranchStats(branches),
        records: buildBranchRecords(branches),
        emptyMessage: options.hasBranchesError
          ? "지점 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요."
          : options.isBranchesLoading
            ? "지점 정보를 불러오는 중…"
            : branches.length === 0
              ? "등록된 지점이 없습니다."
              : section.emptyMessage,
        detailEmptyMessage: options.hasBranchesError
          ? "지점 정보를 불러오지 못했습니다."
          : section.detailEmptyMessage,
      };
    }

    if (section.id === "accounts") {
      return {
        ...section,
        stats: buildAccountStats(users),
        records: buildAccountRecords(users),
        emptyMessage: options.hasAccountsError
          ? "계정 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요."
          : options.isAccountsLoading
            ? "계정 정보를 불러오는 중…"
            : users.length === 0
              ? "등록된 계정이 없습니다."
              : section.emptyMessage,
        detailEmptyMessage: options.hasAccountsError
          ? "계정 정보를 불러오지 못했습니다."
          : section.detailEmptyMessage,
      };
    }

    return section;
  });
}

function filterSectionRecords(section: AdminSection, tab: string, query: string): AdminRecord[] {
  return section.records.filter((record) => {
    const matchesTab =
      tab === "all" ||
      record.category === tab ||
      (record.requests?.some((request) => request.category === tab) ?? false);
    if (!matchesTab) return false;
    return matchesSearchQuery(query, [
      record.title,
      record.summary,
      record.owner,
      record.listSubtitle ?? "",
      ...record.tags,
      ...record.detailRows.map((row) => row.value),
      ...(record.applicantRows?.map((row) => row.value) ?? []),
    ]);
  });
}

function createInitialViewState(): Record<AdminSectionId, SectionViewState> {
  return OWNER_ADMIN_SECTIONS.reduce(
    (state, section) => ({
      ...state,
      [section.id]: { tab: "all", search: "", selectedRecordId: null },
    }),
    {} as Record<AdminSectionId, SectionViewState>,
  );
}

function resolveSelectedRecordId(
  section: AdminSection,
  nextTab: string,
  nextSearch: string,
  preferredSelectedRecordId: string | null,
  shouldAutoSelectFirst: boolean,
): string | null {
  const visibleRecords = filterSectionRecords(section, nextTab, nextSearch);

  if (preferredSelectedRecordId === null) {
    return shouldAutoSelectFirst ? (visibleRecords[0]?.id ?? null) : null;
  }
  if (visibleRecords.some((record) => record.id === preferredSelectedRecordId)) {
    return preferredSelectedRecordId;
  }
  return shouldAutoSelectFirst ? (visibleRecords[0]?.id ?? null) : null;
}

export function OwnerAdminConsole() {
  const [activeSectionId, setActiveSectionId] = useState<AdminSectionId>("branches");
  const [splitLayoutMode, setSplitLayoutMode] = useState<SplitLayoutMode | null>(null);
  const [viewStateBySection, setViewStateBySection] = useState(createInitialViewState);
  const [branchFormMode, setBranchFormMode] = useState<BranchFormMode | null>(null);
  const [autoSelectionSuppressedSectionId, setAutoSelectionSuppressedSectionId] =
    useState<AdminSectionId | null>(null);
  const queryClient = useQueryClient();

  const {
    data: systemAdminUsers = [],
    isLoading: isSystemAdminUsersLoading,
    error: systemAdminUsersError,
  } = useQuery({ queryKey: ["systemAdminUsers"], queryFn: getSystemAdminUsers });
  const {
    data: systemAdminBranchRequests = [],
    isLoading: isSystemAdminBranchRequestsLoading,
    error: systemAdminBranchRequestsError,
  } = useQuery({
    queryKey: ["systemAdminBranchRequests"],
    queryFn: getSystemAdminBranchRequests,
  });
  const approveMessageSenderMutation = useMutation({
    mutationFn: approveSystemAdminMessageSenderApproval,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["systemAdminBranchRequests"] });
    },
  });
  const createBranchMutation = useMutation({
    mutationFn: createSystemAdminBranch,
    onSuccess: (branch) => {
      queryClient.setQueryData<SystemAdminBranchRequest[]>(
        ["systemAdminBranchRequests"],
        (current = []) => [branch, ...current.filter((item) => item.id !== branch.id)],
      );
      setViewStateBySection((currentState) => ({
        ...currentState,
        branches: { ...currentState.branches, selectedRecordId: branch.id },
      }));
      setBranchFormMode(null);
      void queryClient.invalidateQueries({ queryKey: ["systemAdminBranchRequests"] });
    },
  });
  const updateBranchMutation = useMutation({
    mutationFn: ({ branchId, input }: { branchId: string; input: SystemAdminBranchInput }) =>
      updateSystemAdminBranch(branchId, input),
    onSuccess: (branch) => {
      queryClient.setQueryData<SystemAdminBranchRequest[]>(
        ["systemAdminBranchRequests"],
        (current = []) => current.map((item) => (item.id === branch.id ? branch : item)),
      );
      setBranchFormMode(null);
      void queryClient.invalidateQueries({ queryKey: ["systemAdminBranchRequests"] });
    },
  });
  const [pendingRoleSelections, setPendingRoleSelections] = useState<Record<string, string>>({});
  const [pendingBranchSelections, setPendingBranchSelections] = useState<Record<string, string>>({});
  const [pendingOwnerBranchSelections, setPendingOwnerBranchSelections] = useState<
    Record<string, string>
  >({});
  const approveUserMutation = useMutation({
    mutationFn: ({
      id,
      role,
      branchId,
      ownerBranchId,
    }: {
      id: string;
      role: string;
      branchId: string;
      ownerBranchId?: string;
    }) => approveUser(id, role, branchId, ownerBranchId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["systemAdminUsers"] });
    },
  });
  const rejectUserMutation = useMutation({
    mutationFn: (id: string) => rejectUser(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["systemAdminUsers"] });
    },
  });
  const isPendingApprovalActionRunning = approveUserMutation.isPending || rejectUserMutation.isPending;
  const [accountEditUserId, setAccountEditUserId] = useState<string | null>(null);
  const [accountRoleSelections, setAccountRoleSelections] = useState<Record<string, string>>({});
  const updateUserRoleMutation = useMutation({
    mutationFn: ({ id, role }: { id: string; role: "manager" | "user" }) =>
      updateUserRole(id, role),
    onSuccess: () => {
      setAccountEditUserId(null);
      void queryClient.invalidateQueries({ queryKey: ["systemAdminUsers"] });
      void queryClient.invalidateQueries({ queryKey: ["systemAdminBranchRequests"] });
    },
  });

  const sections = useMemo(
    () =>
      buildOwnerAdminSections(systemAdminUsers, systemAdminBranchRequests, {
        isAccountsLoading: isSystemAdminUsersLoading,
        hasAccountsError: Boolean(systemAdminUsersError),
        isBranchesLoading: isSystemAdminBranchRequestsLoading,
        hasBranchesError: Boolean(systemAdminBranchRequestsError),
      }),
    [
      systemAdminUsers,
      systemAdminBranchRequests,
      isSystemAdminUsersLoading,
      systemAdminUsersError,
      isSystemAdminBranchRequestsLoading,
      systemAdminBranchRequestsError,
    ],
  );
  const activeSection =
    sections.find((section) => section.id === activeSectionId) ?? OWNER_ADMIN_SECTIONS[0];
  const activeViewState = viewStateBySection[activeSection.id];
  const deferredSearchQuery = useDeferredValue(activeViewState.search);
  const filteredRecords = useMemo(
    () => filterSectionRecords(activeSection, activeViewState.tab, deferredSearchQuery),
    [activeSection, activeViewState.tab, deferredSearchQuery],
  );
  const isActiveSectionLoading =
    (activeSection.id === "accounts" &&
      isSystemAdminUsersLoading &&
      !systemAdminUsersError) ||
    (activeSection.id === "branches" &&
      isSystemAdminBranchRequestsLoading &&
      !systemAdminBranchRequestsError);
  const shouldAutoSelectFirstRecord =
    splitLayoutMode === "desktop" && autoSelectionSuppressedSectionId !== activeSection.id;
  const resolvedSelectedRecordId = resolveSelectedRecordId(
    activeSection,
    activeViewState.tab,
    deferredSearchQuery,
    activeViewState.selectedRecordId,
    shouldAutoSelectFirstRecord,
  );
  const selectedRecord =
    filteredRecords.find((record) => record.id === resolvedSelectedRecordId) ?? null;
  const selectedBranch =
    activeSection.id === "branches"
      ? systemAdminBranchRequests.find((branch) => branch.id === selectedRecord?.id) ?? null
      : null;
  const branchManagerOptions = useMemo(
    () =>
      systemAdminUsers
        .filter(
          (user) =>
            user.approvalStatus === "approved" &&
            [ROLES.owner, ROLES.admin, ROLES.manager, ROLES.user].some(
              (role) => user.role === role,
            ),
        )
        .map((user) => ({
          id: user.id,
          label: `${user.name ?? user.email ?? "이름 미등록"}${user.email ? ` (${user.email})` : ""}`,
        })),
    [systemAdminUsers],
  );
  const isBranchMutationPending =
    createBranchMutation.isPending || updateBranchMutation.isPending;
  const branchMutationError = createBranchMutation.error ?? updateBranchMutation.error;

  const updateActiveSectionState = (updater: (current: SectionViewState) => SectionViewState) => {
    setViewStateBySection((currentState) => ({
      ...currentState,
      [activeSection.id]: updater(currentState[activeSection.id]),
    }));
  };

  return (
    <PageSection name="system-admin">
      <h1 className="sr-only">관리자</h1>

      {activeSection.stats.length > 0 ? (
        <StatsBar name="system-admin" items={activeSection.stats} />
      ) : null}

      <div
        data-component="system-admin-sections"
        className="flex min-h-0 flex-1 flex-col gap-6 lg:flex-row"
      >
        <SectionNav
          items={sections.map((section) => ({
            id: section.id,
            label: section.label,
            icon: section.icon,
          }))}
          activeId={activeSection.id}
          onSelect={(id) => setActiveSectionId(id as AdminSectionId)}
          ariaLabel="관리자 기능"
        />

        <div className="min-h-0 flex-1">
          <SplitLayout data-component="desktop_system-admin_split-layout"
            hasSelection={Boolean(selectedRecord || branchFormMode)}
            onModeChange={setSplitLayoutMode}
            onBack={() => {
              if (branchFormMode) {
                setBranchFormMode(null);
                return;
              }
              updateActiveSectionState((current) => ({
                ...current,
                selectedRecordId: null,
              }));
            }}
          >
            <ListPanel data-component="desktop_system-admin_split-layout_list-panel"
              title={activeSection.listTitle}
              subtitle={activeSection.listSubtitle}
              tabs={activeSection.tabs ? [...activeSection.tabs] : undefined}
              activeTab={activeSection.tabs ? activeViewState.tab : undefined}
              tabsAriaLabel={activeSection.tabs ? `${activeSection.listTitle} 필터` : undefined}
              onTabChange={
                activeSection.tabs
                  ? (nextTab) => {
                      const shouldClearBranchEdit =
                        branchFormMode === "edit" && nextTab !== activeViewState.tab;

                      if (shouldClearBranchEdit) {
                        setBranchFormMode(null);
                        setAutoSelectionSuppressedSectionId(activeSection.id);
                      }

                      updateActiveSectionState((current) => ({
                        ...current,
                        tab: nextTab,
                        selectedRecordId: shouldClearBranchEdit
                          ? null
                          : resolveSelectedRecordId(
                              activeSection,
                              nextTab,
                              current.search,
                              current.selectedRecordId,
                              shouldAutoSelectFirstRecord,
                            ),
                      }));
                    }
                  : undefined
              }
              searchValue={activeSection.searchPlaceholder ? activeViewState.search : undefined}
              onSearchChange={
                activeSection.searchPlaceholder
                  ? (nextSearch) =>
                      updateActiveSectionState((current) => ({
                        ...current,
                        search: nextSearch,
                        selectedRecordId: resolveSelectedRecordId(
                          activeSection,
                          current.tab,
                          nextSearch,
                          current.selectedRecordId,
                          shouldAutoSelectFirstRecord,
                        ),
                      }))
                  : undefined
              }
              searchPlaceholder={activeSection.searchPlaceholder}
              searchAriaLabel={
                activeSection.searchPlaceholder ? `${activeSection.listTitle} 검색` : undefined
              }
              headerActions={
                activeSection.id === "branches" ? (
                  <HeaderActionButton
                    icon={Plus}
                    label="지점 추가"
                    onClick={() => {
                      createBranchMutation.reset();
                      updateBranchMutation.reset();
                      setBranchFormMode("create");
                    }}
                  />
                ) : undefined
              }
            >
              {!isActiveSectionLoading && filteredRecords.length === 0 ? (
                <ListEmptyState message={activeSection.emptyMessage} />
              ) : (
                <AnimatedSlotList<AdminRecord>
                  items={filteredRecords}
                  isLoading={isActiveSectionLoading}
                  loadingCount={5}
                  className="space-y-2"
                  itemDataComponent="system-admin-list-item"
                  getItemKey={(record) => record.id}
                  getSlotState={({ item, isLoading: slotLoading }) => ({
                    isActive: !slotLoading && item?.id === selectedRecord?.id,
                    isInteractive: !slotLoading && Boolean(item),
                  })}
                  onSlotClick={(record) =>
                    {
                      setBranchFormMode(null);
                      setAutoSelectionSuppressedSectionId(null);
                      updateActiveSectionState((current) => ({
                        ...current,
                        selectedRecordId: record.id,
                      }));
                    }
                  }
                  render={({ item: record, isLoading: slotLoading }) => {
                    if (slotLoading) {
                      return (
                        <div
                          data-component="system-admin-list-skeleton-row"
                          className="flex min-h-11 items-center gap-3"
                        >
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-v3-dim-white">
                            <Skeleton className="h-4 w-4 rounded-md bg-white/70" />
                          </div>
                          <div className="min-w-0 flex-1 space-y-2">
                            <Skeleton className="h-4 w-28 bg-v3-dim-white" />
                            <Skeleton className="h-3 w-44 bg-v3-dim-white" />
                          </div>
                          <Skeleton className="h-6 w-14 rounded-full bg-v3-dim-white" />
                        </div>
                      );
                    }
                    if (!record) return null;

                    const ListIcon =
                      activeSection.id === "accounts"
                        ? UserKey
                        : activeSection.id === "branches"
                          ? Building2
                          : Bell;
                    const listPillItems = getListPillItems(activeSection.id, record);
                    const isBranchSection = activeSection.id === "branches";
                    const listSummary = isBranchSection
                      ? getApplicantLabel(record)
                      : record.listSummary;
                    const hasBranchAsidePill =
                      isBranchSection && activeViewState.tab !== "all" && listPillItems.length > 0;
                    const hasSingleAsidePill =
                      !isBranchSection && listPillItems.length === 1;
                    const hasInlinePills =
                      !isBranchSection && !hasSingleAsidePill && listPillItems.length > 0;

                    return (
                      <AnimatedSlotListItemContent
                        dataComponent="system-admin-list-item"
                        icon={ListIcon}
                        iconContainerClassName={cn(
                          CATEGORY_BADGE_STYLE[record.category]?.icon ??
                            SECTION_ICON_CLASSNAMES[activeSection.id],
                        )}
                        title={record.listTitle}
                        subtitle={isBranchSection ? undefined : record.listSubtitle}
                        meta={
                          listSummary || hasInlinePills ? (
                            <>
                              {listSummary ? (
                                <span className="min-w-0 truncate text-v3-text">{listSummary}</span>
                              ) : null}
                              {hasInlinePills
                                ? listPillItems.map((pill) => (
                                    <TagPill key={pill.label} variant={pill.variant}>
                                      {pill.label}
                                    </TagPill>
                                  ))
                                : null}
                            </>
                          ) : undefined
                        }
                        metaClassName="flex-wrap gap-1 whitespace-normal"
                        status={
                          hasBranchAsidePill || hasSingleAsidePill ? (
                            <div className="flex shrink-0 items-center self-center">
                              <TagPill variant={listPillItems[0].variant}>
                                {listPillItems[0].label}
                              </TagPill>
                            </div>
                          ) : undefined
                        }
                      />
                    );
                  }}
                />
              )}
            </ListPanel>

            {branchFormMode ? (
              <DetailPanel data-component="desktop_system-admin_split-layout_detail-panel"
                avatar={
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[16px] bg-v3-green-light text-v3-green">
                    <Building2 className="h-5 w-5" aria-hidden="true" />
                  </div>
                }
                title={branchFormMode === "create" ? "지점 추가" : "지점 정보 수정"}
                subtitle={
                  branchFormMode === "create"
                    ? "새 지점의 운영 정보를 등록합니다."
                    : `${selectedBranch?.name ?? "선택한 지점"}의 정보를 수정합니다.`
                }
              >
                <SystemAdminBranchForm
                  key={`${branchFormMode}-${selectedBranch?.id ?? "new"}`}
                  mode={branchFormMode}
                  branch={branchFormMode === "edit" ? selectedBranch ?? undefined : undefined}
                  managerOptions={branchManagerOptions}
                  isSubmitting={isBranchMutationPending}
                  submitError={
                    branchMutationError
                      ? "지점 정보를 저장하지 못했습니다. 입력값을 확인한 뒤 다시 시도해 주세요."
                      : undefined
                  }
                  onCancel={() => setBranchFormMode(null)}
                  onSubmit={(input) => {
                    if (branchFormMode === "create") {
                      createBranchMutation.mutate(input);
                      return;
                    }
                    if (selectedBranch) {
                      updateBranchMutation.mutate({ branchId: selectedBranch.id, input });
                    }
                  }}
                />
              </DetailPanel>
            ) : isActiveSectionLoading ? (
              <DetailSkeleton
                name="system-admin-detail-skeleton"
                headerBadge
                sections={[
                  { titleWidth: "w-24", rows: ["w-full", "w-4/5", "w-2/3"] },
                  { titleWidth: "w-20", rows: ["w-full", "w-3/4"] },
                ]}
              />
            ) : selectedRecord ? (
              <DetailPanel data-component="desktop_system-admin_split-layout_detail-panel-2"
                avatar={
                  <div
                    className={cn(
                      "flex h-12 w-12 shrink-0 items-center justify-center rounded-[16px]",
                      CATEGORY_BADGE_STYLE[selectedRecord.category]?.icon ??
                        SECTION_ICON_CLASSNAMES[activeSection.id],
                    )}
                  >
                    <activeSection.icon className="h-5 w-5" aria-hidden="true" />
                  </div>
                }
                title={selectedRecord.listTitle}
                subtitle={
                  activeSection.id === "branches" ? (
                    <span className="text-sm text-v3-text-muted">
                      {selectedRecord.listTitle}의 메시지 발신 권한 상태
                    </span>
                  ) : activeSection.id === "accounts" &&
                    selectedRecord.listSubtitle &&
                    selectedRecord.listStatusLabel ? (
                    <span className="flex items-center gap-3 text-sm text-v3-text-muted">
                      <span className="flex items-center gap-1">
                        <Building2 className="h-3.5 w-3.5" aria-hidden="true" />
                        {selectedRecord.listSubtitle}
                      </span>
                      <span className="flex items-center gap-1">
                        <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                        {selectedRecord.listStatusLabel}
                      </span>
                    </span>
                  ) : (
                    <span className="text-sm text-v3-text-muted">{selectedRecord.summary}</span>
                  )
                }
              >
                {activeSection.id === "notifications" ? (
                  <div className="space-y-5">
                    <InfoCard data-component="desktop_system-admin_detail-panel_info-card" title="테스트 정보">
                      {selectedRecord.detailRows.map((row) => (
                        <InfoRow key={row.label} label={row.label} value={row.value} />
                      ))}
                    </InfoCard>
                    <InfoCard data-component="desktop_system-admin_detail-panel_info-card-2" title="알림 실행">
                      <NotificationTestSection />
                    </InfoCard>
                  </div>
                ) : (
                  <div className="space-y-5">
                    {activeSection.id === "branches" && selectedRecord.requests?.length ? (
                      <section data-component="system-admin-detail-section" className="space-y-4">
                        <InfoCard data-component="desktop_system-admin_detail-panel_info-card-3"
                          title="지점 정보"
                          titleTrailing={
                            <HeaderActionButton
                              icon={Pencil}
                              label="수정"
                              className="ml-auto"
                              onClick={() => {
                                createBranchMutation.reset();
                                updateBranchMutation.reset();
                                setBranchFormMode("edit");
                              }}
                            />
                          }
                        >
                          {selectedRecord.detailRows.map((row) => (
                            <InfoRow key={row.label} label={row.label} value={row.value} />
                          ))}
                        </InfoCard>
                      </section>
                    ) : null}
                    {(selectedRecord.requests?.length
                      ? selectedRecord.requests
                      : [
                          {
                            category: selectedRecord.category,
                            statusLabel: selectedRecord.statusLabel,
                            detailRows: selectedRecord.detailRows,
                            applicantRows: selectedRecord.applicantRows,
                          },
                        ]
                    ).map((request, index) => {
                      const approveAction =
                        request.action?.type === "approve-message-sender" ? request.action : null;
                      const pendingAccountApproval = selectedRecord.pendingAccountApproval;
                      const selectedPendingRole = pendingAccountApproval
                        ? (pendingRoleSelections[pendingAccountApproval.userId] ??
                          pendingAccountApproval.requestedRole)
                        : null;
                      const selectedPendingBranchId = pendingAccountApproval
                        ? (pendingBranchSelections[pendingAccountApproval.userId] ??
                          pendingAccountApproval.branchId ??
                          "")
                        : "";
                      const selectedPendingOwnerBranchId = pendingAccountApproval
                        ? (pendingOwnerBranchSelections[pendingAccountApproval.userId] ?? "")
                        : "";
                      const isPendingRoleAdmin = selectedPendingRole === ROLES.admin;
                      const isApprovedAccount =
                        activeSection.id === "accounts" && !pendingAccountApproval;
                      const canEditAccountRole =
                        isApprovedAccount && selectedRecord.accountRole !== ROLES.owner;
                      const isEditingThisAccount =
                        canEditAccountRole && accountEditUserId === selectedRecord.id;
                      const isAccountCurrentlyAdmin = selectedRecord.accountRole === ROLES.admin;
                      const defaultAccountRoleDraft = isAccountCurrentlyAdmin
                        ? ""
                        : (selectedRecord.accountRole ?? ROLES.user);
                      const selectedAccountRoleDraft =
                        accountRoleSelections[selectedRecord.id] ?? defaultAccountRoleDraft;
                      const infoTitle =
                        activeSection.id === "accounts"
                          ? "계정 정보"
                          : approveAction
                            ? "메시지 승인 신청"
                            : "지점 정보";

                      return (
                        <section
                          key={`${request.category}-${index}`}
                          data-component="system-admin-detail-section"
                          className={cn("space-y-4", index > 0 && "border-t border-v3-border pt-5")}
                        >
                          {request.applicantRows ? (
                            <InfoCard data-component="desktop_system-admin_detail-panel_info-card-4" title="신청인 정보">
                              {request.applicantRows.map((row) => (
                                <InfoRow key={row.label} label={row.label} value={row.value} />
                              ))}
                            </InfoCard>
                          ) : null}
                          <InfoCard data-component="desktop_system-admin_detail-panel_info-card-5"
                            title={infoTitle}
                            titleTrailing={
                              activeSection.id === "branches" && infoTitle === "지점 정보" ? (
                                <HeaderActionButton
                                  icon={Pencil}
                                  label="수정"
                                  className="ml-auto"
                                  onClick={() => {
                                    createBranchMutation.reset();
                                    updateBranchMutation.reset();
                                    setBranchFormMode("edit");
                                  }}
                                />
                              ) : canEditAccountRole ? (
                                <HeaderActionButton
                                  icon={Pencil}
                                  label="수정"
                                  className="ml-auto"
                                  onClick={() => {
                                    updateUserRoleMutation.reset();
                                    setAccountEditUserId(selectedRecord.id);
                                  }}
                                />
                              ) : undefined
                            }
                          >
                            {request.detailRows.map((row) => (
                              <InfoRow key={row.label} label={row.label} value={row.value} />
                            ))}
                          </InfoCard>
                          {isEditingThisAccount ? (
                            <div className="space-y-2">
                              {isAccountCurrentlyAdmin ? (
                                <p className="text-sm text-v3-text-muted">
                                  지점장 권한은 지점 정보의 지점장 임명/해제로 관리되며, 권한을
                                  변경하면 지점장에서 자동 해제됩니다.
                                </p>
                              ) : null}
                              <div
                                data-component="system-admin-account-edit-actions"
                                className="flex flex-wrap items-center gap-2"
                              >
                                <div className="relative">
                                  <select
                                    aria-label={`${selectedRecord.listTitle} 권한 선택`}
                                    data-component="system-admin-account-edit-role-select"
                                    value={selectedAccountRoleDraft}
                                    disabled={updateUserRoleMutation.isPending}
                                    onChange={(event) =>
                                      setAccountRoleSelections((previousSelections) => ({
                                        ...previousSelections,
                                        [selectedRecord.id]: event.target.value,
                                      }))
                                    }
                                    className="h-9 appearance-none rounded-full border border-v3-border bg-white pl-3 pr-8 text-sm text-v3-dark disabled:opacity-50"
                                  >
                                    {isAccountCurrentlyAdmin ? (
                                      <option value="" disabled>
                                        권한 선택
                                      </option>
                                    ) : null}
                                    <option value={ROLES.manager}>
                                      {getAccountRoleLabel(ROLES.manager)}
                                    </option>
                                    <option value={ROLES.user}>
                                      {getAccountRoleLabel(ROLES.user)}
                                    </option>
                                  </select>
                                  <ChevronDown
                                    className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-v3-text-muted"
                                    aria-hidden="true"
                                    strokeWidth={2.2}
                                  />
                                </div>

                                <Button
                                  type="button"
                                  size="sm"
                                  variant="positive"
                                  disabled={
                                    updateUserRoleMutation.isPending || !selectedAccountRoleDraft
                                  }
                                  onClick={() =>
                                    updateUserRoleMutation.mutate({
                                      id: selectedRecord.id,
                                      role: selectedAccountRoleDraft as "manager" | "user",
                                    })
                                  }
                                >
                                  {updateUserRoleMutation.isPending ? "저장 중…" : "저장"}
                                </Button>

                                <Button
                                  type="button"
                                  size="sm"
                                  variant="negative-outline"
                                  disabled={updateUserRoleMutation.isPending}
                                  onClick={() => setAccountEditUserId(null)}
                                >
                                  취소
                                </Button>
                              </div>

                              {updateUserRoleMutation.isError ? (
                                <p role="alert" className="text-sm text-destructive">
                                  권한 변경에 실패했습니다. 잠시 후 다시 시도해 주세요.
                                </p>
                              ) : null}
                            </div>
                          ) : null}
                          {pendingAccountApproval && selectedPendingRole ? (
                            <div className="space-y-2">
                              <div
                                data-component="system-admin-pending-approval-actions"
                                className="flex flex-wrap items-center gap-2"
                              >
                                <div className="relative">
                                  <select
                                    aria-label={`${selectedRecord.listTitle} 승인 지점 선택`}
                                    data-component="system-admin-pending-approval-branch-select"
                                    value={selectedPendingBranchId}
                                    disabled={isPendingApprovalActionRunning}
                                    onChange={(event) =>
                                      setPendingBranchSelections((previousSelections) => ({
                                        ...previousSelections,
                                        [pendingAccountApproval.userId]: event.target.value,
                                      }))
                                    }
                                    className="h-9 appearance-none rounded-full border border-v3-border bg-white pl-3 pr-8 text-sm text-v3-dark disabled:opacity-50"
                                  >
                                    <option value="">지점 선택</option>
                                    {systemAdminBranchRequests
                                      .filter((branch) => branch.isActive)
                                      .map((branch) => (
                                        <option key={branch.id} value={branch.id}>
                                          {branch.name}
                                        </option>
                                      ))}
                                  </select>
                                  <ChevronDown
                                    className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-v3-text-muted"
                                    aria-hidden="true"
                                    strokeWidth={2.2}
                                  />
                                </div>

                                <div className="relative">
                                  <select
                                    aria-label={`${selectedRecord.listTitle} 승인 권한 선택`}
                                    data-component="system-admin-pending-approval-role-select"
                                    value={selectedPendingRole}
                                    disabled={isPendingApprovalActionRunning}
                                    onChange={(event) =>
                                      setPendingRoleSelections((previousSelections) => ({
                                        ...previousSelections,
                                        [pendingAccountApproval.userId]: event.target.value,
                                      }))
                                    }
                                    className="h-9 appearance-none rounded-full border border-v3-border bg-white pl-3 pr-8 text-sm text-v3-dark disabled:opacity-50"
                                  >
                                    {REGISTERABLE_ROLE_OPTIONS.map((option) => (
                                      <option key={option.value} value={option.value}>
                                        {option.label}
                                      </option>
                                    ))}
                                  </select>
                                  <ChevronDown
                                    className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-v3-text-muted"
                                    aria-hidden="true"
                                    strokeWidth={2.2}
                                  />
                                </div>

                                {isPendingRoleAdmin ? (
                                  <div className="relative">
                                    <select
                                      aria-label={`${selectedRecord.listTitle} 임명 지점 선택`}
                                      data-component="system-admin-pending-approval-owner-branch-select"
                                      value={selectedPendingOwnerBranchId}
                                      disabled={isPendingApprovalActionRunning}
                                      onChange={(event) =>
                                        setPendingOwnerBranchSelections((previousSelections) => ({
                                          ...previousSelections,
                                          [pendingAccountApproval.userId]: event.target.value,
                                        }))
                                      }
                                      className="h-9 appearance-none rounded-full border border-v3-border bg-white pl-3 pr-8 text-sm text-v3-dark disabled:opacity-50"
                                    >
                                      <option value="">임명 지점 선택</option>
                                      {systemAdminBranchRequests
                                        .filter((branch) => branch.isActive && !branch.owner)
                                        .map((branch) => (
                                          <option key={branch.id} value={branch.id}>
                                            {branch.name}
                                          </option>
                                        ))}
                                    </select>
                                    <ChevronDown
                                      className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-v3-text-muted"
                                      aria-hidden="true"
                                      strokeWidth={2.2}
                                    />
                                  </div>
                                ) : null}

                                <Button
                                  type="button"
                                  size="sm"
                                  variant="positive"
                                  disabled={
                                    isPendingApprovalActionRunning ||
                                    !selectedPendingBranchId ||
                                    (isPendingRoleAdmin && !selectedPendingOwnerBranchId)
                                  }
                                  onClick={() =>
                                    approveUserMutation.mutate({
                                      id: pendingAccountApproval.userId,
                                      role: selectedPendingRole,
                                      branchId: selectedPendingBranchId,
                                      ...(isPendingRoleAdmin
                                        ? { ownerBranchId: selectedPendingOwnerBranchId }
                                        : {}),
                                    })
                                  }
                                >
                                  {approveUserMutation.isPending &&
                                  approveUserMutation.variables?.id ===
                                    pendingAccountApproval.userId
                                    ? "승인 중…"
                                    : "승인"}
                                </Button>

                                <Button
                                  type="button"
                                  size="sm"
                                  variant="negative-outline"
                                  disabled={isPendingApprovalActionRunning}
                                  onClick={() =>
                                    rejectUserMutation.mutate(pendingAccountApproval.userId)
                                  }
                                >
                                  {rejectUserMutation.isPending &&
                                  rejectUserMutation.variables === pendingAccountApproval.userId
                                    ? "거절 중…"
                                    : "거절"}
                                </Button>
                              </div>

                              {approveUserMutation.isError &&
                              approveUserMutation.variables?.id ===
                                pendingAccountApproval.userId ? (
                                <p role="alert" className="text-sm text-destructive">
                                  승인 처리에 실패했습니다. 잠시 후 다시 시도해 주세요.
                                </p>
                              ) : null}
                              {rejectUserMutation.isError &&
                              rejectUserMutation.variables === pendingAccountApproval.userId ? (
                                <p role="alert" className="text-sm text-destructive">
                                  거절 처리에 실패했습니다. 잠시 후 다시 시도해 주세요.
                                </p>
                              ) : null}
                            </div>
                          ) : null}
                          {approveAction ? (
                            <div className="space-y-2">
                              <Button
                                type="button"
                                size="md"
                                variant="positive"
                                className="w-full sm:w-auto sm:min-w-40"
                                disabled={approveMessageSenderMutation.isPending}
                                onClick={() =>
                                  approveMessageSenderMutation.mutate(approveAction.branchId)
                                }
                              >
                                {approveMessageSenderMutation.isPending ? "승인 중…" : "승인"}
                              </Button>
                              {approveMessageSenderMutation.error ? (
                                <p role="alert" className="text-sm text-destructive">
                                  승인 처리에 실패했습니다. 잠시 후 다시 시도해 주세요.
                                </p>
                              ) : null}
                            </div>
                          ) : null}
                        </section>
                      );
                    })}
                  </div>
                )}
              </DetailPanel>
            ) : (
              <DetailPanel data-component="desktop_system-admin_split-layout_detail-panel-3"
                avatar={
                  <div
                    className={cn(
                      "flex h-12 w-12 shrink-0 items-center justify-center rounded-[16px]",
                      SECTION_ICON_CLASSNAMES[activeSection.id],
                    )}
                  >
                    <activeSection.icon className="h-5 w-5" aria-hidden="true" />
                  </div>
                }
                title={activeSection.listTitle}
                subtitle={activeSection.detailEmptyMessage}
                overlay={
                  <DetailEmptyState
                    name="system-admin-detail-empty"
                    icon={activeSection.icon}
                    message={activeSection.detailEmptyMessage}
                    className="min-h-0 flex-none"
                  />
                }
              >
                {null}
              </DetailPanel>
            )}
          </SplitLayout>
        </div>
      </div>
    </PageSection>
  );
}
