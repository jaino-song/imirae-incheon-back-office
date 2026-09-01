import fs from "node:fs";

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createContext, useContext, type ReactNode } from "react";

import MessagesPage from "./page";

const source = fs.readFileSync(require.resolve("./page"), "utf8");

describe("MessagesPage template type labels", () => {
  it("keeps branch template semantics when the selected detail is unavailable", () => {
    expect(source).toContain("const isBranchTemplate = userTemplateId !== null");
    expect(source).toContain('isBranchTemplate ? "지점 템플릿" : "기본 템플릿"');
    expect(source).toContain("지점 템플릿 · 정보를 불러오지 못했습니다.");
  });
});

describe("MessagesPage unreleased section gating", () => {
  it("keeps templates/triggers disabled for non-owners, now that scheduled/history merged into one always-available section", () => {
    const unreleasedIds = source
      .split("const UNRELEASED_SECTION_IDS = new Set<MessageSectionId>([")[1]
      ?.split("]);")[0];

    expect(unreleasedIds).toBeDefined();
    // "scheduled" and "history" are folded into one section that's gated only by
    // sender approval (see SENDER_APPROVAL_EXEMPT_SECTION_IDS below), not by
    // owner-only unreleased status anymore.
    expect(unreleasedIds).not.toContain('"scheduled"');
    expect(unreleasedIds).not.toContain('"history"');
    expect(unreleasedIds).toContain('"templates"');
    expect(unreleasedIds).toContain('"triggers"');
    expect(source).toContain("const isOwner = user?.role === ROLES.owner");
    expect(source).toContain("UNRELEASED_SECTION_IDS.has(section.id) && !isOwner");
  });
});

describe("MessagesPage sender approval gating", () => {
  it("keeps only send and settings available while sender approval is pending", () => {
    expect(source).toContain(
      'const SENDER_APPROVAL_EXEMPT_SECTION_IDS = new Set<MessageSectionId>(["send", "settings"]);',
    );
    expect(source).toContain(
      "const isSenderApprovalRequired = senderApproval?.isApproved === false",
    );
    expect(source).toContain(
      "!SENDER_APPROVAL_EXEMPT_SECTION_IDS.has(section.id)",
    );
  });
});
import {
  useCancelUpcomingMessageTriggerJob,
  useMessageHistory,
  useRetryMessageHistory,
  useUpcomingMessageTriggerJobs,
} from "@/features/message-triggers/hooks/use-message-triggers";
import type { MessageLogRecord, UpcomingMessageTriggerJob } from "@/features/message-triggers/types";

const mockToast = jest.fn();
const mockCancelMutateAsync = jest.fn();
const mockRetryMutateAsync = jest.fn();
// A jest.fn() (rather than the hardcoded object the mock used to return)
// so a single test can flip approval status via mockReturnValue and prove
// the render-level gate itself reacts, not just the nav's disabled flag.
const mockUseMessageSenderApproval = jest.fn();
const mockUseAllClients = jest.fn();

jest.mock("@/providers/LocaleProvider", () => ({
  useLocale: () => "ko",
}));

jest.mock("@/providers/UserProvider", () => ({
  // Non-owner role on purpose: history must be reachable for anyone once SMS
  // sending is approved, not just the branch owner.
  useInitialUser: () => ({ id: "user-1", role: "manager" }),
}));

jest.mock("@/components/app/messages/MessageApprovalGate", () => ({
  // Mirrors the real component's branching (children when approved/loading,
  // otherwise a stand-in for MessageApprovalRequiredNotice) instead of always
  // rendering children, so tests can assert the gate actually blocks content.
  MessageApprovalGate: ({
    children,
    dataComponent,
  }: {
    children: ReactNode;
    dataComponent: string;
  }) => {
    const { data, isLoading } = mockUseMessageSenderApproval();
    return isLoading || data?.isApproved ? (
      children
    ) : (
      <div data-testid="approval-gate-blocked" data-component={dataComponent} />
    );
  },
  useMessageSenderApproval: () => mockUseMessageSenderApproval(),
}));

jest.mock("@/features/message-templates/hooks/use-message-templates", () => ({
  useMessageTemplates: () => ({ data: [], isLoading: false }),
}));

jest.mock("@/features/clients/hooks/use-clients", () => ({
  useAllClients: () => mockUseAllClients(),
}));

jest.mock("@/features/system-templates/hooks", () => ({
  useSystemTemplate: () => ({ data: undefined, isLoading: false }),
}));

jest.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

jest.mock("@/features/message-triggers/hooks/use-message-triggers", () => ({
  useMessageHistory: jest.fn(),
  useRetryMessageHistory: jest.fn(),
  useUpcomingMessageTriggerJobs: jest.fn(),
  useCancelUpcomingMessageTriggerJob: jest.fn(),
}));

// Mirrors the SplitLayout mock in TriggerRulesManager.test.tsx: forces compact
// mode so useSplitLayoutSelection never auto-selects the first row, and renders
// both the list and detail children unconditionally so both are queryable.
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

      return (
        <div data-testid="split-layout" data-has-selection={hasSelection ? "true" : "false"}>
          {hasSelection ? (
            <button type="button" onClick={onBack}>
              목록으로 돌아가기
            </button>
          ) : null}
          {children}
        </div>
      );
    },
  };
});

jest.mock("@/components/app/ui/TwoButtonModal", () => ({
  TwoButtonModal: ({
    open,
    title,
    description,
    approvalLabel,
    cancelLabel,
    onApprove,
    onOpenChange,
  }: {
    open: boolean;
    title: ReactNode;
    description: ReactNode;
    approvalLabel: ReactNode;
    cancelLabel: ReactNode;
    onApprove: () => void;
    onOpenChange: (open: boolean) => void;
  }) =>
    open ? (
      <div role="alertdialog">
        <h2>{title}</h2>
        <p>{description}</p>
        <button type="button" onClick={() => onOpenChange(false)}>
          {cancelLabel}
        </button>
        <button type="button" onClick={onApprove}>
          {approvalLabel}
        </button>
      </div>
    ) : null,
}));

// The relative-date Select is Radix-based; no existing test in this repo drives
// it directly. Replace it with a plain button-per-option so "1일전" etc. are
// directly clickable without needing pointer-capture/scrollIntoView polyfills.
jest.mock("@/components/ui/select", () => {
  const SelectChangeContext = createContext<(value: string) => void>(() => {});

  function Select({
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (value: string) => void;
    children: ReactNode;
  }) {
    return <SelectChangeContext.Provider value={onValueChange}>{children}</SelectChangeContext.Provider>;
  }
  function SelectTrigger({ children }: { children: ReactNode }) {
    return <>{children}</>;
  }
  function SelectContent({ children }: { children: ReactNode }) {
    return <>{children}</>;
  }
  function SelectValue() {
    return null;
  }
  function SelectItem({ value, children }: { value: string; children: ReactNode }) {
    const onValueChange = useContext(SelectChangeContext);
    return (
      <button type="button" onClick={() => onValueChange(value)}>
        {children}
      </button>
    );
  }

  return { Select, SelectTrigger, SelectContent, SelectItem, SelectValue };
});

const mockedUseMessageHistory = jest.mocked(useMessageHistory);
const mockedUseUpcomingMessageTriggerJobs = jest.mocked(useUpcomingMessageTriggerJobs);
const mockedUseRetryMessageHistory = jest.mocked(useRetryMessageHistory);
const mockedUseCancelUpcomingMessageTriggerJob = jest.mocked(useCancelUpcomingMessageTriggerJob);

function buildUpcomingJob(overrides: Partial<UpcomingMessageTriggerJob> = {}): UpcomingMessageTriggerJob {
  return {
    id: "job-1",
    ruleId: "rule-1",
    ruleName: "제공기록지 안내",
    eventType: "SERVICE_START",
    offsetType: "SAME_DAY",
    offsetDays: 0,
    recipientType: "CLIENT",
    recipientPhone: "010-1111-2222",
    templateKey: "SERVICE_INFO",
    status: "pending",
    scheduledFor: "2026-08-20T01:00:00.000Z",
    sentAt: null,
    canceledAt: null,
    cancelReason: null,
    clientId: 1,
    employeeScheduleId: null,
    payload: {
      clientId: 1,
      clientName: "김서연",
      memberId: "member-1",
      recipientName: "김서연",
      recipientPhone: "010-1111-2222",
      templateVariables: {},
    },
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function buildManualJob(overrides: Partial<UpcomingMessageTriggerJob> = {}): UpcomingMessageTriggerJob {
  return buildUpcomingJob({
    id: "log:55",
    ruleId: "manual-sms:55",
    ruleName: "수동 예약 발송",
    recipientPhone: "010-3333-4444",
    payload: {
      clientId: 3,
      clientName: "박지민",
      memberId: "message-log:55",
      recipientName: "박지민",
      recipientPhone: "010-3333-4444",
      templateVariables: {},
    },
    ...overrides,
  });
}

function buildHistoryRecord(overrides: Partial<MessageLogRecord> = {}): MessageLogRecord {
  return {
    id: 101,
    provider: "aligo_sms",
    templateKey: "SERVICE_INFO",
    triggerJobId: null,
    receiver: "01055556666",
    clientId: 2,
    recipientPhone: "010-5555-6666",
    messageBody: "안내 메시지입니다.",
    variables: {},
    status: "sent",
    aligoMid: null,
    errorMessage: null,
    attempts: 1,
    lastAttemptAt: "2026-08-01T00:00:00.000Z",
    nextRetryAt: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ruleId: null,
    ruleName: null,
    eventType: null,
    offsetType: null,
    offsetDays: 0,
    scheduledFor: null,
    recipientType: null,
    recipientName: "이하은",
    clientName: null,
    employeeName: null,
    ...overrides,
  };
}

function mockData({
  upcoming = [],
  history = [],
}: {
  upcoming?: UpcomingMessageTriggerJob[];
  history?: MessageLogRecord[];
} = {}) {
  mockedUseUpcomingMessageTriggerJobs.mockReturnValue({
    data: upcoming,
    isLoading: false,
  } as unknown as ReturnType<typeof useUpcomingMessageTriggerJobs>);
  mockedUseMessageHistory.mockReturnValue({
    data: history,
    isLoading: false,
    isError: false,
  } as unknown as ReturnType<typeof useMessageHistory>);
}

function goToHistorySection() {
  const navButtons = screen.getAllByRole("button", { name: "발송 기록" });
  fireEvent.click(navButtons[0]);
}

function getZoneContainer(zone: "upcoming" | "past") {
  const suffix = zone === "upcoming" ? "zone-upcoming" : "zone-past";
  return document.querySelector(
    `[data-component="desktop_messages_sections_split-layout_list-panel-3_${suffix}"]`,
  );
}

beforeEach(() => {
  mockToast.mockReset();
  mockCancelMutateAsync.mockReset();
  mockCancelMutateAsync.mockResolvedValue({ id: "job-1", status: "canceled" });
  mockRetryMutateAsync.mockReset();
  mockRetryMutateAsync.mockResolvedValue({ id: 101, status: "sent" });
  mockUseMessageSenderApproval.mockReset();
  mockUseMessageSenderApproval.mockReturnValue({
    data: {
      approvalStatus: "approved",
      isApproved: true,
      canRequest: false,
      requestedAt: null,
      approvedAt: "2026-01-01T00:00:00.000Z",
    },
    isLoading: false,
  });
  mockUseAllClients.mockReturnValue({ data: [], isLoading: false });

  mockedUseRetryMessageHistory.mockReturnValue({
    mutateAsync: mockRetryMutateAsync,
    isPending: false,
  } as unknown as ReturnType<typeof useRetryMessageHistory>);
  mockedUseCancelUpcomingMessageTriggerJob.mockReturnValue({
    mutateAsync: mockCancelMutateAsync,
    isPending: false,
  } as unknown as ReturnType<typeof useCancelUpcomingMessageTriggerJob>);

  mockData();
});

describe("messages page — merged 발송 기록 section", () => {
  it("renders both the upcoming and past zones with their rows", () => {
    mockData({
      upcoming: [buildUpcomingJob()],
      history: [buildHistoryRecord()],
    });

    render(<MessagesPage />);
    goToHistorySection();

    const upcomingZone = getZoneContainer("upcoming");
    const pastZone = getZoneContainer("past");
    expect(upcomingZone).not.toBeNull();
    expect(pastZone).not.toBeNull();
    expect(within(upcomingZone as HTMLElement).getByText("김서연")).toBeInTheDocument();
    expect(within(pastZone as HTMLElement).getByText("이하은")).toBeInTheDocument();
  });

  it("filters to only the matching zone when a status tab is selected", () => {
    mockData({
      upcoming: [buildUpcomingJob()],
      history: [buildHistoryRecord()],
    });

    render(<MessagesPage />);
    goToHistorySection();

    // "예정" tab: only zone 1 shows.
    fireEvent.click(screen.getByRole("button", { name: "예정" }));
    expect(getZoneContainer("upcoming")).not.toBeNull();
    expect(getZoneContainer("past")).toBeNull();

    // "발송" tab: only the matching zone-2 rows show.
    fireEvent.click(screen.getByRole("button", { name: "발송" }));
    expect(getZoneContainer("upcoming")).toBeNull();
    expect(getZoneContainer("past")).not.toBeNull();
  });

  it("does not empty the upcoming zone when the date filter excludes every past record", () => {
    mockData({
      upcoming: [buildUpcomingJob({ scheduledFor: "2026-08-20T01:00:00.000Z" })],
      history: [buildHistoryRecord({ lastAttemptAt: "2026-07-20T00:00:00.000Z" })],
    });

    render(<MessagesPage />);
    goToHistorySection();

    // Restrict to the last day — the history record (10+ days old) drops out,
    // the upcoming job (future) must not be affected by this control at all.
    fireEvent.click(screen.getByRole("button", { name: "1일전" }));

    const upcomingZone = getZoneContainer("upcoming");
    expect(upcomingZone).not.toBeNull();
    expect(within(upcomingZone as HTMLElement).getByText("김서연")).toBeInTheDocument();
    expect(getZoneContainer("past")).toBeNull();
  });

  it("shows the cancel reason inline on a canceled row", () => {
    mockData({
      history: [
        buildHistoryRecord({
          id: 202,
          status: "canceled",
          errorMessage: "고객 요청으로 취소됨",
          recipientName: "취소고객",
        }),
      ],
    });

    render(<MessagesPage />);
    goToHistorySection();

    expect(screen.getByText("사유: 고객 요청으로 취소됨", { exact: false })).toBeInTheDocument();
  });

  it("does not render a cancel button for a manual scheduled row, but does for a real trigger job", () => {
    mockData({
      upcoming: [buildUpcomingJob(), buildManualJob()],
    });

    render(<MessagesPage />);
    goToHistorySection();

    fireEvent.click(screen.getByText("박지민"));
    expect(screen.queryByRole("button", { name: "발송 취소" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("김서연"));
    expect(screen.getByRole("button", { name: "발송 취소" })).toBeInTheDocument();
  });

  it("cancels an upcoming send after confirmation, shows exactly one success notification, and the row moves zones on refetch", async () => {
    mockData({
      upcoming: [buildUpcomingJob()],
      history: [],
    });

    const { rerender } = render(<MessagesPage />);
    goToHistorySection();

    fireEvent.click(screen.getByText("김서연"));
    fireEvent.click(screen.getByRole("button", { name: "발송 취소" }));

    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText("예정된 발송을 취소할까요?")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "발송 취소" }));

    await waitFor(() => expect(mockCancelMutateAsync).toHaveBeenCalledWith("job-1"));
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "success", description: "예정된 발송을 취소했습니다." }),
      ),
    );
    expect(mockToast).toHaveBeenCalledTimes(1);

    // Simulate the post-invalidation refetch on the SAME mounted instance (a
    // fresh render() would mount a second, independent tree instead of
    // reflecting the query update): the job is no longer upcoming and now
    // shows up as a canceled history row instead.
    mockData({
      upcoming: [],
      history: [
        buildHistoryRecord({
          id: "job:job-1",
          status: "canceled",
          errorMessage: "사용자 취소",
          recipientName: "김서연",
        }),
      ],
    });
    rerender(<MessagesPage />);

    expect(getZoneContainer("upcoming")).toBeNull();
    const pastZone = getZoneContainer("past");
    expect(pastZone).not.toBeNull();
    expect(within(pastZone as HTMLElement).getByText("김서연")).toBeInTheDocument();
  });

  it("shows exactly one failure notification and closes the dialog when the cancel request is rejected", async () => {
    mockCancelMutateAsync.mockRejectedValue(new Error("이미 발송되었거나 취소할 수 없는 상태입니다."));
    mockData({
      upcoming: [buildUpcomingJob()],
    });

    render(<MessagesPage />);
    goToHistorySection();

    fireEvent.click(screen.getByText("김서연"));
    fireEvent.click(screen.getByRole("button", { name: "발송 취소" }));
    const dialog = screen.getByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "발송 취소" }));

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "destructive", description: "이미 발송되었거나 취소할 수 없는 상태입니다." }),
      ),
    );
    expect(mockToast).toHaveBeenCalledTimes(1);

    // A rejected cancel (e.g. backend 409: already sent/processing/canceled)
    // must not trap the user behind a confirm button that can only 409 again —
    // the failure toast above is the feedback, so the dialog closes too.
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("matches recipient-type words in both zones without emptying either one", () => {
    mockData({
      upcoming: [
        buildUpcomingJob({
          id: "job-employee",
          recipientType: "PRIMARY_EMPLOYEE",
          payload: {
            employeeId: 9,
            employeeName: "김담당",
            memberId: "member-9",
            recipientName: "김담당",
            recipientPhone: "010-9999-0000",
            templateVariables: {},
          },
        }),
      ],
      history: [
        buildHistoryRecord({
          id: 303,
          recipientType: "PRIMARY_EMPLOYEE",
          recipientName: "이담당",
        }),
      ],
    });

    render(<MessagesPage />);
    goToHistorySection();

    fireEvent.change(screen.getByLabelText("검색어"), { target: { value: "직원" } });

    const upcomingZone = getZoneContainer("upcoming");
    const pastZone = getZoneContainer("past");
    expect(upcomingZone).not.toBeNull();
    expect(pastZone).not.toBeNull();
    expect(within(upcomingZone as HTMLElement).getByText("김담당")).toBeInTheDocument();
    expect(within(pastZone as HTMLElement).getByText("이담당")).toBeInTheDocument();
  });

  it("does not replace an employee recipient with the related client name", () => {
    mockUseAllClients.mockReturnValue({
      data: [{ id: 2, name: "이보배", phone: "010-5555-6666" }],
      isLoading: false,
    });
    mockData({
      history: [
        buildHistoryRecord({
          templateKey: "SERVICE_RECORD_LINK",
          recipientType: "PRIMARY_EMPLOYEE",
          recipientName: "고원경",
          clientName: "이보배",
          employeeName: "고원경",
        }),
      ],
    });

    render(<MessagesPage />);
    goToHistorySection();

    const pastZone = getZoneContainer("past");
    expect(within(pastZone as HTMLElement).getByText("고원경")).toBeInTheDocument();
    expect(within(pastZone as HTMLElement).queryByText("이보배")).not.toBeInTheDocument();
  });

  it("gates the merged history section behind sender approval, matching its sibling sections", () => {
    mockData({
      upcoming: [buildUpcomingJob()],
    });

    const { rerender } = render(<MessagesPage />);
    goToHistorySection();

    expect(screen.getByText("김서연")).toBeInTheDocument();

    // Approval is revoked while already on the history tab (e.g. a background
    // refetch flips isApproved false) — activeSection stays "history" since
    // nothing resets it on its own, so this exercises the render-level gate
    // itself rather than the nav item's disabled flag, which only blocks
    // future navigation.
    mockUseMessageSenderApproval.mockReturnValue({
      data: {
        approvalStatus: "pending",
        isApproved: false,
        canRequest: true,
        requestedAt: "2026-01-01T00:00:00.000Z",
        approvedAt: null,
      },
      isLoading: false,
    });
    rerender(<MessagesPage />);

    expect(screen.queryByText("김서연")).not.toBeInTheDocument();
    expect(screen.getByTestId("approval-gate-blocked")).toHaveAttribute(
      "data-component",
      "desktop_messages_sections_section-content_history-section_approval-gate",
    );
  });
});
