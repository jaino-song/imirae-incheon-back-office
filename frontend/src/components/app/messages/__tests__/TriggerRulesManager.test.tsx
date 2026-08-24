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
          "data-component": "desktop_v3_tests_split-layout",
          "data-slot": "split-layout",
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
  systemTemplate?: {
    id: string;
    templateKey: string;
    content: string;
    customVariables: Array<{ key: string; label: string; required: boolean }>;
    requiredVariables: Array<{ key: string; label: string; required: boolean; type: string }>;
    updatedAt: string;
  };
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
  systemTemplate,
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

    if (queryKey.includes("system-templates")) {
      return useQueryResult(systemTemplate);
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
    const { container } = render(<TriggerRulesManager dataComponent="desktop_messages_sections_section-content_triggers-section_trigger-rules" />);

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

    const { container } = render(<TriggerRulesManager dataComponent="desktop_messages_sections_section-content_triggers-section_trigger-rules" />);

    expect(screen.getByRole("button", { name: "새 규칙" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "활성화" })).toBeEnabled();
    expect(container.querySelector('[data-slot="list-panel-disabled-overlay"]')).not.toBeInTheDocument();
    expect(
      screen.queryByText("메시지 발송 승인 후에 설정 가능합니다. 설정에서 메시지 발송 기능을 신청해 주세요."),
    ).not.toBeInTheDocument();
  });

  it("does not preselect the first rule in compact split layout", async () => {
    mockSettingsQueries({ providerEnabled: false, senderApproved: true });

    const { container } = render(<TriggerRulesManager dataComponent="desktop_messages_sections_section-content_triggers-section_trigger-rules" />);
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });

    expect(
      await screen.findByText("왼쪽 목록에서 SMS 규칙을 선택하거나 새 규칙을 만들어 주세요."),
    ).toBeInTheDocument();
    expect(screen.queryByText("규칙 활성화")).not.toBeInTheDocument();
    expect(container.querySelector('[data-slot="split-layout"]')).toHaveAttribute("data-has-selection", "false");
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

    render(<TriggerRulesManager dataComponent="desktop_messages_sections_section-content_triggers-section_trigger-rules" channel="sms" />);

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

  it("preserves a dedicated service-record rule while editing its name", async () => {
    mockSettingsQueries({
      providerEnabled: true,
      senderApproved: true,
      systemTemplate: {
        id: "template-service-record-link",
        templateKey: "SERVICE_RECORD_LINK",
        content: "{{employeeName}}님 {{serviceRecordUrl}}",
        customVariables: [],
        requiredVariables: [
          { key: "employeeName", label: "제공인력명", required: true, type: "string" },
          { key: "serviceRecordUrl", label: "제공기록지 링크", required: true, type: "string" },
        ],
        updatedAt: "2026-08-24T00:00:00.000Z",
      },
    });
    const mutateAsync = jest.fn().mockResolvedValue(undefined);
    mockedUseUpdateMessageTriggerRule.mockReturnValue({
      isPending: false,
      mutateAsync,
    } as unknown as ReturnType<typeof useUpdateMessageTriggerRule>);
    mockedUseMessageTriggerRules.mockReturnValue({
      data: [
        {
          id: "system:service-record-link",
          branchId: "org-1",
          name: "제공기록지 전송 자동화 규칙",
          isActive: true,
          eventType: "SERVICE_START",
          offsetType: "SAME_DAY",
          offsetDays: 0,
          recipientType: "PRIMARY_EMPLOYEE",
          templateKey: "SERVICE_RECORD_LINK",
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
          providers: { sms: { templateKey: "SERVICE_INFO" } },
        },
      ],
    } as unknown as ReturnType<typeof useMessageTriggerTemplates>);

    render(<TriggerRulesManager dataComponent="desktop_messages_sections_section-content_triggers-section_trigger-rules" />);
    fireEvent.click(screen.getByText("제공기록지 전송 자동화 규칙"));

    const nameInput = await screen.findByLabelText("규칙 이름");
    expect(screen.getByLabelText("이벤트 기준")).toBeDisabled();
    expect(screen.getByLabelText("발송 시점")).toBeDisabled();
    expect(screen.getByLabelText("수신 대상")).toBeDisabled();
    expect(screen.getByLabelText("발송 템플릿")).toBeDisabled();
    expect(screen.getByLabelText("이벤트 기준")).toHaveTextContent("서비스 시작");
    expect(screen.getByLabelText("발송 시점")).toHaveTextContent("시작 당일");
    expect(screen.getByLabelText("수신 대상")).toHaveTextContent("주 담당 직원");
    expect(screen.getByLabelText("발송 템플릿")).toHaveTextContent("제공기록지 작성 링크");
    expect(screen.getByText("제공인력명")).toBeInTheDocument();
    expect(screen.getByText("제공기록지 링크")).toBeInTheDocument();

    fireEvent.change(nameInput, { target: { value: "제공기록지 링크 발송" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    expect(mutateAsync).toHaveBeenCalledWith({
      id: "system:service-record-link",
      dto: {
        name: "제공기록지 링크 발송",
        isActive: true,
        eventType: "SERVICE_START",
        offsetType: "SAME_DAY",
        offsetDays: 0,
        recipientType: "PRIMARY_EMPLOYEE",
        templateKey: "SERVICE_RECORD_LINK",
      },
    });
  });

  it("shows every required auto-filled variable for the selected template", async () => {
    mockSettingsQueries({ providerEnabled: true, senderApproved: true });
    mockedUseMessageTriggerTemplates.mockReturnValue({
      data: [
        {
          key: "PRICE_INFO",
          name: "비용 안내",
          description: "고객에게 비용과 입금 계좌를 안내합니다.",
          allowedEventTypes: ["SERVICE_START"],
          allowedRecipientTypes: ["CLIENT"],
          requiredVariables: [
            { key: "name", label: "산모님 성함" },
            { key: "weeks", label: "주수" },
            { key: "duration", label: "이용일수" },
            { key: "type", label: "바우처 유형" },
            { key: "fullPrice", label: "총 금액" },
            { key: "grant", label: "정부지원금" },
            { key: "actualPrice", label: "본인부담금" },
            { key: "bankName", label: "입금 은행" },
            { key: "accNum", label: "계좌번호" },
          ],
          providers: { sms: { templateKey: "PRICE_INFO" } },
        },
      ],
    } as unknown as ReturnType<typeof useMessageTriggerTemplates>);

    render(<TriggerRulesManager dataComponent="desktop_messages_sections_section-content_triggers-section_trigger-rules" />);
    fireEvent.click(screen.getByRole("button", { name: "새 규칙" }));

    expect(await screen.findByText("필수 자동 입력 정보")).toBeInTheDocument();
    for (const label of [
      "산모님 성함",
      "주수",
      "이용일수",
      "바우처 유형",
      "총 금액",
      "정부지원금",
      "본인부담금",
      "입금 은행",
      "계좌번호",
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText(/고객 정보에서 자동으로 입력/)).toBeInTheDocument();
    expect(screen.getByText(/관할 지역과 계좌 정보/)).toBeInTheDocument();
  });

  it("creates a valid catalog-backed rule from the new-rule form", async () => {
    mockSettingsQueries({ providerEnabled: true, senderApproved: true });
    const mutateAsync = jest.fn().mockResolvedValue({ id: "rule-created" });
    mockedUseCreateMessageTriggerRule.mockReturnValue({
      isPending: false,
      mutateAsync,
    } as unknown as ReturnType<typeof useCreateMessageTriggerRule>);

    render(<TriggerRulesManager dataComponent="desktop_messages_sections_section-content_triggers-section_trigger-rules" />);
    fireEvent.click(screen.getByRole("button", { name: "새 규칙" }));
    fireEvent.change(screen.getByLabelText("규칙 이름"), {
      target: { value: "서비스 시작 7일 전 안내" },
    });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    expect(mutateAsync).toHaveBeenCalledWith({
      name: "서비스 시작 7일 전 안내",
      isActive: true,
      eventType: "SERVICE_START",
      offsetType: "BEFORE_DAYS",
      offsetDays: 7,
      recipientType: "CLIENT",
      templateKey: "SERVICE_INFO",
    });
  });

  it("blocks an automation rule when a required custom variable has no automatic source", async () => {
    mockSettingsQueries({
      providerEnabled: true,
      senderApproved: true,
      systemTemplate: {
        id: "template-service-info",
        templateKey: "SERVICE_INFO",
        content: "{{name}} 산모님 예약번호 {{reservationCode}}",
        customVariables: [{ key: "reservationCode", label: "예약번호", required: true }],
        requiredVariables: [{ key: "name", label: "산모님 성함", required: true, type: "string" }],
        updatedAt: "2026-08-24T00:00:00.000Z",
      },
    });

    render(<TriggerRulesManager dataComponent="desktop_messages_sections_section-content_triggers-section_trigger-rules" />);
    fireEvent.click(screen.getByRole("button", { name: "새 규칙" }));
    fireEvent.change(screen.getByLabelText("규칙 이름"), {
      target: { value: "예약번호가 필요한 규칙" },
    });

    expect(await screen.findByText(/자동 입력 출처가 없는 필수 변수/)).toHaveTextContent("예약번호");
    expect(screen.getByRole("button", { name: "저장" })).toBeDisabled();
  });
});
