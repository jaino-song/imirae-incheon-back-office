import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MESSAGE_JOB_CANCEL_COPY } from "@babyjamjam/shared";

import {
  useCancelMessageTriggerJob,
  useMessageHistory,
  useUpcomingMessageTriggerJobs,
} from "@/features/message-triggers/hooks/use-message-triggers";
import { toast } from "@/hooks/use-toast";
import { MessagesHistoryPage } from "../MessagesDataPages";

jest.mock("@/features/message-triggers/hooks/use-message-triggers", () => ({
  useMessageHistory: jest.fn(),
  useUpcomingMessageTriggerJobs: jest.fn(),
  useCancelMessageTriggerJob: jest.fn(),
}));

jest.mock("@/hooks/use-toast", () => ({
  toast: jest.fn(),
}));

const mockUseMessageHistory = useMessageHistory as jest.Mock;
const mockUseUpcomingMessageTriggerJobs = useUpcomingMessageTriggerJobs as jest.Mock;
const mockUseCancelMessageTriggerJob = useCancelMessageTriggerJob as jest.Mock;
const mockToast = toast as jest.Mock;

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

const cancelableJob = {
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
};

// message_log-backed manual scheduled entry: carries a synthetic
// manual-sms:<logId> ruleId (see backend
// MessageTriggerService.listManualScheduledSmsLogs), so no cancel action.
const manualScheduledJob = {
  ...cancelableJob,
  id: "job-2",
  ruleId: "manual-sms:55",
  ruleName: "",
  payload: {
    ...cancelableJob.payload,
    recipientName: "박고객",
  },
};

const sentRecord = {
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
  provider: "aligo_sms",
};

const canceledRecord = {
  ...sentRecord,
  id: 2,
  status: "canceled",
  errorMessage: "사용자가 예정된 발송을 취소했습니다.",
  recipientName: "취소 고객",
  clientName: "취소 고객",
  lastAttemptAt: "2026-07-16T02:00:00.000Z",
};

function mockNoCancelMutation() {
  mockUseCancelMessageTriggerJob.mockReturnValue({ mutateAsync: jest.fn(), isPending: false });
}

describe("mobile message data pages (merged 발송 기록 screen)", () => {
  beforeEach(() => {
    mockUseMessageHistory.mockReturnValue({ data: [], isLoading: false, isError: false });
    mockUseUpcomingMessageTriggerJobs.mockReturnValue({ data: [], isLoading: false, isError: false });
    mockNoCancelMutation();
    mockToast.mockReset();
  });

  it("renders both zones with labelled dividers, soonest-first upcoming and most-recent-first past sends", () => {
    mockUseUpcomingMessageTriggerJobs.mockReturnValue({
      isLoading: false,
      isError: false,
      data: [cancelableJob],
    });
    mockUseMessageHistory.mockReturnValue({
      isLoading: false,
      isError: false,
      data: [sentRecord],
    });

    const { container } = render(<MessagesHistoryPage />);

    const upcomingZone = container.querySelector('[data-component$="_zone-upcoming"]');
    const pastZone = container.querySelector('[data-component$="_zone-past"]');
    expect(upcomingZone).toBeInTheDocument();
    expect(pastZone).toBeInTheDocument();
    expect(upcomingZone!.compareDocumentPosition(pastZone!) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy();

    expect(container.querySelector('[data-component$="_zone-upcoming_header"]')).toHaveTextContent("예정 1건");
    expect(container.querySelector('[data-component$="_zone-past_header"]')).toHaveTextContent("지난 발송 1건");
    expect(screen.getByText("김고객")).toBeInTheDocument();
    expect(screen.getByText(/김문자/)).toBeInTheDocument();
    // ListCard header count reflects the combined visible total across zones.
    expect(container.querySelector('[data-component$="_content_list-card_header"] .list-title-text'))
      .toHaveTextContent("발송 기록");
    expect(screen.getByText("2건")).toBeInTheDocument();
  });

  it("keeps an empty zone visible at a zero count instead of hiding it", () => {
    mockUseUpcomingMessageTriggerJobs.mockReturnValue({ isLoading: false, isError: false, data: [] });
    mockUseMessageHistory.mockReturnValue({ isLoading: false, isError: false, data: [sentRecord] });

    const { container } = render(<MessagesHistoryPage />);

    expect(container.querySelector('[data-component$="_zone-upcoming"]')).toBeInTheDocument();
    expect(container.querySelector('[data-component$="_zone-upcoming_header"]')).toHaveTextContent("예정 0건");
    expect(container.querySelector('[data-component$="_zone-past"]')).toBeInTheDocument();
    expect(container.querySelector('[data-component$="_zone-past_header"]')).toHaveTextContent("지난 발송 1건");
  });

  it("keeps the past zone visible at a zero count too", () => {
    mockUseUpcomingMessageTriggerJobs.mockReturnValue({ isLoading: false, isError: false, data: [cancelableJob] });
    mockUseMessageHistory.mockReturnValue({ isLoading: false, isError: false, data: [] });

    const { container } = render(<MessagesHistoryPage />);

    expect(container.querySelector('[data-component$="_zone-past"]')).toBeInTheDocument();
    expect(container.querySelector('[data-component$="_zone-past_header"]')).toHaveTextContent("지난 발송 0건");
    expect(container.querySelector('[data-component$="_zone-upcoming_header"]')).toHaveTextContent("예정 1건");
  });

  it("shows the skeleton panel, not the empty state, on a cold load with no cached data", () => {
    mockUseUpcomingMessageTriggerJobs.mockReturnValue({ isLoading: true, isError: false, data: undefined });
    mockUseMessageHistory.mockReturnValue({ isLoading: true, isError: false, data: undefined });

    const { container } = render(<MessagesHistoryPage />);

    // Nothing is settled, so totalVisibleCount is 0 — but a loading panel must
    // never collapse into "표시할 메시지가 없습니다.".
    expect(screen.queryByText("표시할 메시지가 없습니다.")).not.toBeInTheDocument();
    expect(container.querySelector('[data-component$="_zone-upcoming"]')).toBeInTheDocument();
    expect(container.querySelector('[data-component$="_zone-past"]')).toBeInTheDocument();
    expect(container.querySelectorAll('[data-component$="_zone-upcoming_row-skeleton"]')).toHaveLength(3);
    expect(container.querySelectorAll('[data-component$="_zone-past_row-skeleton"]')).toHaveLength(4);
    expect(screen.getByRole("status")).toHaveTextContent("불러오고 있습니다");
    // The filter pills must not publish confident zeros next to skeletons.
    expect(container.querySelectorAll('.filter-pill-skeleton')).toHaveLength(5);
  });

  it("shows a zone's error message with no fabricated count", () => {
    mockUseUpcomingMessageTriggerJobs.mockReturnValue({ isLoading: false, isError: true, data: undefined });
    mockUseMessageHistory.mockReturnValue({ isLoading: false, isError: false, data: [sentRecord] });

    const { container } = render(<MessagesHistoryPage />);

    expect(screen.getByText("발송 예정 내역을 불러오지 못했습니다.")).toBeInTheDocument();
    expect(container.querySelector('[data-component$="_zone-upcoming_header_count"]')).not.toBeInTheDocument();
    expect(container.querySelector('[data-component$="_zone-upcoming_header"]')).toHaveTextContent("예정");
    // The healthy zone is unaffected.
    expect(container.querySelector('[data-component$="_zone-past_header"]')).toHaveTextContent("지난 발송 1건");
  });

  it("shows the past zone's error message while the upcoming zone still loads", () => {
    mockUseUpcomingMessageTriggerJobs.mockReturnValue({ isLoading: true, isError: false, data: undefined });
    mockUseMessageHistory.mockReturnValue({ isLoading: false, isError: true, data: undefined });

    const { container } = render(<MessagesHistoryPage />);

    expect(screen.getByText("발송 기록을 불러오지 못했습니다.")).toBeInTheDocument();
    expect(container.querySelector('[data-component$="_zone-past_header_count"]')).not.toBeInTheDocument();
    expect(container.querySelectorAll('[data-component$="_zone-past_row-skeleton"]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-component$="_zone-upcoming_row-skeleton"]')).toHaveLength(3);
  });

  it("collapses to the empty state only when both zones are settled and empty", () => {
    mockUseUpcomingMessageTriggerJobs.mockReturnValue({ isLoading: false, isError: false, data: [] });
    mockUseMessageHistory.mockReturnValue({ isLoading: false, isError: false, data: [] });

    const { container } = render(<MessagesHistoryPage />);

    expect(container.querySelector('[data-component$="_zone-upcoming"]')).not.toBeInTheDocument();
    expect(container.querySelector('[data-component$="_zone-past"]')).not.toBeInTheDocument();
    expect(screen.getByText("표시할 메시지가 없습니다.")).toBeInTheDocument();
  });

  it("skeletons both zones and every count while the upcoming query loads, even with cached history", () => {
    mockUseUpcomingMessageTriggerJobs.mockReturnValue({ isLoading: true, isError: false, data: undefined });
    mockUseMessageHistory.mockReturnValue({ isLoading: false, isError: false, data: [sentRecord] });

    const { container } = render(<MessagesHistoryPage />);

    // The cached past record must not render while the sibling query is in
    // flight — the whole list skeletons as one unit.
    expect(screen.queryByText(/김문자/)).not.toBeInTheDocument();
    expect(container.querySelectorAll('[data-component$="_zone-upcoming_row-skeleton"]')).toHaveLength(3);
    expect(container.querySelectorAll('[data-component$="_zone-past_row-skeleton"]')).toHaveLength(4);

    for (const suffix of [
      "_zone-upcoming_header_count",
      "_zone-past_header_count",
      "_content_list-card_header_count",
    ]) {
      const node = container.querySelector(`[data-component$="${suffix}"]`);
      expect(node).toBeInTheDocument();
      expect(node).toHaveAttribute("data-source-component", "ListCountSkeleton");
      expect(node?.textContent ?? "").not.toMatch(/\d/);
    }
  });

  it("skeletons the list while the history query loads, even with a settled upcoming job", () => {
    mockUseUpcomingMessageTriggerJobs.mockReturnValue({ isLoading: false, isError: false, data: [cancelableJob] });
    mockUseMessageHistory.mockReturnValue({ isLoading: true, isError: false, data: undefined });

    const { container } = render(<MessagesHistoryPage />);

    expect(screen.queryByText("김고객")).not.toBeInTheDocument();
    expect(container.querySelectorAll('[data-component$="_zone-upcoming_row-skeleton"]')).toHaveLength(3);
  });

  it("shows SMS history and excludes non-SMS provider records", () => {
    mockUseMessageHistory.mockReturnValue({
      isLoading: false,
      isError: false,
      data: [
        sentRecord,
        {
          ...sentRecord,
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
    // Scoped to the past zone: the "발송" status filter chip now reads
    // "발송 성공" too (see MESSAGE_RECORD_STATUS_FILTER_LABELS), so an
    // unscoped query would also match that chip, not just this row's badge.
    const pastZone = container.querySelector('[data-component$="_zone-past"]') as HTMLElement;
    expect(within(pastZone).getByText("발송 성공")).toBeInTheDocument();
  });

  it("shows a canceled row's reason inline, prefixed with 사유", () => {
    mockUseMessageHistory.mockReturnValue({
      isLoading: false,
      isError: false,
      data: [canceledRecord],
    });

    render(<MessagesHistoryPage />);

    expect(screen.getByText("취소 고객")).toBeInTheDocument();
    expect(screen.getByText(`사유: ${canceledRecord.errorMessage}`)).toBeInTheDocument();
  });

  it("shows a 취소 사유 row in the history detail view for a canceled record", async () => {
    const user = userEvent.setup();
    mockUseMessageHistory.mockReturnValue({
      isLoading: false,
      isError: false,
      data: [canceledRecord],
    });

    render(<MessagesHistoryPage />);

    await user.click(screen.getByRole("button", { name: /취소 고객/ }));

    expect(screen.getByText("취소 정보")).toBeInTheDocument();
    expect(screen.getByText("사유")).toBeInTheDocument();
    expect(screen.getByText(canceledRecord.errorMessage)).toBeInTheDocument();
  });

  it("does not add a cancel action to a manual scheduled row (synthetic manual-sms: rule id)", () => {
    mockUseUpcomingMessageTriggerJobs.mockReturnValue({
      isLoading: false,
      isError: false,
      data: [manualScheduledJob],
    });

    render(<MessagesHistoryPage />);

    expect(screen.getByText("박고객")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: MESSAGE_JOB_CANCEL_COPY.action })).not.toBeInTheDocument();
  });

  it("adds a cancel action to a pending trigger job row (has a rule id)", () => {
    mockUseUpcomingMessageTriggerJobs.mockReturnValue({
      isLoading: false,
      isError: false,
      data: [cancelableJob],
    });

    render(<MessagesHistoryPage />);

    expect(screen.getByRole("button", { name: MESSAGE_JOB_CANCEL_COPY.action })).toBeInTheDocument();
  });

  it("filters to zone 1 only for the upcoming filter, and to matching zone 2 rows for a status filter", async () => {
    const user = userEvent.setup();
    mockUseUpcomingMessageTriggerJobs.mockReturnValue({
      isLoading: false,
      isError: false,
      data: [cancelableJob],
    });
    mockUseMessageHistory.mockReturnValue({
      isLoading: false,
      isError: false,
      data: [sentRecord, canceledRecord],
    });

    const { container } = render(<MessagesHistoryPage />);

    // "upcoming" filter: zone 1 only, zone 2 hidden entirely.
    await user.click(screen.getByRole("button", { name: /^예정/ }));
    expect(container.querySelector('[data-component$="_zone-upcoming"]')).toBeInTheDocument();
    expect(container.querySelector('[data-component$="_zone-past"]')).not.toBeInTheDocument();

    // "발송 취소" filter: zone 1 hidden, zone 2 shows only the canceled row.
    // Scoped to the filter bar: the upcoming zone's still-visible cancel-row
    // button (MESSAGE_JOB_CANCEL_COPY.action) is also exactly "발송 취소",
    // and the filter chip's label now shares that wording too (see
    // MESSAGE_RECORD_STATUS_FILTER_LABELS), so an unscoped query would match both.
    const filterBar = container.querySelector('[data-component$="_filters"]') as HTMLElement;
    await user.click(within(filterBar).getByRole("button", { name: /^발송 취소/ }));
    expect(container.querySelector('[data-component$="_zone-upcoming"]')).not.toBeInTheDocument();
    expect(screen.getByText("취소 고객")).toBeInTheDocument();
    expect(screen.queryByText(/김문자/)).not.toBeInTheDocument();

    // back to "전체": both zones return.
    await user.click(screen.getByRole("button", { name: /^전체/ }));
    expect(container.querySelector('[data-component$="_zone-upcoming"]')).toBeInTheDocument();
    expect(screen.getByText(/김문자/)).toBeInTheDocument();
  });

  it("opens the desktop-equivalent message detail when a history row is selected", async () => {
    const user = userEvent.setup();

    mockUseMessageHistory.mockReturnValue({
      isLoading: false,
      isError: false,
      data: [{
        ...sentRecord,
        id: 3,
        templateKey: "service_record_link_sms",
        messageBody: "제공기록지 링크",
        lastAttemptAt: "2026-07-16T12:19:00.000Z",
      }],
    });

    const { container } = render(<MessagesHistoryPage />);

    const historyItem = container.querySelector('[data-component="mobile_messages_history_detail-sheet_stack_list-page_shell_content_list-card_body_item"]');

    expect(historyItem).not.toBeNull();
    expect(historyItem?.querySelector("strong")).toHaveTextContent("제공기록지 작성 링크");
    expect(historyItem?.querySelector("p")).toHaveTextContent(/김문자/);
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
    expect(screen.getAllByText("김문자")).not.toHaveLength(0);
    expect(screen.getByText("01012345678")).toBeInTheDocument();
    expect(screen.getAllByText("제공기록지 작성 링크")).not.toHaveLength(0);
    expect(detailPage).toHaveTextContent("발송 성공");
    expect(screen.getByText("제공기록지 링크")).toBeInTheDocument();

    await user.click(closeButton!);

    expect(container.querySelector('[data-component$="_content_list-card_header"] .list-title-text'))
      .toHaveTextContent("발송 기록");
    expect(stack).not.toHaveClass("show-detail");
    expect(detailPage).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByText("01012345678")).not.toBeInTheDocument();
  });

  it("cancels an upcoming trigger job through the confirm modal and shows success feedback", async () => {
    const user = userEvent.setup();
    const mutateAsync = jest.fn().mockResolvedValue({});
    mockUseCancelMessageTriggerJob.mockReturnValue({ mutateAsync, isPending: false });
    mockUseUpcomingMessageTriggerJobs.mockReturnValue({
      isLoading: false,
      isError: false,
      data: [cancelableJob],
    });

    render(<MessagesHistoryPage />);

    await user.click(screen.getByRole("button", { name: MESSAGE_JOB_CANCEL_COPY.action }));

    expect(screen.getByText(MESSAGE_JOB_CANCEL_COPY.confirmTitle)).toBeInTheDocument();

    // ApprovalTwoButtonModal renders through a Radix Portal (appended to
    // document.body), so it sits outside RTL's `container` subtree — query
    // the full document instead.
    const approveButton = document.querySelector('[data-component$="_cancel-modal_approve"]');
    expect(approveButton).not.toBeNull();
    await user.click(approveButton as HTMLElement);

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith("job-1");
    });
    expect(mockToast).toHaveBeenCalledTimes(1);
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        description: MESSAGE_JOB_CANCEL_COPY.success,
        variant: "success",
      }),
    );
  });

  it("shows failure feedback when the cancel mutation rejects, and leaves the row in place", async () => {
    const user = userEvent.setup();
    const mutateAsync = jest.fn().mockRejectedValue(new Error("already sent"));
    mockUseCancelMessageTriggerJob.mockReturnValue({ mutateAsync, isPending: false });
    mockUseUpcomingMessageTriggerJobs.mockReturnValue({
      isLoading: false,
      isError: false,
      data: [cancelableJob],
    });

    render(<MessagesHistoryPage />);

    await user.click(screen.getByRole("button", { name: MESSAGE_JOB_CANCEL_COPY.action }));
    const approveButton = document.querySelector('[data-component$="_cancel-modal_approve"]');
    expect(approveButton).not.toBeNull();
    await user.click(approveButton as HTMLElement);

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          description: MESSAGE_JOB_CANCEL_COPY.failure,
          variant: "destructive",
        }),
      );
    });
    // The job row itself is untouched on failure — no query invalidation happened.
    expect(screen.getByText("김고객")).toBeInTheDocument();
  });

  it("dismissing the confirm modal does not call the cancel mutation", async () => {
    const user = userEvent.setup();
    const mutateAsync = jest.fn();
    mockUseCancelMessageTriggerJob.mockReturnValue({ mutateAsync, isPending: false });
    mockUseUpcomingMessageTriggerJobs.mockReturnValue({
      isLoading: false,
      isError: false,
      data: [cancelableJob],
    });

    render(<MessagesHistoryPage />);

    await user.click(screen.getByRole("button", { name: MESSAGE_JOB_CANCEL_COPY.action }));
    await user.click(screen.getByRole("button", { name: MESSAGE_JOB_CANCEL_COPY.dismiss }));

    expect(screen.queryByText(MESSAGE_JOB_CANCEL_COPY.confirmTitle)).not.toBeInTheDocument();
    expect(mutateAsync).not.toHaveBeenCalled();
  });
});
