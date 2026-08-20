/**
 * Component-level regression tests for TemplateSendForm.
 * Each test locks in a real bug fix. See inline comments for which bug each guards.
 *
 * Pure-helper unit tests live in TemplateSendForm.test.ts — do NOT merge them here.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useQueryClient } from "@tanstack/react-query";

import type { MessageLogRecord } from "@/features/message-triggers/types";
import { messageTriggerKeys } from "@/features/message-triggers/hooks/keys";
import { useMessageHistory } from "@/features/message-triggers/hooks/use-message-triggers";
import { serviceRecordsApi } from "@/features/service-records/api/service-records.api";
import { useToast } from "@/hooks/use-toast";
import { messageDeliveryApi } from "@/services/api";
import { useFormStore } from "@/stores/form-store";

import { TemplateSendForm } from "../TemplateSendForm";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

// Mock ClientAutocomplete so we don't need to fight Radix Popover in JSDOM.
// Renders a plain <input> that calls onManualValueChange on change.
jest.mock("@/components/app/clients/ClientAutocomplete", () => ({
  ClientAutocomplete: ({
    label,
    manualValue,
    onManualValueChange,
  }: {
    label: string;
    manualValue?: string;
    onManualValueChange?: (v: string) => void;
  }) => (
    <input
      aria-label={label}
      value={manualValue ?? ""}
      onChange={(e) => onManualValueChange?.(e.target.value)}
      data-testid={`autocomplete-${label}`}
    />
  ),
}));

jest.mock("@tanstack/react-query", () => ({
  useQueryClient: jest.fn(),
}));

jest.mock("@/hooks/use-toast", () => ({
  useToast: jest.fn(),
}));

// Mock ContactInput so phone fields that use the plain input stay easy to assert.
jest.mock(
  "@/components/app/messages/forms/form-components/ContactInput",
  () => ({
    ContactInput: ({
      label,
      phone,
      setPhone,
    }: {
      label: string;
      phone: string;
      setPhone: (v: string) => void;
    }) => (
      <input
        aria-label={label}
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        data-testid="contact-input-phone"
      />
    ),
  }),
);

// Mock TemplateFieldGrid / TemplateFieldGridItem so children render normally.
jest.mock(
  "@/components/app/messages/forms/form-components/TemplateFieldGrid",
  () => ({
    TemplateFieldGrid: ({ children }: { children: React.ReactNode }) => (
      <div>{children}</div>
    ),
    TemplateFieldGridItem: ({
      children,
    }: {
      children: React.ReactNode;
      dataComponent?: string;
    }) => <div>{children}</div>,
  }),
);

// Mock the message-delivery history hook (aliased in TemplateSendForm as useMessageHistory).
jest.mock(
  "@/features/message-triggers/hooks/use-message-triggers",
  () => ({
    useMessageHistory: jest.fn(),
  }),
);

// Mock the API module — only sendSms is exercised here.
jest.mock("@/services/api", () => ({
  messageDeliveryApi: {
    sendSms: jest.fn(),
  },
}));

jest.mock("@/features/service-records/api/service-records.api", () => ({
  serviceRecordsApi: {
    getClientOverview: jest.fn(),
    sendLink: jest.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Typed references to mocks
// ---------------------------------------------------------------------------
const mockedUseMessageHistory = jest.mocked(useMessageHistory);
const mockedUseQueryClient = jest.mocked(useQueryClient);
const mockedUseToast = jest.mocked(useToast);
const mockedSendSms = jest.mocked(messageDeliveryApi.sendSms);
const mockedGetClientOverview = jest.mocked(serviceRecordsApi.getClientOverview);
const mockedSendServiceRecordLink = jest.mocked(serviceRecordsApi.sendLink);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildHistoryRecord(
  overrides: Partial<MessageLogRecord> = {},
): MessageLogRecord {
  return {
    id: 1,
    provider: "aligo_sms",
    templateKey: "SERVICE_INFO",
    triggerJobId: null,
    receiver: "010-1111-1111",
    clientId: null,
    recipientPhone: "010-1111-1111",
    messageBody: "안내 메시지입니다.",
    variables: {},
    status: "sent",
    aligoMid: "mid-1",
    errorMessage: null,
    attempts: 1,
    lastAttemptAt: new Date().toISOString(),
    nextRetryAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ruleId: null,
    ruleName: null,
    eventType: null,
    offsetType: null,
    offsetDays: 0,
    scheduledFor: null,
    recipientType: null,
    recipientName: null,
    clientName: null,
    employeeName: null,
    ...overrides,
  };
}

/** Default mock: empty history, no-op refetch. */
function mockEmptyHistory() {
  const refetch = jest.fn().mockResolvedValue({ data: [] });
  mockedUseMessageHistory.mockReturnValue({
    data: [],
    refetch,
  } as unknown as ReturnType<typeof useMessageHistory>);
  return refetch;
}

/** Build a success response for sendSms. */
function buildSendSuccess() {
  return {
    provider: "aligo_sms" as const,
    triggerType: "immediate" as const,
    request: { receiver: "", msgType: "SMS" as const, testMode: false },
    result: { resultCode: 1, message: "success", errorCount: 0 },
  };
}

/** Build a failure response for sendSms (resultCode !== 1). */
function buildSendFailure() {
  return {
    provider: "aligo_sms" as const,
    triggerType: "immediate" as const,
    request: { receiver: "", msgType: "SMS" as const, testMode: false },
    result: { resultCode: 0, message: "failed", errorCount: 1 },
  };
}

/**
 * Render the form with a simple non-name-requiring template.
 * "builtin:info" uses the inline phone recipient layout (no name required).
 */
function renderInfoForm() {
  return render(
    <TemplateSendForm
      templateId="builtin:info"
      templateName="서비스 안내"
      message="안내 메시지입니다."
    />,
  );
}

/**
 * Render the greeting template without a recipient-name requirement.
 */
function renderGreetingPhoneOnlyForm() {
  return render(
    <TemplateSendForm
      templateId="builtin:greeting"
      templateName="인사 메시지"
      message="안내 메시지입니다."
    />,
  );
}

/**
 * Render the form with requiresRecipientName=true (e.g. greeting/thanks template).
 */
function renderNameRequiredForm() {
  return render(
    <TemplateSendForm
      templateId="builtin:greeting"
      templateName="인사 메시지"
      message="안내 메시지입니다."
      requiresRecipientName
    />,
  );
}

/**
 * Queue a recipient by directly manipulating the Zustand store.
 * The component's useEffect auto-queues when currentQueueItem changes.
 */
async function queueRecipient(phone: string, name = "") {
  await act(async () => {
    useFormStore.setState({ phone, name });
  });
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  mockedUseQueryClient.mockReturnValue({
    invalidateQueries: jest.fn().mockResolvedValue(undefined),
  } as unknown as ReturnType<typeof useQueryClient>);
  mockedUseToast.mockReturnValue({
    toast: jest.fn(),
  } as unknown as ReturnType<typeof useToast>);
  // Reset Zustand store to blank state between tests.
  useFormStore.setState({
    clientId: null,
    name: "",
    phone: "",
    employeeId: null,
    employeeName: "",
    employeePhone: "",
    birthday: "",
    dueDate: "",
    address: "",
    startDate: "",
    endDate: "",
    fullPrice: "",
    grant: "",
    actualPrice: "",
    voucherType: "",
    voucherDuration: "",
    area: "",
  });
  mockEmptyHistory();
});

// ---------------------------------------------------------------------------
// Recipient phone input layout
// ---------------------------------------------------------------------------
describe("recipient phone input layout", () => {
  it("uses a plain phone input for the greeting template phone-only form", () => {
    renderGreetingPhoneOnlyForm();

    expect(screen.getByTestId("contact-input-phone")).toBeInTheDocument();
    expect(screen.queryByTestId("autocomplete-휴대 전화번호")).not.toBeInTheDocument();
  });

  it("keeps the client autocomplete for the service info template", () => {
    renderInfoForm();

    expect(screen.getByTestId("autocomplete-휴대 전화번호")).toBeInTheDocument();
    expect(screen.queryByTestId("contact-input-phone")).not.toBeInTheDocument();
  });

  it("uses the service-record backend path when the selected employee id is zero", async () => {
    useFormStore.setState({
      clientId: 20,
      name: "김산모",
      employeeId: 0,
      employeeName: "홍제공",
      employeePhone: "010-1111-2222",
    });
    mockedGetClientOverview.mockResolvedValue({
      data: {
        assignments: [
          {
            scheduleId: 11,
            replaced: false,
            employee: {
              id: 0,
              name: "홍제공",
              phone: "010-1111-2222",
            },
          },
        ],
      },
    } as never);
    mockedSendServiceRecordLink.mockResolvedValue({
      data: {
        ok: true,
        jobId: "job-11",
        status: "sent",
        scheduledFor: "2026-07-10T00:00:00.000Z",
      },
    } as never);

    const onSubmitStateChange = jest.fn();

    render(
      <TemplateSendForm
        templateId="builtin:service-feedback-link"
        templateName="제공기록지 작성 링크"
        message="{{employeeName}} {{clientName}} {{serviceRecordUrl}}"
        deliveryMode="service-feedback-link"
        serviceRecordLinkPreparation={{
          scheduleId: 11,
          serviceStartDate: "2026-07-03",
          serviceRecordUrl: "https://mobile.test/service-record/efl_prepared",
          preparedLinkToken: "efl_prepared",
          expiresAt: "2026-07-20T00:00:00.000Z",
          recipientPhone: "01011112222",
        }}
        onSubmitStateChange={onSubmitStateChange}
      >
        <div data-testid="service-feedback-fields" />
      </TemplateSendForm>,
    );

    expect(screen.getByTestId("service-feedback-fields")).toBeInTheDocument();
    expect(screen.queryByTestId("autocomplete-휴대 전화번호")).not.toBeInTheDocument();

    await waitFor(() => {
      expect(onSubmitStateChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ isSubmitDisabled: false }),
      );
    });

    fireEvent.click(screen.getByRole("button", { name: /즉시 발송/ }));

    await waitFor(() => {
      expect(mockedSendServiceRecordLink).toHaveBeenCalledWith(11, {
        preparedLinkToken: "efl_prepared",
        recipientPhone: "01011112222",
      });
    });
    expect(mockedGetClientOverview).not.toHaveBeenCalled();
    expect(mockedSendSms).not.toHaveBeenCalled();
    expect(
      document.querySelector('[data-component="desktop_messages_sections_template-send-form_feedback"]'),
    ).toHaveTextContent("제공기록지 링크를 바로 보냈어요");
    const queryClient = mockedUseQueryClient.mock.results[0]?.value;
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: messageTriggerKeys.upcoming(),
    });
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: messageTriggerKeys.history(),
    });
    const toast = mockedUseToast.mock.results[0]?.value.toast;
    expect(toast).toHaveBeenCalledWith({
      variant: "success",
      description: "제공기록지 링크를 바로 보냈어요",
    });
  });

  it("explains why a service-record link could not be sent without exposing error codes", async () => {
    useFormStore.setState({
      clientId: 20,
      name: "김산모",
      employeeId: 30,
      employeeName: "홍제공",
      employeePhone: "010-1111-2222",
    });
    mockedGetClientOverview.mockResolvedValue({
      data: {
        assignments: [
          {
            scheduleId: 11,
            replaced: false,
            employee: {
              id: 30,
              name: "홍제공",
              phone: "010-1111-2222",
            },
          },
        ],
      },
    } as never);
    mockedSendServiceRecordLink.mockRejectedValue({
      isAxiosError: true,
      response: {
        status: 400,
        data: {
          statusCode: 400,
          error: "Bad Request",
          message: "제공인력 전화번호가 없습니다",
        },
      },
    });

    render(
      <TemplateSendForm
        templateId="builtin:service-feedback-link"
        templateName="제공기록지 작성 링크"
        message="{{employeeName}} {{clientName}} {{serviceRecordUrl}}"
        deliveryMode="service-feedback-link"
        serviceRecordLinkPreparation={{
          scheduleId: 11,
          serviceStartDate: "2026-07-03",
          serviceRecordUrl: "https://mobile.test/service-record/efl_prepared",
          preparedLinkToken: "efl_prepared",
          expiresAt: "2026-07-20T00:00:00.000Z",
          recipientPhone: "01011112222",
        }}
      />,
    );

    const sendButton = screen.getByRole("button", { name: /즉시 발송/ });
    await waitFor(() => expect(sendButton).toBeEnabled());
    fireEvent.click(sendButton);

    await waitFor(() => {
      expect(
        document.querySelector('[data-component="desktop_messages_sections_template-send-form_feedback"]'),
      ).toHaveTextContent(
        "선택한 관리사님의 전화번호가 없어 제공기록지 링크를 보내지 못했어요",
      );
    });
    const feedback = document.querySelector(
      '[data-component="desktop_messages_sections_template-send-form_feedback"]',
    );
    expect(feedback).not.toHaveTextContent("400");
    expect(feedback).not.toHaveTextContent("Bad Request");
    const toast = mockedUseToast.mock.results[0]?.value.toast;
    expect(toast).toHaveBeenCalledWith({
      variant: "destructive",
      description: "선택한 관리사님의 전화번호가 없어 제공기록지 링크를 보내지 못했어요",
    });
  });
});

// ---------------------------------------------------------------------------
// BUG FIX A — Partial-failure send must NOT re-queue already-sent recipients.
//
// Before the fix: all recipients were re-queued on any failure, causing
// already-sent recipients to be re-sent on retry.
// After the fix: only failed recipients remain in the queue; succeeded
// recipients are removed so retrying re-sends only the failure.
// ---------------------------------------------------------------------------
describe("A: partial-failure send keeps only failed recipients in queue", () => {
  it("removes the succeeded recipient and keeps only the failed one after a mixed result", async () => {
    renderInfoForm();

    // Queue recipient 1 (01011111111 → 010-1111-1111) then recipient 2.
    await queueRecipient("01011111111");
    await queueRecipient("01022222222");

    await waitFor(() => {
      expect(
        document.querySelectorAll('[data-component="desktop_messages_sections_template-send-form-recipient"]').length,
      ).toBe(2);
    });

    // sendSms: recipient 1 succeeds, recipient 2 fails (rejects).
    mockedSendSms.mockImplementation(
      (payload) => {
        if (payload.receiver === "010-1111-1111") {
          return Promise.resolve(buildSendSuccess());
        }
        return Promise.reject(new Error("send failed"));
      },
    );

    // Submit the form.
    const submitButton = screen.getByRole("button", { name: /즉시 발송/ });
    fireEvent.click(submitButton);

    // Wait for async send to complete.
    await waitFor(() => {
      // Feedback element should be visible with partial summary.
      expect(
        document.querySelector('[data-component="desktop_messages_sections_template-send-form_feedback"]'),
      ).toBeInTheDocument();
    });

    const feedback = document.querySelector(
      '[data-component="desktop_messages_sections_template-send-form_feedback"]',
    );

    // Feedback must mention both 발송 완료 and 실패 (partial summary).
    expect(feedback?.textContent).toContain("발송 완료");
    expect(feedback?.textContent).toContain("실패");

    // Only the FAILED recipient (010-2222-2222) must remain in the queue.
    // The succeeded recipient (010-1111-1111) must be gone.
    const remainingPills = document.querySelectorAll(
      '[data-component="desktop_messages_sections_template-send-form-recipient"]',
    );
    expect(remainingPills).toHaveLength(1);
    expect(remainingPills[0].textContent).toContain("010-2222-2222");
    expect(remainingPills[0].textContent).not.toContain("010-1111-1111");
  });

  it("removes succeeded recipients even when sendSms resolves with a non-1 resultCode for another", async () => {
    renderInfoForm();

    await queueRecipient("01011111111");
    await queueRecipient("01022222222");

    await waitFor(() => {
      expect(
        document.querySelectorAll('[data-component="desktop_messages_sections_template-send-form-recipient"]').length,
      ).toBe(2);
    });

    // Recipient 1 succeeds; recipient 2 resolves but with resultCode=0 (failure result object).
    mockedSendSms.mockImplementation(
      (payload) => {
        if (payload.receiver === "010-1111-1111") {
          return Promise.resolve(buildSendSuccess());
        }
        return Promise.resolve(buildSendFailure());
      },
    );

    fireEvent.click(screen.getByRole("button", { name: /즉시 발송/ }));

    await waitFor(() => {
      expect(
        document.querySelector('[data-component="desktop_messages_sections_template-send-form_feedback"]'),
      ).toBeInTheDocument();
    });

    const feedback = document.querySelector(
      '[data-component="desktop_messages_sections_template-send-form_feedback"]',
    );
    expect(feedback?.textContent).toContain("발송 완료");
    expect(feedback?.textContent).toContain("실패");

    const remainingPills = document.querySelectorAll(
      '[data-component="desktop_messages_sections_template-send-form-recipient"]',
    );
    expect(remainingPills).toHaveLength(1);
    expect(remainingPills[0].textContent).toContain("010-2222-2222");
  });
});

// ---------------------------------------------------------------------------
// BUG FIX C — Duplicate-send confirm dialog must surface ALL duplicates.
//
// Before the fix: only the first duplicate was detected; additional duplicates
// were silently omitted.
// After the fix: every queued recipient with a matching recent "sent" history
// record appears in the confirm dialog list.
// ---------------------------------------------------------------------------
describe("C: duplicate-send confirm dialog lists all duplicates (not just the first)", () => {
  it("shows one confirm-recent entry per duplicate recipient and pluralizes the description", async () => {
    const message = "안내 메시지입니다.";

    // History records that match BOTH queued recipients.
    const historyForRecipient1 = buildHistoryRecord({
      id: 101,
      receiver: "010-1111-1111",
      recipientPhone: "010-1111-1111",
      messageBody: message,
      status: "sent",
      lastAttemptAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(), // 1h ago
    });
    const historyForRecipient2 = buildHistoryRecord({
      id: 102,
      receiver: "010-2222-2222",
      recipientPhone: "010-2222-2222",
      messageBody: message,
      status: "sent",
      lastAttemptAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2h ago
    });

    // refetch returns both matching history records.
    const refetch = jest
      .fn()
      .mockResolvedValue({ data: [historyForRecipient1, historyForRecipient2] });
    mockedUseMessageHistory.mockReturnValue({
      data: [historyForRecipient1, historyForRecipient2],
      refetch,
    } as unknown as ReturnType<typeof useMessageHistory>);

    renderInfoForm();

    // Queue both recipients.
    await queueRecipient("01011111111");
    await queueRecipient("01022222222");

    await waitFor(() => {
      expect(
        document.querySelectorAll('[data-component="desktop_messages_sections_template-send-form-recipient"]').length,
      ).toBe(2);
    });

    // sendSms should NOT be called — we expect the duplicate dialog to intercept.
    mockedSendSms.mockResolvedValue(buildSendSuccess());

    // Submit the form.
    fireEvent.click(screen.getByRole("button", { name: /즉시 발송/ }));

    // Wait for the duplicate confirm dialog to appear.
    await waitFor(() => {
      expect(
        document.querySelector('[data-component="desktop_messages_sections_duplicate-send-confirm-dialog"]'),
      ).toBeInTheDocument();
    });

    // The duplicate list must contain exactly 2 entries — one per duplicate recipient.
    const confirmList = document.querySelector(
      '[data-component="desktop_messages_sections_template-send-form_duplicate-send-confirm-list"]',
    );
    expect(confirmList).toBeInTheDocument();

    const recentItems = document.querySelectorAll(
      '[data-component="desktop_messages_sections_template-send-form_duplicate-send-confirm-list_recent"]',
    );
    expect(recentItems).toHaveLength(2);

    // The dialog description must mention "2건" (plural).
    const dialogDescription = document.querySelector('[data-component="desktop_messages_sections_duplicate-send-confirm-dialog_header"]');
    expect(dialogDescription?.textContent).toContain("2건");

    // sendSms must NOT have been called (dialog intercepted the send).
    expect(mockedSendSms).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// BUG FIX B — requiresRecipientName template: name edit updates queued entry.
//
// Before the fix: updating the name for an already-queued phone silently dropped
// the correction — the queued entry kept the stale name.
// After the fix: the queued entry is updated in place via a targeted array splice.
// ---------------------------------------------------------------------------
describe("B: editing name for already-queued phone updates the pill in place", () => {
  it("updates the queued recipient name when the same phone is re-queued with a new name", async () => {
    renderNameRequiredForm();

    // Queue recipient with initial name.
    await queueRecipient("01011111111", "김철수");

    // Pill should show initial name.
    await waitFor(() => {
      const pills = document.querySelectorAll(
        '[data-component="desktop_messages_sections_template-send-form-recipient"]',
      );
      expect(pills).toHaveLength(1);
      expect(pills[0].textContent).toContain("김철수");
    });

    // Change only the name (same phone) — the in-place update fix handles this.
    await queueRecipient("01011111111", "김영희");

    // Queue must still have exactly 1 entry (no duplicate), and name is corrected.
    await waitFor(() => {
      const pills = document.querySelectorAll(
        '[data-component="desktop_messages_sections_template-send-form-recipient"]',
      );
      expect(pills).toHaveLength(1);
      expect(pills[0].textContent).toContain("김영희");
      expect(pills[0].textContent).not.toContain("김철수");
    });
  });
});
