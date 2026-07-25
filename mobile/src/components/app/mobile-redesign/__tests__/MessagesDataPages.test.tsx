import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  useMessageHistory,
  useUpcomingMessageTriggerJobs,
} from "@/features/message-triggers/hooks/use-message-triggers";
import { MessagesHistoryPage, MessagesScheduledPage } from "../MessagesDataPages";

jest.mock("@/features/message-triggers/hooks/use-message-triggers", () => ({
  useMessageHistory: jest.fn(),
  useUpcomingMessageTriggerJobs: jest.fn(),
}));

const mockUseMessageHistory = useMessageHistory as jest.Mock;
const mockUseUpcomingMessageTriggerJobs = useUpcomingMessageTriggerJobs as jest.Mock;

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

describe("mobile message data pages", () => {
  beforeEach(() => {
    mockUseMessageHistory.mockReturnValue({ data: [], isLoading: false, isError: false });
    mockUseUpcomingMessageTriggerJobs.mockReturnValue({ data: [], isLoading: false, isError: false });
  });

  it("renders actual upcoming jobs with the scheduled section navigation", () => {
    mockUseUpcomingMessageTriggerJobs.mockReturnValue({
      isLoading: false,
      isError: false,
      data: [{
        id: "job-1",
        ruleId: "rule-1",
        ruleName: "서비스 안내",
        eventType: "SERVICE_START",
        offsetType: "BEFORE_DAYS",
        offsetDays: 1,
        recipientType: "CLIENT",
        recipientPhone: "01012345678",
        templateKey: "SERVICE_INFO",
        status: "pending",
        scheduledFor: "2026-07-17T01:00:00.000Z",
        sentAt: null,
        canceledAt: null,
        cancelReason: null,
        clientId: 1,
        employeeScheduleId: null,
        payload: {
          memberId: "member-1",
          recipientName: "김고객",
          recipientPhone: "01012345678",
          templateVariables: {},
        },
        createdAt: "2026-07-16T01:00:00.000Z",
        updatedAt: "2026-07-16T01:00:00.000Z",
      }],
    });

    const { container } = render(<MessagesScheduledPage />);

    const scheduledItem = container.querySelector('[data-component="mobile-messages-scheduled-item"]');
    const rowInfo = scheduledItem?.querySelector(".message-data-row-info");

    expect(screen.getByText("김고객")).toBeInTheDocument();
    expect(screen.getByText(/서비스 안내/)).toBeInTheDocument();
    expect(rowInfo?.querySelector(".message-data-row-title")).toHaveTextContent("김고객");
    expect(rowInfo?.querySelector(".message-data-row-subtitle")).toHaveTextContent("서비스 안내");
    expect(scheduledItem).not.toHaveTextContent("01012345678");
    expect(screen.getByRole("button", { name: "발송 예정" }))
      .toHaveAttribute("aria-pressed", "true");
    expect(container.querySelector('[data-component="mobile-redesign-list-title"] .list-title-text'))
      .toHaveTextContent("발송 예정");
    expect(container.querySelector('[data-component="mobile-redesign-list-card"]'))
      .toContainElement(container.querySelector('[data-component="mobile-redesign-list-scroll"]'));
    expect(screen.queryByRole("link", { name: "메시지로 돌아가기" }))
      .not.toBeInTheDocument();
  });

  it("shows SMS history and excludes non-SMS provider records", () => {
    const baseRecord = {
      id: 1,
      templateKey: "CLIENT_GREETING",
      triggerJobId: null,
      receiver: "01012345678",
      clientId: 1,
      recipientPhone: "01012345678",
      messageBody: "안녕하세요",
      variables: {},
      status: "sent",
      aligoMid: null,
      errorMessage: null,
      attempts: 1,
      lastAttemptAt: "2026-07-16T01:00:00.000Z",
      nextRetryAt: null,
      createdAt: "2026-07-16T01:00:00.000Z",
      updatedAt: "2026-07-16T01:00:00.000Z",
      ruleId: null,
      ruleName: null,
      eventType: "CLIENT_CREATED",
      offsetType: "IMMEDIATE",
      offsetDays: 0,
      scheduledFor: null,
      recipientType: "CLIENT",
      recipientName: "김문자",
      clientName: "김문자",
      employeeName: null,
    };
    mockUseMessageHistory.mockReturnValue({
      isLoading: false,
      isError: false,
      data: [
        { ...baseRecord, provider: "aligo_sms" },
        {
          ...baseRecord,
          id: 2,
          provider: "aligo_alimtalk",
          templateKey: "CLIENT_WELCOME",
          recipientName: "김알림톡",
        },
      ],
    });

    const { container } = render(<MessagesHistoryPage />);

    expect(screen.getByText(/김문자/)).toBeInTheDocument();
    expect(screen.queryByText("김알림톡")).not.toBeInTheDocument();
    expect(screen.getByText("1건")).toBeInTheDocument();
    expect(container.querySelector('[data-component="mobile-redesign-list-title"] .list-title-text'))
      .toHaveTextContent("발송 기록");
    expect(screen.getByText("발송 성공")).toBeInTheDocument();
  });

  it("opens the desktop-equivalent message detail when a history row is selected", async () => {
    const user = userEvent.setup();

    mockUseMessageHistory.mockReturnValue({
      isLoading: false,
      isError: false,
      data: [{
        id: 3,
        provider: "aligo_sms",
        templateKey: "service_record_link_sms",
        triggerJobId: null,
        receiver: "01012345678",
        clientId: 1,
        recipientPhone: "01012345678",
        messageBody: "제공기록지 링크",
        variables: {},
        status: "sent",
        aligoMid: null,
        errorMessage: null,
        attempts: 1,
        lastAttemptAt: "2026-07-16T12:19:00.000Z",
        nextRetryAt: null,
        createdAt: "2026-07-16T12:19:00.000Z",
        updatedAt: "2026-07-16T12:19:00.000Z",
        ruleId: null,
        ruleName: null,
        eventType: null,
        offsetType: null,
        offsetDays: 0,
        scheduledFor: null,
        recipientType: "CLIENT",
        recipientName: "김고객",
        clientName: "김고객",
        employeeName: null,
      }],
    });

    const { container } = render(<MessagesHistoryPage />);

    const historyItem = container.querySelector('[data-component="mobile-messages-history-item"]');

    expect(historyItem).not.toBeNull();
    expect(historyItem?.querySelector("strong")).toHaveTextContent("제공기록지 작성 링크");
    expect(historyItem?.querySelector("p")).toHaveTextContent(/김고객/);
    expect(historyItem).not.toHaveTextContent("01012345678");
    expect(screen.queryByText(/service_record_link_sms/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /제공기록지 작성 링크/ }));

    const detailPage = container.querySelector('[data-slot="mobile-detail-stack-detail-page"]');
    const stack = container.querySelector('[data-slot="mobile-detail-stack-track"]');

    expect(stack).toHaveClass("show-detail");
    expect(detailPage).toHaveAttribute("aria-hidden", "false");
    const closeButton = detailPage?.querySelector<HTMLButtonElement>(".sheet-close");

    expect(closeButton).not.toBeNull();
    expect(screen.getByText("발송 정보")).toBeInTheDocument();
    expect(screen.getAllByText("김고객")).not.toHaveLength(0);
    expect(screen.getByText("01012345678")).toBeInTheDocument();
    expect(screen.getAllByText("제공기록지 작성 링크")).not.toHaveLength(0);
    expect(screen.getByText("메시지")).toBeInTheDocument();
    expect(detailPage).toHaveTextContent("발송 성공");
    expect(screen.getByText("제공기록지 링크")).toBeInTheDocument();

    await user.click(closeButton!);

    expect(container.querySelector('[data-component="mobile-redesign-list-title"] .list-title-text'))
      .toHaveTextContent("발송 기록");
    expect(stack).not.toHaveClass("show-detail");
    expect(detailPage).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByText("01012345678")).not.toBeInTheDocument();
  });
});
