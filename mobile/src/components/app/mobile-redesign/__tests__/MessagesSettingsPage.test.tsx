import type {
  MessageAutomationPoliciesResponse,
  MessageSenderApprovalResponse,
} from "@babyjamjam/shared/types/message";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { settingsApi } from "@/services/api";

import { MessagesSettingsPage } from "../MessagesSettingsPage";

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockToast = jest.fn();

const APPROVED: MessageSenderApprovalResponse = {
  approvalStatus: "approved",
  isApproved: true,
  canRequest: true,
  requestedAt: "2026-08-01T00:00:00.000Z",
  approvedAt: "2026-08-02T00:00:00.000Z",
};

const UNAPPROVED: MessageSenderApprovalResponse = {
  approvalStatus: "not_requested",
  isApproved: false,
  canRequest: true,
  requestedAt: null,
  approvedAt: null,
};

const POLICIES: MessageAutomationPoliciesResponse = {
  policies: [
    {
      id: "trigger-dispatch",
      title: "자동 전송 실행",
      description: "등록된 자동 전송 규칙을 실행합니다.",
      active: true,
      requiresApproval: true,
      rows: [
        { id: "target", label: "전송 대상", value: "승인된 자동 전송 규칙" },
        { id: "schedule", label: "실행 시점", value: "설정된 예약 시각" },
        { id: "status", label: "상태", value: "활성" },
      ],
    },
    {
      id: "trigger-job-retry",
      title: "자동 전송 재시도",
      description: "실패한 자동 전송을 다시 시도합니다.",
      active: true,
      requiresApproval: true,
      rows: [
        { id: "attempts", label: "재시도 횟수", value: "3회" },
        { id: "interval", label: "재시도 간격", value: "5분" },
        { id: "target", label: "대상", value: "실패한 메시지" },
        { id: "status", label: "상태", value: "활성" },
      ],
    },
    {
      id: "sms-retry",
      title: "SMS 재시도",
      description: "실패한 SMS를 재시도합니다.",
      active: false,
      requiresApproval: true,
      rows: [
        { id: "attempts", label: "재시도 횟수", value: "1회" },
        { id: "channel", label: "채널", value: "SMS" },
        { id: "status", label: "상태", value: "비활성" },
      ],
    },
    {
      id: "past-trigger",
      title: "지난 자동 전송 처리",
      description: "지나간 자동 전송의 처리 방식을 관리합니다.",
      active: true,
      requiresApproval: true,
      rows: [
        { id: "behavior", label: "동작", value: "순차 발송" },
        { id: "interval", label: "간격", value: "5분" },
        { id: "order", label: "순서", value: "규칙 순서" },
        { id: "status", label: "상태", value: "활성" },
      ],
    },
    {
      id: "service-feedback-link",
      title: "제공기록지 링크 자동 발송",
      description: "서비스 종료 후 제공기록지 링크를 보냅니다.",
      active: true,
      requiresApproval: true,
      rows: [
        { id: "timing", label: "시점", value: "서비스 종료 후" },
        { id: "channel", label: "채널", value: "SMS" },
        { id: "recipient", label: "수신자", value: "고객" },
        { id: "template", label: "템플릿", value: "제공기록지 링크" },
        { id: "retry", label: "재시도", value: "사용" },
        { id: "approval", label: "승인", value: "필요" },
        { id: "status", label: "상태", value: "활성" },
      ],
    },
  ],
  pastTriggerConfig: {
    sendIntervalMinutes: 5,
    ruleOrder: [],
  },
};
const MESSAGE_SENDER_APPROVAL_QUERY_KEY = [
  "settings",
  "message-sender-approval",
] as const;

beforeAll(() => {
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    value: class ResizeObserverMock {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  });
  Object.defineProperty(HTMLElement.prototype, "hasPointerCapture", {
    configurable: true,
    value: () => false,
  });
  Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
    configurable: true,
    value: () => undefined,
  });
  Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", {
    configurable: true,
    value: () => undefined,
  });
});

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
}));

jest.mock("@/hooks/useGetAuthUser", () => ({
  useGetAuthUser: () => ({ data: { branchName: "인천점", role: "owner" } }),
}));

jest.mock("@/providers/UserProvider", () => ({
  useInitialUser: () => ({ branchName: "인천점", role: "owner" }),
}));

jest.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

jest.mock("@/services/api", () => ({
  settingsApi: {
    getMessageSenderApproval: jest.fn(),
    getMessageAutomationPolicies: jest.fn(),
    requestMessageSenderApproval: jest.fn(),
  },
}));

const mockedSettingsApi = jest.mocked(settingsApi);

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });

  const view = render(
    <QueryClientProvider client={queryClient}>
      <MessagesSettingsPage />
    </QueryClientProvider>,
  );

  return { ...view, queryClient };
}

describe("MessagesSettingsPage", () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockReplace.mockReset();
    mockToast.mockReset();
    mockedSettingsApi.getMessageSenderApproval.mockReset();
    mockedSettingsApi.getMessageAutomationPolicies.mockReset();
    mockedSettingsApi.requestMessageSenderApproval.mockReset();
    mockedSettingsApi.getMessageSenderApproval.mockResolvedValue(APPROVED);
    mockedSettingsApi.getMessageAutomationPolicies.mockResolvedValue(POLICIES);
    mockedSettingsApi.requestMessageSenderApproval.mockResolvedValue(UNAPPROVED);
  });

  it("shows seven settings without an application item for an approved user", async () => {
    renderPage();

    expect(await screen.findByText("7개")).toBeInTheDocument();
    expect(screen.queryByText("메시지 발송 기능 신청")).not.toBeInTheDocument();
    expect(screen.getByText("자동 전송 실행")).toBeInTheDocument();
    expect(screen.getByText("고객 자동 등록")).toBeInTheDocument();
    expect(screen.getByText("중복 전송 확인")).toBeInTheDocument();
  });

  it("opens the sender approval form from the unapproved-only item", async () => {
    mockedSettingsApi.getMessageSenderApproval.mockResolvedValue(UNAPPROVED);
    renderPage();

    fireEvent.click(
      await screen.findByRole("button", { name: /메시지 발송 기능 신청/ }),
    );

    expect(
      await screen.findByLabelText(/알리고 문자 서비스 이용약관/),
    ).toBeInTheDocument();
  });

  it("closes the detail when its selected item disappears", async () => {
    mockedSettingsApi.getMessageSenderApproval.mockResolvedValue(UNAPPROVED);
    const { container, queryClient } = renderPage();

    fireEvent.click(
      await screen.findByRole("button", { name: /메시지 발송 기능 신청/ }),
    );
    expect(
      await screen.findByLabelText(/알리고 문자 서비스 이용약관/),
    ).toBeInTheDocument();

    act(() => {
      queryClient.setQueryData(MESSAGE_SENDER_APPROVAL_QUERY_KEY, APPROVED);
    });

    const listPane = container.querySelector('[data-slot="list-pane"]');
    const detailPane = container.querySelector('[data-slot="detail-pane"]');
    await waitFor(() => {
      expect(listPane).toHaveAttribute("aria-hidden", "false");
      expect(detailPane).toHaveAttribute("aria-hidden", "true");
      expect(detailPane).toHaveAttribute("inert");
    });
    expect(screen.queryByText("메시지 발송 기능 신청")).not.toBeInTheDocument();
  });

  it("opens automation policy rows and returns to the list", async () => {
    const { container } = renderPage();

    fireEvent.click(
      await screen.findByRole("button", { name: /자동 전송 실행/ }),
    );

    const listPane = container.querySelector('[data-slot="list-pane"]');
    expect(listPane).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("전송 대상")).toBeInTheDocument();
    expect(screen.getByText("승인된 자동 전송 규칙")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "설정 목록으로 돌아가기" }),
    );

    expect(listPane).toHaveAttribute("aria-hidden", "false");
  });

  it("shows all three duplicate-send policy rows", async () => {
    renderPage();

    fireEvent.click(
      await screen.findByRole("button", { name: /중복 전송 확인/ }),
    );

    expect(screen.getByText("같은 번호 · 같은 메시지")).toBeInTheDocument();
    expect(screen.getByText("최근 72시간")).toBeInTheDocument();
    expect(screen.getByText("전송 전 확인 모달")).toBeInTheDocument();
  });

  it("keeps local settings visible and retries after a policies error", async () => {
    mockedSettingsApi.getMessageAutomationPolicies.mockRejectedValue(
      new Error("policies unavailable"),
    );
    renderPage();

    expect(
      await screen.findByText("자동 전송 정책을 불러오지 못했습니다"),
    ).toBeInTheDocument();
    expect(screen.getByText("고객 자동 등록")).toBeInTheDocument();
    expect(screen.getByText("중복 전송 확인")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "재시도" }));

    await waitFor(() => {
      expect(mockedSettingsApi.getMessageAutomationPolicies).toHaveBeenCalledTimes(2);
    });
  });
});
