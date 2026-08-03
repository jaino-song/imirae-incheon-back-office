import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type {
  MessageAutomationPastTriggerConfig,
  MessageAutomationPoliciesResponse,
  MessageAutomationPolicy,
  MessageTriggerRule,
} from "@babyjamjam/shared/types/message";

import { useMessageTriggerRules } from "@/features/message-triggers/hooks/use-message-triggers";
import { settingsApi } from "@/services/api";

import { PastTriggerPolicyDetail } from "../PastTriggerPolicyDetail";

const mockToast = jest.fn();

jest.mock("@/features/message-triggers/hooks/use-message-triggers", () => ({
  useMessageTriggerRules: jest.fn(),
}));

jest.mock("@/services/api", () => ({
  settingsApi: {
    updateMessageAutomationPastTriggerConfig: jest.fn(),
  },
}));

jest.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

const MESSAGE_AUTOMATION_POLICIES_QUERY_KEY = [
  "settings",
  "message-automation-policies",
] as const;
const DATA_COMPONENT = "mobile_messages_settings_past-trigger-policy-detail";
const POLICY: MessageAutomationPolicy = {
  id: "past-trigger",
  title: "지난 자동 전송",
  description: "늦게 등록된 고객에게 자동 전송합니다.",
  active: true,
  requiresApproval: false,
  rows: [
    {
      id: "target",
      label: "대상",
      value: "늦게 등록된 고객",
    },
  ],
};
const PAST_TRIGGER_CONFIG: MessageAutomationPastTriggerConfig = {
  sendIntervalMinutes: 5,
  ruleOrder: ["hidden-welcome-rule", "rule-one", "rule-two"],
};

const mockUseMessageTriggerRules = useMessageTriggerRules as jest.Mock;
const mockedSettingsApi = jest.mocked(settingsApi);

function createRule(overrides: Partial<MessageTriggerRule> = {}): MessageTriggerRule {
  return {
    id: "rule-one",
    branchId: "branch-1",
    name: "첫 번째 규칙",
    isActive: true,
    eventType: "SERVICE_START",
    offsetType: "BEFORE_DAYS",
    offsetDays: 1,
    recipientType: "CLIENT",
    templateKey: "SERVICE_INFO",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

const TRIGGER_RULES: MessageTriggerRule[] = [
  createRule(),
  createRule({
    id: "rule-two",
    name: "두 번째 규칙",
    eventType: "SERVICE_END",
    offsetType: "SAME_DAY",
    offsetDays: 0,
    templateKey: "REMINDER",
  }),
  createRule({
    id: "rule-inactive",
    name: "비활성 SMS 규칙",
    isActive: false,
    templateKey: "THANKS",
  }),
  createRule({
    id: "hidden-welcome-rule",
    name: "SMS가 아닌 규칙",
    templateKey: "CLIENT_WELCOME",
  }),
];

function renderDetail(
  pastTriggerConfig: MessageAutomationPastTriggerConfig = PAST_TRIGGER_CONFIG,
) {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
  const cachedPolicies: MessageAutomationPoliciesResponse = {
    policies: [POLICY],
    pastTriggerConfig,
  };
  queryClient.setQueryData(MESSAGE_AUTOMATION_POLICIES_QUERY_KEY, cachedPolicies);

  const renderComponent = (config: MessageAutomationPastTriggerConfig) => (
    <QueryClientProvider client={queryClient}>
      <PastTriggerPolicyDetail
        data-component={DATA_COMPONENT}
        policy={POLICY}
        pastTriggerConfig={config}
      />
    </QueryClientProvider>
  );
  const view = render(renderComponent(pastTriggerConfig));

  return {
    ...view,
    queryClient,
    rerenderConfig: (config: MessageAutomationPastTriggerConfig) => {
      view.rerender(renderComponent(config));
    },
  };
}

async function advanceDebounce(milliseconds: number): Promise<void> {
  await act(async () => {
    jest.advanceTimersByTime(milliseconds);
  });
}

function expectLastPut(
  config: MessageAutomationPastTriggerConfig,
): void {
  expect(
    mockedSettingsApi.updateMessageAutomationPastTriggerConfig,
  ).toHaveBeenLastCalledWith(config, expect.anything());
}

describe("PastTriggerPolicyDetail", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockUseMessageTriggerRules.mockReturnValue({
      data: TRIGGER_RULES,
      isError: false,
      isLoading: false,
    });
    mockToast.mockReset();
    mockedSettingsApi.updateMessageAutomationPastTriggerConfig.mockReset();
    mockedSettingsApi.updateMessageAutomationPastTriggerConfig.mockImplementation(
      async (config) => config,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  it("should render policy rows and only active SMS trigger rules", () => {
    renderDetail();

    const policyRows = document.querySelector(
      `[data-component="${DATA_COMPONENT}_rules"][data-source-component="PolicyInfoRows"]`,
    );
    expect(policyRows).toHaveTextContent("대상");
    expect(policyRows).toHaveTextContent("늦게 등록된 고객");
    expect(screen.getByText("첫 번째 규칙")).toBeInTheDocument();
    expect(screen.getByText("두 번째 규칙")).toBeInTheDocument();
    expect(screen.queryByText("비활성 SMS 규칙")).not.toBeInTheDocument();
    expect(screen.queryByText("SMS가 아닌 규칙")).not.toBeInTheDocument();
  });

  it("should strip non-digit characters from the interval input", () => {
    renderDetail();

    const intervalInput = screen.getByLabelText("늦은 등록 자동 전송 간격");
    fireEvent.change(intervalInput, { target: { value: "12a" } });

    expect(intervalInput).toHaveValue("12");
  });

  it("should persist one position-preserving merged order after 300ms", async () => {
    renderDetail();

    fireEvent.click(
      screen.getByRole("button", { name: "첫 번째 규칙 아래로 이동" }),
    );
    expect(screen.getAllByRole("listitem")[0]).toHaveTextContent("두 번째 규칙");

    await advanceDebounce(300);

    await waitFor(() => {
      expect(
        mockedSettingsApi.updateMessageAutomationPastTriggerConfig,
      ).toHaveBeenCalledTimes(1);
    });
    expectLastPut({
      sendIntervalMinutes: 5,
      ruleOrder: ["hidden-welcome-rule", "rule-two", "rule-one"],
    });
  });

  it("should coalesce rapid reorders into one PUT with the final order", async () => {
    renderDetail();

    fireEvent.click(
      screen.getByRole("button", { name: "첫 번째 규칙 아래로 이동" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "두 번째 규칙 아래로 이동" }),
    );

    await advanceDebounce(300);

    await waitFor(() => {
      expect(
        mockedSettingsApi.updateMessageAutomationPastTriggerConfig,
      ).toHaveBeenCalledTimes(1);
    });
    expectLastPut(PAST_TRIGGER_CONFIG);
  });

  it("should persist a valid interval after 600ms", async () => {
    renderDetail();

    fireEvent.change(screen.getByLabelText("늦은 등록 자동 전송 간격"), {
      target: { value: "15" },
    });
    await advanceDebounce(600);

    await waitFor(() => {
      expect(
        mockedSettingsApi.updateMessageAutomationPastTriggerConfig,
      ).toHaveBeenCalledTimes(1);
    });
    expectLastPut({ ...PAST_TRIGGER_CONFIG, sendIntervalMinutes: 15 });
  });

  it.each(["0", "1441", ""])(
    "should not persist invalid interval %p",
    async (value) => {
      renderDetail();

      fireEvent.change(screen.getByLabelText("늦은 등록 자동 전송 간격"), {
        target: { value },
      });
      await advanceDebounce(600);

      expect(
        mockedSettingsApi.updateMessageAutomationPastTriggerConfig,
      ).not.toHaveBeenCalled();
      expect(screen.getByText("1~1440분")).toBeInTheDocument();
    },
  );

  it.each(["1", "1440"])(
    "should persist boundary interval %s",
    async (value) => {
      renderDetail();

      fireEvent.change(screen.getByLabelText("늦은 등록 자동 전송 간격"), {
        target: { value },
      });
      await advanceDebounce(600);

      await waitFor(() => {
        expect(
          mockedSettingsApi.updateMessageAutomationPastTriggerConfig,
        ).toHaveBeenCalledTimes(1);
      });
      expectLastPut({
        ...PAST_TRIGGER_CONFIG,
        sendIntervalMinutes: Number(value),
      });
    },
  );

  it("should roll back the optimistic cache and drafts on error", async () => {
    let rejectUpdate: (error: Error) => void = () => undefined;
    mockedSettingsApi.updateMessageAutomationPastTriggerConfig.mockImplementation(
      () =>
        new Promise((_, reject) => {
          rejectUpdate = reject;
        }),
    );
    const { queryClient } = renderDetail();
    const intervalInput = screen.getByLabelText(
      "늦은 등록 자동 전송 간격",
    );

    fireEvent.change(intervalInput, { target: { value: "15" } });
    await advanceDebounce(600);
    await waitFor(() => {
      expect(
        queryClient.getQueryData<MessageAutomationPoliciesResponse>(
          MESSAGE_AUTOMATION_POLICIES_QUERY_KEY,
        )?.pastTriggerConfig,
      ).toEqual({ ...PAST_TRIGGER_CONFIG, sendIntervalMinutes: 15 });
    });

    await act(async () => {
      rejectUpdate(new Error("save failed"));
    });

    await waitFor(() => {
      expect(
        queryClient.getQueryData<MessageAutomationPoliciesResponse>(
          MESSAGE_AUTOMATION_POLICIES_QUERY_KEY,
        )?.pastTriggerConfig,
      ).toEqual(PAST_TRIGGER_CONFIG);
    });
    expect(intervalInput).toHaveValue("5");
    expect(mockToast).toHaveBeenCalledWith({
      variant: "destructive",
      description: "지난 자동 전송 설정 저장 중 오류가 발생했습니다.",
    });
  });

  it("should remain silent on success", async () => {
    renderDetail();

    fireEvent.change(screen.getByLabelText("늦은 등록 자동 전송 간격"), {
      target: { value: "15" },
    });
    await advanceDebounce(600);

    await waitFor(() => {
      expect(
        mockedSettingsApi.updateMessageAutomationPastTriggerConfig,
      ).toHaveBeenCalledTimes(1);
    });
    expect(mockToast).not.toHaveBeenCalled();
  });

  it("should queue one latest-wins persist while a request is pending", async () => {
    let resolveFirstUpdate: (
      config: MessageAutomationPastTriggerConfig,
    ) => void = () => undefined;
    mockedSettingsApi.updateMessageAutomationPastTriggerConfig
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirstUpdate = resolve;
          }),
      )
      .mockImplementation(async (config) => config);
    renderDetail();

    fireEvent.click(
      screen.getByRole("button", { name: "첫 번째 규칙 아래로 이동" }),
    );
    await advanceDebounce(300);
    await waitFor(() => {
      expect(
        mockedSettingsApi.updateMessageAutomationPastTriggerConfig,
      ).toHaveBeenCalledTimes(1);
    });

    fireEvent.change(screen.getByLabelText("늦은 등록 자동 전송 간격"), {
      target: { value: "15" },
    });
    await advanceDebounce(600);
    expect(
      mockedSettingsApi.updateMessageAutomationPastTriggerConfig,
    ).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFirstUpdate({
        sendIntervalMinutes: 5,
        ruleOrder: ["hidden-welcome-rule", "rule-two", "rule-one"],
      });
    });

    await waitFor(() => {
      expect(
        mockedSettingsApi.updateMessageAutomationPastTriggerConfig,
      ).toHaveBeenCalledTimes(2);
    });
    expectLastPut({
      sendIntervalMinutes: 15,
      ruleOrder: ["hidden-welcome-rule", "rule-two", "rule-one"],
    });
  });

  it("should adopt a refetched config while idle", () => {
    const { rerenderConfig } = renderDetail();
    const intervalInput = screen.getByLabelText(
      "늦은 등록 자동 전송 간격",
    );

    rerenderConfig({
      sendIntervalMinutes: 9,
      ruleOrder: ["hidden-welcome-rule", "rule-two", "rule-one"],
    });

    expect(intervalInput).toHaveValue("9");
    expect(screen.getAllByRole("listitem")[0]).toHaveTextContent("두 번째 규칙");
  });

  it("should preserve drafts while a debounce is pending", () => {
    const { rerenderConfig } = renderDetail();
    const intervalInput = screen.getByLabelText(
      "늦은 등록 자동 전송 간격",
    );
    fireEvent.change(intervalInput, { target: { value: "12" } });

    rerenderConfig({
      sendIntervalMinutes: 9,
      ruleOrder: ["hidden-welcome-rule", "rule-two", "rule-one"],
    });

    expect(intervalInput).toHaveValue("12");
  });
});
