import type {
  MessageAutomationPolicy,
  MessageSenderApprovalResponse,
} from "@babyjamjam/shared/types/message";
import {
  Building2,
  CalendarClock,
  History,
  Repeat2,
  ShieldCheck,
  UserPlus,
} from "lucide-react";

import {
  buildSettingsListItems,
  CLIENT_REGISTRATION_POLICY_ITEM_ID,
  DUPLICATE_SEND_POLICY_ITEM_ID,
  DUPLICATE_SEND_ROWS,
  getAutomationPolicyIcon,
  getOrderedTriggerRules,
  TENANT_APPLICATION_ITEM_ID,
} from "../settings-items";

const unapproved: MessageSenderApprovalResponse = {
  approvalStatus: "not_requested",
  isApproved: false,
  canRequest: true,
  requestedAt: null,
  approvedAt: null,
};

const approved: MessageSenderApprovalResponse = {
  ...unapproved,
  approvalStatus: "approved",
  isApproved: true,
};

const policies: MessageAutomationPolicy[] = [
  {
    id: "service-feedback-link",
    title: "제공기록지 링크",
    description: "서비스 종료 후 링크를 전송합니다.",
    active: true,
    requiresApproval: true,
    rows: [{ id: "timing", label: "시점", value: "서비스 종료 후" }],
  },
  {
    id: "custom-policy",
    title: "기타 정책",
    description: "기타 자동화 정책입니다.",
    active: false,
    requiresApproval: false,
    rows: [],
  },
];

describe("buildSettingsListItems", () => {
  it("includes the tenant application only for a known unapproved state", () => {
    const unapprovedItems = buildSettingsListItems({ approval: unapproved, policies: [] });
    const approvedItems = buildSettingsListItems({ approval: approved, policies: [] });
    const unknownItems = buildSettingsListItems({ approval: undefined, policies: [] });

    expect(unapprovedItems[0]).toMatchObject({
      id: TENANT_APPLICATION_ITEM_ID,
      title: "메시지 발송 기능 신청",
      subtitle: "알리고 정책 동의 후 신청해 주세요.",
      statusLabel: "작성 중",
      icon: Building2,
      kind: "tenant-application",
    });
    expect(approvedItems.some((item) => item.id === TENANT_APPLICATION_ITEM_ID)).toBe(false);
    expect(unknownItems.some((item) => item.id === TENANT_APPLICATION_ITEM_ID)).toBe(false);
  });

  it("keeps API policy order before client registration and duplicate-send items", () => {
    const items = buildSettingsListItems({ approval: unapproved, policies });

    expect(items.map((item) => item.id)).toEqual([
      TENANT_APPLICATION_ITEM_ID,
      "service-feedback-link",
      "custom-policy",
      CLIENT_REGISTRATION_POLICY_ITEM_ID,
      DUPLICATE_SEND_POLICY_ITEM_ID,
    ]);
    expect(items[1]).toMatchObject({
      title: policies[0].title,
      subtitle: policies[0].description,
      active: true,
      requiresApproval: true,
      rows: policies[0].rows,
    });
    expect(items[3]).toMatchObject({
      title: "고객 자동 등록",
      icon: UserPlus,
      active: true,
      statusLabel: "활성",
    });
    expect(items[4]).toMatchObject({
      title: "중복 전송 확인",
      icon: Repeat2,
      active: true,
      rows: DUPLICATE_SEND_ROWS,
    });
  });
});

describe("getAutomationPolicyIcon", () => {
  it.each([
    ["service-feedback-link", CalendarClock],
    ["past-trigger", History],
    ["sms-retry", Repeat2],
    ["unknown-policy", ShieldCheck],
  ])("maps %s to the expected icon", (policyId, expectedIcon) => {
    expect(getAutomationPolicyIcon(policyId)).toBe(expectedIcon);
  });
});

describe("getOrderedTriggerRules", () => {
  it("orders known ids first, ignores stale ids, and appends missing rules", () => {
    const rules = [
      { id: "a", label: "A" },
      { id: "b", label: "B" },
      { id: "c", label: "C" },
    ];

    expect(getOrderedTriggerRules(rules, ["stale", "c", "a", "missing"])).toEqual([
      rules[2],
      rules[0],
      rules[1],
    ]);
  });
});
