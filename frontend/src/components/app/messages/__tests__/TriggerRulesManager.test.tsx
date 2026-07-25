import { act, fireEvent, render, screen } from "@testing-library/react";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { TriggerRulesManager } from "../TriggerRulesManager";
import {
  useMessageTriggerRules,
  useMessageTriggerTemplates,
  useCreateMessageTriggerRule,
  useDeleteMessageTriggerRule,
  useUpdateMessageTriggerRule,
} from "@/features/message-triggers/hooks/use-message-triggers";

jest.mock("@tanstack/react-query", () => ({
  useQuery: jest.fn(),
}));

jest.mock("@/components/app/v3", () => {
  const React = jest.requireActual("react");
  const actual = jest.requireActual("@/components/app/v3");

  return {
    ...actual,
    SplitLayout: ({
      children,
      hasSelection,
      onBack,
      onModeChange,
    }: {
      children: ReactNode;
      hasSelection?: boolean;
      onBack?: () => void;
      onModeChange?: (mode: "desktop" | "compact") => void;
    }) => {
      React.useLayoutEffect(() => {
        onModeChange?.("compact");
      }, [onModeChange]);

      return React.createElement(
        "div",
        {
          "data-component": "split-layout",
          "data-mode": "compact",
          "data-has-selection": hasSelection ? "true" : "false",
        },
        hasSelection
          ? React.createElement(
              "button",
              {
                type: "button",
                onClick: onBack,
              },
              "목록으로 돌아가기",
            )
          : null,
        children,
      );
    },
  };
});

jest.mock("@/hooks/use-toast", () => ({
  useToast: () => ({
    toast: jest.fn(),
  }),
}));

jest.mock("@/features/message-triggers/hooks/use-message-triggers", () => ({
  useMessageTriggerRules: jest.fn(),
  useMessageTriggerTemplates: jest.fn(),
  useCreateMessageTriggerRule: jest.fn(),
  useUpdateMessageTriggerRule: jest.fn(),
  useDeleteMessageTriggerRule: jest.fn(),
}));

const mockedUseQuery = jest.mocked(useQuery);
const mockedUseMessageTriggerRules = jest.mocked(useMessageTriggerRules);
const mockedUseMessageTriggerTemplates = jest.mocked(useMessageTriggerTemplates);
const mockedUseCreateMessageTriggerRule = jest.mocked(useCreateMessageTriggerRule);
const mockedUseUpdateMessageTriggerRule = jest.mocked(useUpdateMessageTriggerRule);
const mockedUseDeleteMessageTriggerRule = jest.mocked(useDeleteMessageTriggerRule);

type QueryOptions = {
  queryKey?: readonly unknown[];
};

interface SettingsQueryState {
  providerEnabled?: boolean;
  senderApproved?: boolean;
}

function useQueryResult<TData>(data: TData, isLoading = false): ReturnType<typeof useQuery> {
  return {
    data,
    isLoading,
  } as unknown as ReturnType<typeof useQuery>;
}

function mockSettingsQueries({
  providerEnabled = false,
  senderApproved = false,
}: SettingsQueryState = {}) {
  mockedUseQuery.mockImplementation((options: QueryOptions) => {
    const queryKey = options.queryKey ?? [];

    if (queryKey.includes("message-sender-approval")) {
      return useQueryResult({
        approvalStatus: senderApproved ? "approved" : "not_requested",
        isApproved: senderApproved,
        canRequest: !senderApproved,
        requestedAt: null,
        approvedAt: senderApproved ? "2026-06-05T00:00:00.000Z" : null,
      });
    }

    return useQueryResult({
      provider: "sms",
      enabled: providerEnabled,
    });
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: 1200,
  });

  mockSettingsQueries();

  mockedUseMessageTriggerRules.mockReturnValue({
    data: [
      {
        id: "rule-1",
        branchId: "org-1",
        name: "서비스 시작 안내",
        isActive: true,
        eventType: "SERVICE_START",
        offsetType: "BEFORE_DAYS",
        offsetDays: 3,
        recipientType: "CLIENT",
        templateKey: "SERVICE_INFO",
        createdAt: "2026-03-01T00:00:00.000Z",
        updatedAt: "2026-03-01T00:00:00.000Z",
      },
    ],
    isLoading: false,
  } as unknown as ReturnType<typeof useMessageTriggerRules>);

  mockedUseMessageTriggerTemplates.mockReturnValue({
    data: [
      {
        key: "SERVICE_INFO",
        name: "서비스 안내",
        description: "서비스 시작 전에 안내합니다.",
        allowedEventTypes: ["SERVICE_START"],
        allowedRecipientTypes: ["CLIENT"],
        requiredVariables: [],
        providers: {
          sms: { templateKey: "SERVICE_INFO" },
        },
      },
    ],
  } as unknown as ReturnType<typeof useMessageTriggerTemplates>);

  mockedUseCreateMessageTriggerRule.mockReturnValue({
    isPending: false,
    mutateAsync: jest.fn(),
  } as unknown as ReturnType<typeof useCreateMessageTriggerRule>);

  mockedUseUpdateMessageTriggerRule.mockReturnValue({
    isPending: false,
    mutateAsync: jest.fn(),
  } as unknown as ReturnType<typeof useUpdateMessageTriggerRule>);

  mockedUseDeleteMessageTriggerRule.mockReturnValue({
    isPending: false,
    mutateAsync: jest.fn(),
  } as unknown as ReturnType<typeof useDeleteMessageTriggerRule>);
});

describe("TriggerRulesManager", () => {
  it("keeps the trigger detail panel empty and blocks the rules list before approval", () => {
    const { container } = render(<TriggerRulesManager />);

    expect(screen.queryByRole("button", { name: "새 규칙" })).not.toBeInTheDocument();

    const activeTab = screen.getByRole("button", { name: "활성화" });
    expect(activeTab).toBeDisabled();

    fireEvent.click(activeTab);

    expect(container.querySelector('[data-slot="list-panel-disabled-overlay"]')).toBeInTheDocument();
    expect(
      screen.getAllByText("메시지 발송 승인 후에 설정 가능합니다. 설정에서 메시지 발송 기능을 신청해 주세요."),
    ).toHaveLength(2);
    expect(container.querySelector('[data-slot="detail-panel-scroll-content"]')).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "알림톡 발송 신청하기" })).not.toBeInTheDocument();
  });

  it("keeps trigger rules available when message sending is approved even if provider settings are disabled", () => {
    mockSettingsQueries({ providerEnabled: false, senderApproved: true });

    const { container } = render(<TriggerRulesManager />);

    expect(screen.getByRole("button", { name: "새 규칙" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "활성화" })).toBeEnabled();
    expect(container.querySelector('[data-component="list-panel-disabled-overlay"]')).not.toBeInTheDocument();
    expect(
      screen.queryByText("메시지 발송 승인 후에 설정 가능합니다. 설정에서 메시지 발송 기능을 신청해 주세요."),
    ).not.toBeInTheDocument();
  });

  it("does not preselect the first rule in compact split layout", async () => {
    mockSettingsQueries({ providerEnabled: false, senderApproved: true });

    const { container } = render(<TriggerRulesManager />);
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });

    expect(
      await screen.findByText("왼쪽 목록에서 SMS 규칙을 선택하거나 새 규칙을 만들어 주세요."),
    ).toBeInTheDocument();
    expect(screen.queryByText("규칙 활성화")).not.toBeInTheDocument();
    expect(container.querySelector('[data-component="split-layout"]')).toHaveAttribute("data-has-selection", "false");
  });

  it("renders only automatic SMS template routines in the message auto-send channel", () => {
    mockSettingsQueries({ providerEnabled: false, senderApproved: true });
    mockedUseMessageTriggerRules.mockReturnValue({
      data: [
        {
          id: "rule-1",
          branchId: "org-1",
          name: "서비스 시작 안내",
          isActive: true,
          eventType: "SERVICE_START",
          offsetType: "BEFORE_DAYS",
          offsetDays: 3,
          recipientType: "CLIENT",
          templateKey: "SERVICE_START_REMINDER",
          createdAt: "2026-03-01T00:00:00.000Z",
          updatedAt: "2026-03-01T00:00:00.000Z",
        },
        {
          id: "sms-rule-1",
          branchId: "org-1",
          name: "서비스 안내 자동 전송",
          isActive: true,
          eventType: "SERVICE_START",
          offsetType: "BEFORE_DAYS",
          offsetDays: 7,
          recipientType: "CLIENT",
          templateKey: "SERVICE_INFO",
          createdAt: "2026-03-01T00:00:00.000Z",
          updatedAt: "2026-03-01T00:00:00.000Z",
        },
      ],
      isLoading: false,
    } as unknown as ReturnType<typeof useMessageTriggerRules>);
    mockedUseMessageTriggerTemplates.mockReturnValue({
      data: [
        {
          key: "SERVICE_START_REMINDER",
          name: "서비스 시작 리마인더",
          description: "서비스 시작 전에 안내합니다.",
          allowedEventTypes: ["SERVICE_START"],
          allowedRecipientTypes: ["CLIENT"],
          requiredVariables: [],
          providers: {
            sms: { templateKey: "SERVICE_START_REMINDER" },
          },
        },
        {
          key: "SERVICE_INFO",
          name: "서비스 안내",
          description: "서비스 정보를 SMS로 안내합니다.",
          allowedEventTypes: ["SERVICE_START"],
          allowedRecipientTypes: ["CLIENT"],
          requiredVariables: [],
          providers: {
            sms: { templateKey: "SERVICE_INFO" },
          },
        },
      ],
    } as unknown as ReturnType<typeof useMessageTriggerTemplates>);

    render(<TriggerRulesManager dataComponentPrefix="message" channel="sms" />);

    expect(screen.getByText("자동 전송 루틴")).toBeInTheDocument();
    expect(screen.getByText("메시지 템플릿을 자동으로 보내는 루틴만 관리합니다.")).toBeInTheDocument();
    expect(screen.getByText("서비스 안내 자동 전송")).toBeInTheDocument();
    expect(screen.queryByText("서비스 시작 안내")).not.toBeInTheDocument();
    expect(screen.queryByText("제공기록지 전송 자동화 규칙")).not.toBeInTheDocument();
    expect(screen.queryByText("SMS 재시도 규칙")).not.toBeInTheDocument();

    expect(screen.getByRole("switch", { name: "서비스 안내 자동 전송 활성화" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });
});
