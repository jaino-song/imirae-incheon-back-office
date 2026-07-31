import {
  BarChart3,
  Bell,
  Calendar,
  Calculator,
  File,
  FileText,
  MessageCircle,
  MessageSquareText,
  Send,
  UserCheck,
  User,
  Users,
  type LucideIcon,
} from "lucide-react";

export interface DashboardAnalytic {
  label: string;
  value: string;
  tone: "primary" | "orange" | "green" | "burgundy";
  icon: LucideIcon;
  urgent?: boolean;
}

export interface ListRow {
  id?: string | number;
  name: string;
  meta: string;
  initial: string;
  badge: string;
  badgeTone: "primary" | "green" | "burgundy" | "orange" | "muted";
  badges?: Array<{ label: string; tone: ListRow["badgeTone"] }>;
  due?: string;
  dueSub?: string;
  dueTone?: "urgent" | "soon";
  avatarTone?: "primary" | "green" | "burgundy" | "orange" | "purple";
  onClick?: () => void;
}

export interface SectionRows {
  title: string;
  rows: ListRow[];
}

export interface ContractRow {
  id?: string | number;
  name: string;
  meta: string;
  badge: string;
  badgeTone: "primary" | "green" | "muted";
  iconTone: "primary" | "green" | "muted";
  onClick?: () => void;
}

export interface MenuRow {
  label: string;
  href: string;
  icon: LucideIcon;
  tone: "primary" | "green" | "burgundy" | "orange" | "purple" | "muted" | "gold";
  badge?: string;
  badgeLoading?: boolean;
  badgeSkeletonWidth?: string;
  value?: string;
  valueLoading?: boolean;
  valueSkeletonWidth?: string;
  disabled?: boolean;
  statusLabel?: string;
}

export interface MenuGroup {
  title: string;
  rows: MenuRow[];
}

export const dashboardAnalytics: DashboardAnalytic[] = [
  { label: "서비스 진행 중", value: "0", tone: "primary", icon: User },
  { label: "7일 내 시작 예정", value: "1", tone: "orange", icon: Calendar },
  { label: "검토 필요 문서", value: "2", tone: "green", icon: File, urgent: true },
  { label: "계약서 미완료", value: "3", tone: "burgundy", icon: Send },
];

export const dashboardSections: SectionRows[] = [
  {
    title: "조치 필요 · 2건",
    rows: [
      {
        name: "[더미] 정유진",
        meta: "A라1형 · 제공인력 미배정",
        initial: "[",
        badge: "교체 요청",
        badgeTone: "burgundy",
        due: "긴급",
        dueSub: "오늘",
        dueTone: "urgent",
        avatarTone: "burgundy",
      },
      {
        name: "이수현",
        meta: "A통합1형 · 계약서 검토 대기",
        initial: "이",
        badge: "검토 필요",
        badgeTone: "primary",
        due: "D-1",
        dueSub: "내일까지",
        dueTone: "urgent",
      },
    ],
  },
  {
    title: "시작 예정 · 1명",
    rows: [
      {
        name: "송진호",
        meta: "A통합1형 · 제공인력 미배정",
        initial: "송",
        badge: "대기",
        badgeTone: "muted",
        due: "D-5",
        dueSub: "5/14",
        dueTone: "soon",
      },
    ],
  },
  {
    title: "종료 예정 · 3명",
    rows: [
      {
        name: "박서연",
        meta: "A라1형 · 김민지",
        initial: "박",
        badge: "진행중",
        badgeTone: "primary",
        due: "D-4",
        dueSub: "~5/15",
        avatarTone: "green",
      },
      {
        name: "김도윤",
        meta: "B가1형 · 박지민",
        initial: "김",
        badge: "진행중",
        badgeTone: "primary",
        due: "D-11",
        dueSub: "~5/22",
      },
      {
        name: "최예린",
        meta: "A가2형 · 윤서아",
        initial: "최",
        badge: "진행중",
        badgeTone: "primary",
        due: "D-18",
        dueSub: "~5/29",
        avatarTone: "burgundy",
      },
    ],
  },
];

export const clientSections: SectionRows[] = [
  {
    title: "교체 요청 · 1명",
    rows: [
      {
        name: "[더미] 정유진",
        meta: "A라1형 · 제공인력 미배정",
        initial: "[",
        badge: "교체 요청",
        badgeTone: "burgundy",
        avatarTone: "burgundy",
      },
    ],
  },
  {
    title: "진행중 · 8명",
    rows: [
      {
        name: "박서연",
        meta: "A라1형 · 김민지",
        initial: "박",
        badge: "진행중",
        badgeTone: "primary",
        avatarTone: "green",
      },
      {
        name: "김도윤",
        meta: "B가1형 · 박지민",
        initial: "김",
        badge: "진행중",
        badgeTone: "primary",
      },
      {
        name: "최예린",
        meta: "A가2형 · 윤서아",
        initial: "최",
        badge: "진행중",
        badgeTone: "primary",
        avatarTone: "burgundy",
      },
      {
        name: "장하늘",
        meta: "A통합1형 · 이지은",
        initial: "장",
        badge: "진행중",
        badgeTone: "primary",
        avatarTone: "orange",
      },
    ],
  },
  {
    title: "대기 · 2명",
    rows: [
      { name: "송진호", meta: "A통합1형 · 제공인력 미배정", initial: "송", badge: "대기", badgeTone: "muted", avatarTone: "orange" },
      { name: "윤지아", meta: "B가1형 · 제공인력 미배정", initial: "윤", badge: "대기", badgeTone: "muted", avatarTone: "purple" },
    ],
  },
  {
    title: "완료 · 31명",
    rows: [
      { name: "이수현", meta: "일반형 · 박지영", initial: "이", badge: "완료", badgeTone: "green", avatarTone: "green" },
      { name: "강민서", meta: "D가2형 · 윤서아", initial: "강", badge: "완료", badgeTone: "green" },
    ],
  },
];

export const contractSections: Array<{ title: string; rows: ContractRow[] }> = [
  {
    title: "조치 필요 · 5건",
    rows: [
      { name: "이수현 · A통합1형", meta: "제공기관 검토 필요 · 5단계", badge: "검토 필요", badgeTone: "primary", iconTone: "primary" },
      { name: "[더미] 정유진 · A라1형", meta: "이용자 문서 열람 · 3단계", badge: "대기", badgeTone: "muted", iconTone: "muted" },
      { name: "송진호 · A통합1형", meta: "이용자 서명 완료 · 4단계", badge: "대기", badgeTone: "muted", iconTone: "muted" },
    ],
  },
  {
    title: "진행 중",
    rows: [
      { name: "박서연 · A라1형", meta: "제공기관 검토 필요 · 5단계", badge: "검토 필요", badgeTone: "primary", iconTone: "primary" },
    ],
  },
  {
    title: "완료 · 최근",
    rows: [
      { name: "김도윤 · B가1형", meta: "계약서 완료 · 6단계", badge: "완료", badgeTone: "green", iconTone: "green" },
      { name: "장하늘 · A통합1형", meta: "계약서 완료 · 6단계", badge: "완료", badgeTone: "green", iconTone: "green" },
    ],
  },
];

export const menuGroups: MenuGroup[] = [
  {
    title: "지점 관리",
    rows: [
      { label: "상담", href: "/consultations", icon: MessageCircle, tone: "burgundy", badge: "3" },
      { label: "고객", href: "/clients", icon: Users, tone: "primary", value: "42명" },
      { label: "제공인력", href: "/employees", icon: UserCheck, tone: "purple", value: "12명" },
      { label: "전자문서", href: "/contracts", icon: FileText, tone: "green" },
      { label: "일정 캘린더", href: "/employees/schedule", icon: Calendar, tone: "orange", disabled: true, statusLabel: "출시 예정" },
      { label: "통계 보고서", href: "/dashboard/analytics", icon: BarChart3, tone: "green", disabled: true, statusLabel: "출시 예정" },
    ],
  },
  {
    title: "서비스 관리",
    rows: [
      { label: "가격표", href: "/prices", icon: Calculator, tone: "orange" },
      { label: "메시지", href: "/messages", icon: MessageSquareText, tone: "primary", value: "36건" },
      { label: "발송 자동화", href: "/messages/automation", icon: Send, tone: "gold", disabled: true, statusLabel: "출시 예정" },
    ],
  },
  {
    title: "설정",
    rows: [
      { label: "알림 설정", href: "/notification", icon: Bell, tone: "muted", value: "활성" },
    ],
  },
];

export const chatMessages = [
  {
    role: "assistant",
    body: "안녕하세요 송진호 님. 인천점 운영을 돕는 AI 어시스턴트예요. 오늘 어떤 걸 도와드릴까요?",
    time: "오전 9:14",
  },
  {
    role: "user",
    body: "이번 주 시작 예정인 고객들의 제공인력 배정 현황 보여줘",
    time: "오전 9:15",
  },
  {
    role: "assistant",
    body: "이번 주(5/12-5/18) 시작 예정 고객은 총 3명입니다.\n\n· 송진호 (5/14, A통합1형) — 제공인력 미배정 ⚠\n· 윤지아 (5/21, B가1형) — 제공인력 미배정 ⚠\n· 박민수 (5/16, A라1형) — 김민지 매니저 배정됨 ✓\n\n미배정 2건은 시작일까지 D-3 이내라 우선 배정이 필요합니다.",
    time: "오전 9:15",
    sources: ["고객 · 8건", "제공인력 · 12명"],
  },
  {
    role: "user",
    body: "송진호 고객한테 가장 적합한 제공인력 추천해줘",
    time: "오전 9:16",
  },
  {
    role: "assistant",
    typing: true,
  },
];
