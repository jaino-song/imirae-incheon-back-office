import type {
  MessageAutomationPolicy,
  MessageAutomationPolicyRow,
  MessageSenderApprovalResponse,
} from "@babyjamjam/shared/types/message";
import {
  Building2,
  CalendarClock,
  History,
  Repeat2,
  ShieldCheck,
  UserPlus,
  type LucideIcon,
} from "lucide-react";

export const DUPLICATE_SEND_POLICY_ITEM_ID = "duplicate-send-confirmation";
export const CLIENT_REGISTRATION_POLICY_ITEM_ID = "client-registration-policy";
export const TENANT_APPLICATION_ITEM_ID = "current-tenant";

const SERVICE_RECORD_LINK_POLICY_ID = "service-feedback-link";
const PAST_TRIGGER_POLICY_ID = "past-trigger";
const SMS_RETRY_POLICY_ID = "sms-retry";

export const DUPLICATE_SEND_ROWS: MessageAutomationPolicyRow[] = [
  { id: "condition", label: "조건", value: "같은 번호 · 같은 메시지" },
  { id: "window", label: "확인 범위", value: "최근 72시간" },
  { id: "behavior", label: "동작", value: "전송 전 확인 모달" },
];

export type SettingsListItem = {
  id: string;
  title: string;
  subtitle: string;
  statusLabel: string;
  icon: LucideIcon;
  kind:
    | "tenant-application"
    | "automation-policy"
    | "duplicate-send-policy"
    | "client-registration-policy";
  active: boolean;
  requiresApproval: boolean;
  rows?: MessageAutomationPolicyRow[];
};

export function getAutomationPolicyIcon(policyId: string): LucideIcon {
  if (policyId === SERVICE_RECORD_LINK_POLICY_ID) return CalendarClock;
  if (policyId === PAST_TRIGGER_POLICY_ID) return History;
  if (policyId === SMS_RETRY_POLICY_ID) return Repeat2;
  return ShieldCheck;
}

function getPolicyStatusLabel(active: boolean): string {
  return active ? "활성" : "비활성";
}

function formatRequestedAt(requestedAt: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(requestedAt));
}

export function buildSettingsListItems({
  approval,
  policies,
}: {
  approval: MessageSenderApprovalResponse | undefined;
  policies: MessageAutomationPolicy[] | undefined;
}): SettingsListItem[] {
  const items: SettingsListItem[] = [];

  if (approval && !approval.isApproved) {
    items.push({
      id: TENANT_APPLICATION_ITEM_ID,
      title: "메시지 발송 기능 신청",
      subtitle: approval.requestedAt
        ? `신청 접수 ${formatRequestedAt(approval.requestedAt)}`
        : "알리고 정책 동의 후 신청해 주세요.",
      statusLabel: approval.requestedAt ? "접수됨" : "작성 중",
      icon: Building2,
      kind: "tenant-application",
      active: true,
      requiresApproval: true,
    });
  }

  for (const policy of policies ?? []) {
    items.push({
      id: policy.id,
      title: policy.title,
      subtitle: policy.description,
      statusLabel: getPolicyStatusLabel(policy.active),
      icon: getAutomationPolicyIcon(policy.id),
      kind: "automation-policy",
      active: policy.active,
      requiresApproval: policy.requiresApproval,
      rows: policy.rows,
    });
  }

  items.push(
    {
      id: CLIENT_REGISTRATION_POLICY_ITEM_ID,
      title: "고객 자동 등록",
      subtitle: "전자문서 고객 등록과 인사 문자 발송을 관리합니다.",
      statusLabel: "활성",
      icon: UserPlus,
      kind: "client-registration-policy",
      active: true,
      requiresApproval: false,
    },
    {
      id: DUPLICATE_SEND_POLICY_ITEM_ID,
      title: "중복 전송 확인",
      subtitle: "72시간 내 같은 번호와 같은 메시지는 전송 전 확인합니다.",
      statusLabel: "활성",
      icon: Repeat2,
      kind: "duplicate-send-policy",
      active: true,
      requiresApproval: true,
      rows: DUPLICATE_SEND_ROWS,
    },
  );

  return items;
}

export function getOrderedTriggerRules<TRule extends { id: string }>(
  rules: TRule[],
  orderIds: string[],
): TRule[] {
  const rulesById = new Map(rules.map((rule) => [rule.id, rule]));
  const ordered = orderIds
    .map((id) => rulesById.get(id))
    .filter((rule): rule is TRule => Boolean(rule));
  const orderedIds = new Set(ordered.map((rule) => rule.id));
  const missing = rules.filter((rule) => !orderedIds.has(rule.id));

  return [...ordered, ...missing];
}
