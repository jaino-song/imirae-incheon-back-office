import type { ComponentProps } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { Building2, Repeat2, ShieldCheck } from "lucide-react";

import { SettingsList } from "../SettingsList";
import type { SettingsListItem } from "../settings-items";

const ITEMS: SettingsListItem[] = [
  {
    id: "current-tenant",
    title: "메시지 발송 기능 신청",
    subtitle: "신청 상태를 확인합니다.",
    statusLabel: "접수됨",
    icon: Building2,
    kind: "tenant-application",
    active: true,
    requiresApproval: true,
  },
  {
    id: "approval-policy",
    title: "승인 필요 정책",
    subtitle: "발송 승인 후 동작합니다.",
    statusLabel: "활성",
    icon: ShieldCheck,
    kind: "automation-policy",
    active: true,
    requiresApproval: true,
  },
  {
    id: "always-policy",
    title: "항상 활성 정책",
    subtitle: "발송 승인과 관계없이 동작합니다.",
    statusLabel: "활성",
    icon: Repeat2,
    kind: "client-registration-policy",
    active: true,
    requiresApproval: false,
  },
];

const DEFAULT_PROPS: ComponentProps<typeof SettingsList> = {
  "data-component": "mobile_messages_settings_list",
  items: ITEMS,
  selectedId: null,
  onSelect: jest.fn(),
  isLoading: false,
  isApproved: false,
};

function renderList(overrides: Partial<ComponentProps<typeof SettingsList>> = {}) {
  const props = { ...DEFAULT_PROPS, ...overrides };
  return {
    ...render(<SettingsList {...props} />),
    props,
  };
}

describe("SettingsList", () => {
  it("shows the item count and every item title", () => {
    renderList();

    expect(screen.getByText("3개")).toBeInTheDocument();
    for (const item of ITEMS) {
      expect(screen.getByText(item.title)).toBeInTheDocument();
    }
  });

  it("shows a tenant status pill and read-only switches with approval-aware state", () => {
    const { rerender, props } = renderList();

    expect(screen.getByText("접수됨")).toBeInTheDocument();
    expect(
      screen.queryByRole("switch", { name: "메시지 발송 기능 신청 활성화" }),
    ).not.toBeInTheDocument();

    const approvalSwitch = screen.getByRole("switch", { name: "승인 필요 정책 활성화" });
    const alwaysSwitch = screen.getByRole("switch", { name: "항상 활성 정책 활성화" });

    expect(approvalSwitch).not.toBeChecked();
    expect(alwaysSwitch).toBeChecked();
    for (const readOnlySwitch of screen.getAllByRole("switch")) {
      expect(readOnlySwitch).toBeDisabled();
    }

    rerender(<SettingsList {...props} isApproved />);

    expect(screen.getByRole("switch", { name: "승인 필요 정책 활성화" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "항상 활성 정책 활성화" })).toBeChecked();
  });

  it("shows four skeleton rows instead of item rows while loading", () => {
    const { container } = renderList({ isLoading: true });

    const skeleton = container.querySelector(
      '[data-source-component="ListRowsSkeleton"]',
    );
    expect(skeleton).toBeInTheDocument();
    expect(skeleton?.querySelectorAll('[aria-hidden="true"]')).toHaveLength(4);
    expect(screen.queryByText(ITEMS[0].title)).not.toBeInTheDocument();
  });

  it("shows a policies error and retries on request", () => {
    const onRetryPolicies = jest.fn();
    renderList({ policiesError: true, onRetryPolicies });

    expect(
      screen.getByText("자동 전송 정책을 불러오지 못했습니다"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "재시도" }));

    expect(onRetryPolicies).toHaveBeenCalledTimes(1);
  });

  it("selects an item when its row is clicked", () => {
    const onSelect = jest.fn();
    renderList({ onSelect });

    const row = screen.getByRole("button", { name: /승인 필요 정책/ });
    expect(row).not.toHaveAttribute("aria-pressed");
    fireEvent.click(row);

    expect(onSelect).toHaveBeenCalledWith("approval-policy");
  });
});
