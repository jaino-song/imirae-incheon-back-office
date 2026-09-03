import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { MessageTriggerList } from "../MessageTriggerList";
import {
  useMessageTriggerRules,
  useUpdateMessageTriggerRuleBranchActivation,
  useUpdateMessageTriggerRule,
} from "@/features/message-triggers/hooks/use-message-triggers";
import type { MessageTriggerRule } from "@/features/message-triggers/types";
import { fetchAllMessageLogs } from "@/lib/messages/logs";

jest.mock("@/features/message-triggers/hooks/use-message-triggers", () => ({
  useMessageTriggerRules: jest.fn(),
  useUpdateMessageTriggerRuleBranchActivation: jest.fn(),
  useUpdateMessageTriggerRule: jest.fn(),
}));

jest.mock("@/lib/messages/logs", () => ({
  fetchAllMessageLogs: jest.fn(),
}));

const mockUseMessageTriggerRules = useMessageTriggerRules as jest.Mock;
const mockUseUpdateMessageTriggerRule = useUpdateMessageTriggerRule as jest.Mock;
const mockUseUpdateMessageTriggerRuleBranchActivation = useUpdateMessageTriggerRuleBranchActivation as jest.Mock;
const mockFetchAllMessageLogs = fetchAllMessageLogs as jest.Mock;

function createRule(overrides: Partial<MessageTriggerRule> = {}): MessageTriggerRule {
  return {
    id: "rule-start",
    branchId: "branch-1",
    name: "실제 서비스 시작 규칙",
    isActive: true,
    eventType: "SERVICE_START",
    offsetType: "BEFORE_DAYS",
    offsetDays: 1,
    recipientType: "CLIENT",
    templateKey: "SERVICE_START_REMINDER",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    ...overrides,
  };
}

function currentMonthIso(day = 5) {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), day, 9, 0, 0).toISOString();
}

function previousMonthIso() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() - 1, 5, 9, 0, 0).toISOString();
}

function monthLabel() {
  return new Intl.DateTimeFormat("ko-KR", { month: "numeric" }).format(new Date());
}

function renderPage(onEdit?: (rule: MessageTriggerRule) => void) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MessageTriggerList data-component="mobile_messages_triggers_test_list" onEdit={onEdit} />
    </QueryClientProvider>,
  );
}

describe("MessageTriggerList", () => {
  const updateMutate = jest.fn();
  const branchActivationMutate = jest.fn();

  beforeEach(() => {
    updateMutate.mockClear();
    mockFetchAllMessageLogs.mockResolvedValue([]);
    mockUseUpdateMessageTriggerRule.mockReturnValue({
      isPending: false,
      mutate: updateMutate,
    });
    mockUseUpdateMessageTriggerRuleBranchActivation.mockReturnValue({
      isPending: false,
      mutate: branchActivationMutate,
    });
    mockUseMessageTriggerRules.mockReturnValue({
      data: [],
      isError: false,
      isLoading: false,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("renders only actual trigger rules instead of fallback rows", async () => {
    mockUseMessageTriggerRules.mockReturnValue({
      data: [createRule()],
      isError: false,
      isLoading: false,
    });
    mockFetchAllMessageLogs.mockResolvedValue([
      {
        id: 1,
        templateKey: "SERVICE_START_REMINDER",
        status: "sent",
        createdAt: currentMonthIso(5),
        ruleId: "rule-start",
        ruleName: "실제 서비스 시작 규칙",
        eventType: "SERVICE_START",
      },
      {
        id: 2,
        templateKey: "SERVICE_START_REMINDER",
        status: "failed",
        createdAt: currentMonthIso(6),
        ruleId: "rule-start",
        ruleName: "실제 서비스 시작 규칙",
        eventType: "SERVICE_START",
      },
      {
        id: 3,
        templateKey: "CLIENT_WELCOME",
        status: "sent",
        createdAt: currentMonthIso(6),
        ruleId: "rule-client",
        ruleName: "다른 규칙",
        eventType: "CLIENT_CREATED",
      },
      {
        id: 4,
        templateKey: "SERVICE_START_REMINDER",
        status: "sent",
        createdAt: previousMonthIso(),
        ruleId: "rule-start",
        ruleName: "실제 서비스 시작 규칙",
        eventType: "SERVICE_START",
      },
    ]);

    renderPage();

    expect(screen.queryByText("신규 고객 인사 SMS")).not.toBeInTheDocument();
    expect(screen.getByText("실제 서비스 시작 규칙")).toBeInTheDocument();
    expect(screen.queryByText("고객 등록 환영")).not.toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText(`${monthLabel()} 2건`)).toBeInTheDocument();
    });
    expect(screen.getByText("서비스 시작 1일 전 · 고객")).toBeInTheDocument();
    expect(
      document.querySelector(
        '[data-component="mobile_messages_triggers_test_list_meta"]',
      ),
    ).toHaveTextContent(`${monthLabel()} 2건 · 서비스 시작 1일 전 · 고객 · SMS`);
  });

  it("updates the selected real rule when the toggle row is pressed", async () => {
    mockUseMessageTriggerRules.mockReturnValue({
      data: [createRule({ isActive: true })],
      isError: false,
      isLoading: false,
    });

    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /실제 서비스 시작 규칙/ }));

    expect(updateMutate).toHaveBeenCalledWith({
      id: "rule-start",
      dto: { isActive: false },
    });
  });

  it("uses branch activation for global rules without sending the content DTO", async () => {
    mockUseMessageTriggerRules.mockReturnValue({
      data: [createRule({ id: "global-rule", branchId: null, isActive: true })],
      isError: false,
      isLoading: false,
    });

    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /실제 서비스 시작 규칙/ }));

    expect(branchActivationMutate).toHaveBeenCalledWith({
      id: "global-rule",
      dto: { isActive: false },
    });
    expect(updateMutate).not.toHaveBeenCalled();
  });

  it("disables a global-locked rule toggle", async () => {
    mockUseMessageTriggerRules.mockReturnValue({
      data: [createRule({ branchId: null, isLockedByGlobal: true })],
      isError: false,
      isLoading: false,
    });

    renderPage();

    expect(await screen.findByRole("button", { name: /실제 서비스 시작 규칙/ })).toBeDisabled();
  });

  it("separates rule editing from the active toggle in management mode", async () => {
    const onEdit = jest.fn();
    const rule = createRule({ isActive: true });
    mockUseMessageTriggerRules.mockReturnValue({ data: [rule], isError: false, isLoading: false });

    renderPage(onEdit);

    fireEvent.click(await screen.findByRole("button", { name: "실제 서비스 시작 규칙 설정" }));
    expect(onEdit).toHaveBeenCalledWith(rule);
    expect(updateMutate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "실제 서비스 시작 규칙 비활성화" }));
    expect(updateMutate).toHaveBeenCalledWith({ id: "rule-start", dto: { isActive: false } });
  });

  it("renders the service information trigger seven days before service start", async () => {
    mockUseMessageTriggerRules.mockReturnValue({
      data: [
        createRule({
          id: "rule-service-info",
          name: "서비스 시작 7일 전 서비스 안내",
          offsetDays: 7,
          templateKey: "SERVICE_INFO",
        }),
      ],
      isError: false,
      isLoading: false,
    });

    renderPage();

    expect(screen.getByText("서비스 시작 7일 전 서비스 안내")).toBeInTheDocument();
    expect(screen.getByText("서비스 시작 7일 전 · 고객")).toBeInTheDocument();
    const serviceInfoRow = screen.getByRole("button", { name: /서비스 시작 7일 전 서비스 안내/ });
    expect(serviceInfoRow).toHaveAttribute("data-trigger-channel", "SMS");
    expect(serviceInfoRow.querySelector('[data-component="mobile_messages_triggers_test_list_icon"]'))
      .toHaveClass("trigger-icon-primary");
    expect(serviceInfoRow.querySelector("svg")).toHaveClass("lucide-message-square-text");
  });

  it("shows an empty state when no real trigger rule exists", () => {
    renderPage();

    expect(screen.getByText("등록된 자동 전송 트리거가 없습니다.")).toBeInTheDocument();
  });
});
