import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type {
  MessageAutomationPastTriggerConfig,
  MessageAutomationPoliciesResponse,
  MessageAutomationPolicy,
  MessageTriggerRule,
} from "@babyjamjam/shared/types/message";

import { useMessageTriggerRules } from "@/features/message-triggers/hooks/use-message-triggers";
import { settingsApi } from "@/services/api";

import { PastTriggerPolicyDetail } from "../PastTriggerPolicyDetail";

jest.mock("@/features/message-triggers/hooks/use-message-triggers", () => ({
  useMessageTriggerRules: jest.fn(),
}));

jest.mock("@/services/api", () => ({
  settingsApi: {
    updateMessageAutomationPastTriggerConfig: jest.fn(),
  },
}));

jest.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: jest.fn() }),
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
  ruleOrder: ["rule-one", "rule-two"],
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
    id: "rule-non-sms",
    name: "SMS가 아닌 규칙",
    templateKey: "CLIENT_WELCOME",
  }),
];

function renderDetail() {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
  const cachedPolicies: MessageAutomationPoliciesResponse = {
    policies: [POLICY],
    pastTriggerConfig: PAST_TRIGGER_CONFIG,
  };
  queryClient.setQueryData(MESSAGE_AUTOMATION_POLICIES_QUERY_KEY, cachedPolicies);

  const view = render(
    <QueryClientProvider client={queryClient}>
      <PastTriggerPolicyDetail
        data-component={DATA_COMPONENT}
        policy={POLICY}
        pastTriggerConfig={PAST_TRIGGER_CONFIG}
      />
    </QueryClientProvider>,
  );

  return { ...view, queryClient };
}

describe("PastTriggerPolicyDetail", () => {
  beforeEach(() => {
    mockUseMessageTriggerRules.mockReturnValue({
      data: TRIGGER_RULES,
      isError: false,
      isLoading: false,
    });
    mockedSettingsApi.updateMessageAutomationPastTriggerConfig.mockReset();
    mockedSettingsApi.updateMessageAutomationPastTriggerConfig.mockImplementation(
      async (config) => config,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should render policy rows through PolicyInfoRows", () => {
    renderDetail();

    const policyRows = document.querySelector(
      `[data-component="${DATA_COMPONENT}_rules"][data-source-component="PolicyInfoRows"]`,
    );
    expect(policyRows).toHaveTextContent("규칙");
    expect(policyRows).toHaveTextContent("대상");
    expect(policyRows).toHaveTextContent("늦게 등록된 고객");
  });

  it("should strip non-digit characters from the interval input", () => {
    renderDetail();

    const intervalInput = screen.getByLabelText("늦은 등록 자동 전송 간격");
    fireEvent.change(intervalInput, { target: { value: "12a" } });

    expect(intervalInput).toHaveValue("12");
  });

  it("should enable save only for a dirty interval between 1 and 1440", () => {
    renderDetail();

    const intervalInput = screen.getByLabelText("늦은 등록 자동 전송 간격");
    const saveButton = screen.getByRole("button", { name: "저장" });

    expect(saveButton).toBeDisabled();

    fireEvent.change(intervalInput, { target: { value: "12" } });
    expect(saveButton).toBeEnabled();

    fireEvent.change(intervalInput, { target: { value: "0" } });
    expect(saveButton).toBeDisabled();

    fireEvent.change(intervalInput, { target: { value: "1441" } });
    expect(saveButton).toBeDisabled();
  });

  it("should move the first rule down and enable save", () => {
    renderDetail();

    const moveDownButton = screen.getByRole("button", {
      name: "첫 번째 규칙 아래로 이동",
    });
    fireEvent.click(moveDownButton);

    const rows = screen.getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("두 번째 규칙");
    expect(rows[1]).toHaveTextContent("첫 번째 규칙");
    expect(screen.getByRole("button", { name: "저장" })).toBeEnabled();
  });

  it("should save drafted interval and order then reset dirty state", async () => {
    const { queryClient } = renderDetail();
    const intervalInput = screen.getByLabelText("늦은 등록 자동 전송 간격");
    const saveButton = screen.getByRole("button", { name: "저장" });

    fireEvent.change(intervalInput, { target: { value: "15" } });
    fireEvent.click(
      screen.getByRole("button", { name: "첫 번째 규칙 아래로 이동" }),
    );
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(
        mockedSettingsApi.updateMessageAutomationPastTriggerConfig,
      ).toHaveBeenCalledWith(
        {
          sendIntervalMinutes: 15,
          ruleOrder: ["rule-two", "rule-one"],
        },
        expect.anything(),
      );
    });
    await waitFor(() => expect(saveButton).toBeDisabled());

    expect(
      queryClient.getQueryData<MessageAutomationPoliciesResponse>(
        MESSAGE_AUTOMATION_POLICIES_QUERY_KEY,
      ),
    ).toEqual({
      policies: [POLICY],
      pastTriggerConfig: {
        sendIntervalMinutes: 15,
        ruleOrder: ["rule-two", "rule-one"],
      },
    });
  });

  it("should render only active SMS trigger rules", () => {
    renderDetail();

    expect(screen.getByText("첫 번째 규칙")).toBeInTheDocument();
    expect(screen.getByText("두 번째 규칙")).toBeInTheDocument();
    expect(screen.queryByText("비활성 SMS 규칙")).not.toBeInTheDocument();
    expect(screen.queryByText("SMS가 아닌 규칙")).not.toBeInTheDocument();
  });
});
