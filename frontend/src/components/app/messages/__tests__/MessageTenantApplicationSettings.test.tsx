import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useGetAuthUser } from "@/hooks/useGetAuthUser";
import { settingsApi, type MessageAutomationPoliciesResponse } from "@/services/api";
import type { MessageTriggerRule } from "@/features/message-triggers/types";

import { MessageTenantApplicationSettings } from "../MessageTenantApplicationSettings";

jest.mock("@tanstack/react-query", () => ({
  useQuery: jest.fn(),
  useMutation: jest.fn(),
  useQueryClient: jest.fn(),
}));

jest.mock("@/hooks/useGetAuthUser", () => ({
  useGetAuthUser: jest.fn(),
}));

jest.mock("@/hooks/use-toast", () => ({
  useToast: () => ({
    toast: jest.fn(),
  }),
}));

jest.mock("@/services/api", () => ({
  settingsApi: {
    getMessageSenderApproval: jest.fn(),
    getMessageAutomationPolicies: jest.fn(),
    getClientRegistrationPolicy: jest.fn(),
    updateClientRegistrationPolicy: jest.fn(),
    updateMessageAutomationPastTriggerConfig: jest.fn(),
    requestMessageSenderApproval: jest.fn(),
  },
}));

const mockedUseQuery = jest.mocked(useQuery);
const mockedUseMutation = jest.mocked(useMutation);
const mockedUseQueryClient = jest.mocked(useQueryClient);
const mockedUseGetAuthUser = jest.mocked(useGetAuthUser);
const mockedSettingsApi = jest.mocked(settingsApi);

const mockInvalidateQueries = jest.fn();
const mockSetQueryData = jest.fn();
const mockCancelQueries = jest.fn();
const mockGetQueryData = jest.fn();

const DEFAULT_TRIGGER_RULES: MessageTriggerRule[] = [
  {
    id: "trigger-rule-1",
    branchId: "branch-1",
    name: "인사 메시지",
    isActive: true,
    eventType: "CLIENT_CREATED",
    offsetType: "IMMEDIATE",
    offsetDays: 0,
    recipientType: "CLIENT",
    templateKey: "CLIENT_GREETING",
    createdAt: "2026-07-09T00:00:00.000Z",
    updatedAt: "2026-07-09T00:00:00.000Z",
  },
  {
    id: "trigger-rule-2",
    branchId: "branch-1",
    name: "서비스 안내",
    isActive: true,
    eventType: "SERVICE_START",
    offsetType: "BEFORE_DAYS",
    offsetDays: 7,
    recipientType: "CLIENT",
    templateKey: "SERVICE_INFO",
    createdAt: "2026-07-09T00:00:00.000Z",
    updatedAt: "2026-07-09T00:00:00.000Z",
  },
  {
    id: "trigger-rule-3",
    branchId: "branch-1",
    name: "리마인더",
    isActive: true,
    eventType: "SERVICE_START",
    offsetType: "BEFORE_DAYS",
    offsetDays: 1,
    recipientType: "CLIENT",
    templateKey: "REMINDER",
    createdAt: "2026-07-09T00:00:00.000Z",
    updatedAt: "2026-07-09T00:00:00.000Z",
  },
  {
    id: "trigger-rule-4",
    branchId: "branch-1",
    name: "비용 안내",
    isActive: true,
    eventType: "SERVICE_START",
    offsetType: "SAME_DAY",
    offsetDays: 0,
    recipientType: "CLIENT",
    templateKey: "PRICE_INFO",
    createdAt: "2026-07-09T00:00:00.000Z",
    updatedAt: "2026-07-09T00:00:00.000Z",
  },
  {
    id: "trigger-rule-5",
    branchId: "branch-1",
    name: "감사 메시지",
    isActive: true,
    eventType: "SERVICE_END",
    offsetType: "AFTER_DAYS",
    offsetDays: 1,
    recipientType: "CLIENT",
    templateKey: "THANKS",
    createdAt: "2026-07-09T00:00:00.000Z",
    updatedAt: "2026-07-09T00:00:00.000Z",
  },
  {
    id: "trigger-rule-6",
    branchId: "branch-1",
    name: "설문 요청",
    isActive: true,
    eventType: "SERVICE_END",
    offsetType: "AFTER_DAYS",
    offsetDays: 2,
    recipientType: "CLIENT",
    templateKey: "SURVEY",
    createdAt: "2026-07-09T00:00:00.000Z",
    updatedAt: "2026-07-09T00:00:00.000Z",
  },
];

const DEFAULT_AUTOMATION_POLICIES: MessageAutomationPoliciesResponse = {
  pastTriggerConfig: {
    sendIntervalMinutes: 1,
    ruleOrder: [],
  },
  policies: [
    {
      id: "service-feedback-link",
      title: "제공기록지 전송 자동화 규칙",
      description: "API에서 내려준 제공기록지 전송 설명",
      active: true,
      requiresApproval: true,
      rows: [
        { id: "send-time", label: "발송 시점", value: "서비스 시작일 오후 3시" },
        { id: "recipient", label: "수신 대상", value: "주 담당 제공인력" },
      ],
    },
    {
      id: "past-trigger",
      title: "지난 자동 전송 처리 규칙",
      description: "API에서 내려준 지난 자동 전송 설명",
      active: true,
      requiresApproval: true,
      rows: [
        { id: "condition", label: "조건", value: "API 기준 이미 지난 트리거" },
        { id: "action", label: "동작", value: "API 기준 지난 루틴 미실행" },
      ],
    },
    {
      id: "sms-retry",
      title: "SMS 재시도 규칙",
      description: "API에서 내려준 SMS 재시도 설명",
      active: true,
      requiresApproval: false,
      rows: [
        { id: "count", label: "재시도 횟수", value: "최대 2회" },
        { id: "interval", label: "재시도 간격", value: "실패 후 5분" },
      ],
    },
  ],
};

function getQueryKey(options: unknown) {
  if (typeof options !== "object" || options === null || !("queryKey" in options)) {
    return undefined;
  }

  return (options as { queryKey?: readonly unknown[] }).queryKey;
}

function mockSettingsQueries(
  isApproved: boolean,
  automationPolicies: MessageAutomationPoliciesResponse = DEFAULT_AUTOMATION_POLICIES,
  triggerRules: MessageTriggerRule[] = DEFAULT_TRIGGER_RULES,
) {
  mockedUseQuery.mockImplementation(((options: unknown) => {
    const queryKey = getQueryKey(options);

    if (queryKey?.[0] === "settings" && queryKey[1] === "message-sender-approval") {
      return {
        data: {
          approvalStatus: isApproved ? "approved" : "not_requested",
          isApproved,
          canRequest: !isApproved,
          requestedAt: null,
          approvedAt: isApproved ? "2026-06-05T00:00:00.000Z" : null,
        },
        isLoading: false,
      } as unknown as ReturnType<typeof useQuery>;
    }

    if (queryKey?.[0] === "settings" && queryKey[1] === "message-automation-policies") {
      return {
        data: automationPolicies,
        isLoading: false,
      } as unknown as ReturnType<typeof useQuery>;
    }

    if (queryKey?.[0] === "settings" && queryKey[1] === "client-registration-policy") {
      return { data: { clientAutoRegistration: true, greetingOnAutoRegistration: false }, isLoading: false } as unknown as ReturnType<typeof useQuery>;
    }

    if (queryKey?.[0] === "message-triggers" && queryKey[1] === "list") {
      return {
        data: triggerRules,
        isLoading: false,
      } as unknown as ReturnType<typeof useQuery>;
    }

    return {
      data: undefined,
      isLoading: false,
    } as unknown as ReturnType<typeof useQuery>;
  }) as unknown as typeof useQuery);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedUseGetAuthUser.mockReturnValue({
    data: {
      id: "user-1",
      name: "송진호",
      branchName: "인천점",
    },
  } as unknown as ReturnType<typeof useGetAuthUser>);
  mockedUseQueryClient.mockReturnValue({
    invalidateQueries: mockInvalidateQueries,
    setQueryData: mockSetQueryData,
    cancelQueries: mockCancelQueries,
    getQueryData: mockGetQueryData,
  } as unknown as ReturnType<typeof useQueryClient>);
  mockedSettingsApi.getMessageAutomationPolicies.mockResolvedValue(DEFAULT_AUTOMATION_POLICIES);
  mockedSettingsApi.updateMessageAutomationPastTriggerConfig.mockImplementation(async (config) => config);
  mockedSettingsApi.updateClientRegistrationPolicy.mockImplementation(async (patch) => ({
    clientAutoRegistration: true,
    greetingOnAutoRegistration: false,
    ...patch,
  }));
  mockedUseMutation.mockImplementation(((options: {
    mutationFn?: (variables?: unknown) => unknown;
    onSuccess?: (data: unknown, variables: unknown, context: unknown) => unknown;
    onError?: (error: unknown, variables: unknown, context: unknown) => unknown;
  }) => {
    return {
      mutate: (variables?: unknown) => {
        Promise.resolve((options as { onMutate?: (variables: unknown) => unknown }).onMutate?.(variables))
          .then((context) => Promise.resolve(options.mutationFn?.(variables))
            .then((data) => options.onSuccess?.(data, variables, context))
            .catch((error) => options.onError?.(error, variables, context)));
      },
      isPending: false,
    };
  }) as unknown as typeof useMutation);
});

describe("MessageTenantApplicationSettings", () => {
  it("renders and updates the client registration policy switches", async () => {
    mockSettingsQueries(true);
    render(<MessageTenantApplicationSettings />);

    fireEvent.click(screen.getByText("고객 자동 등록"));
    const autoRegistration = screen.getByRole("switch", { name: "전자문서 생성 시 고객 자동 등록" });
    const greeting = screen.getByRole("switch", { name: "자동 등록 시 인사 문자 발송" });
    expect(autoRegistration).toBeChecked();
    expect(greeting).not.toBeDisabled();

    fireEvent.click(greeting);
    await waitFor(() => expect(mockedSettingsApi.updateClientRegistrationPolicy).toHaveBeenCalledWith({ greetingOnAutoRegistration: true }));
    expect(mockSetQueryData).toHaveBeenCalled();
  });

  it("rolls back the client registration policy when saving fails", async () => {
    mockSettingsQueries(true);
    const previous = { clientAutoRegistration: true, greetingOnAutoRegistration: false };
    mockGetQueryData.mockReturnValue(previous);
    mockedSettingsApi.updateClientRegistrationPolicy.mockRejectedValueOnce(new Error("failed"));
    render(<MessageTenantApplicationSettings />);

    fireEvent.click(screen.getByText("고객 자동 등록"));
    fireEvent.click(screen.getByRole("switch", { name: "자동 등록 시 인사 문자 발송" }));

    await waitFor(() => expect(mockSetQueryData).toHaveBeenCalledWith(
      ["settings", "client-registration-policy"],
      previous,
    ));
  });
  it("renders automation policy items from the API", async () => {
    mockSettingsQueries(true, {
      pastTriggerConfig: DEFAULT_AUTOMATION_POLICIES.pastTriggerConfig,
      policies: [
        {
          id: "service-feedback-link",
          title: "API 제공기록지 정책",
          description: "API 제공기록지 설명",
          active: true,
          requiresApproval: true,
          rows: [
            { id: "send-time", label: "발송 시점", value: "API 오후 3시" },
          ],
        },
        {
          id: "past-trigger",
          title: "API 지난 루틴 정책",
          description: "API 지난 루틴 설명",
          active: false,
          requiresApproval: true,
          rows: [
            { id: "action", label: "동작", value: "API 지난 루틴 미실행" },
          ],
        },
        {
          id: "sms-retry",
          title: "API SMS 재시도 정책",
          description: "API SMS 재시도 설명",
          active: true,
          requiresApproval: false,
          rows: [
            { id: "count", label: "재시도 횟수", value: "API 최대 4회" },
          ],
        },
      ],
    });

    const { container } = render(<MessageTenantApplicationSettings />);

    expect(screen.getAllByText("설정").length).toBeGreaterThan(0);
    expect(screen.queryByText("메시지 발송 기능 신청")).not.toBeInTheDocument();
    expect(screen.getAllByText("API 제공기록지 정책").length).toBeGreaterThan(0);
    expect(screen.getByText("API 오후 3시")).toBeInTheDocument();
    expect(screen.getByText("API 지난 루틴 정책")).toBeInTheDocument();
    expect(screen.getByText("API SMS 재시도 정책")).toBeInTheDocument();
    expect(screen.getAllByText("중복 전송 확인").length).toBeGreaterThan(0);
    const servicePolicySwitch = screen.getByRole("switch", { name: "API 제공기록지 정책 활성화" });
    const inactivePolicySwitch = screen.getByRole("switch", { name: "API 지난 루틴 정책 활성화" });
    const smsPolicySwitch = screen.getByRole("switch", { name: "API SMS 재시도 정책 활성화" });

    expect(servicePolicySwitch).toBeDisabled();
    expect(servicePolicySwitch).toHaveAttribute("aria-checked", "true");
    expect(inactivePolicySwitch).toBeDisabled();
    expect(inactivePolicySwitch).toHaveAttribute("aria-checked", "false");
    expect(smsPolicySwitch).toBeDisabled();
    expect(smsPolicySwitch).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("switch", { name: "중복 전송 확인 활성화" })).toHaveAttribute(
      "aria-checked",
      "true",
    );

    fireEvent.click(screen.getByText("API 지난 루틴 정책"));

    expect(screen.getByText("API 지난 루틴 미실행")).toBeInTheDocument();
    expect(screen.getByText("전송 간격")).toBeInTheDocument();
    const intervalInput = screen.getByRole("spinbutton", { name: "늦은 등록 자동 전송 간격" });
    expect(intervalInput).toHaveValue(1);
    expect(screen.getByRole("button", { name: "저장" })).toBeDisabled();
    fireEvent.change(intervalInput, { target: { value: "10" } });
    expect(intervalInput).toHaveValue(10);
    expect(screen.getByText("늦은 등록 자동 전송 순서")).toBeInTheDocument();
    for (const rule of DEFAULT_TRIGGER_RULES) {
      expect(screen.getByText(rule.name)).toBeInTheDocument();
    }
    expect(container.querySelectorAll('[data-source-component="InfoRow"][data-component^="messages-settings-past-trigger-policy-order-trigger-rule-"]')).toHaveLength(6);
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() => {
      expect(mockedSettingsApi.updateMessageAutomationPastTriggerConfig).toHaveBeenCalledWith({
        sendIntervalMinutes: 10,
        ruleOrder: DEFAULT_TRIGGER_RULES.map((rule) => rule.id),
      });
    });

    fireEvent.click(screen.getAllByText("중복 전송 확인")[0]);

    expect(screen.getByText("최근 72시간")).toBeInTheDocument();
    expect(container.querySelector('[data-component="messages-settings-duplicate-send-policy"]')).toBeInTheDocument();
  });

  it("SMS retry row shows the API-provided value, not hardcoded copy", () => {
    mockSettingsQueries(true, {
      pastTriggerConfig: DEFAULT_AUTOMATION_POLICIES.pastTriggerConfig,
      policies: [
        {
          id: "sms-retry",
          title: "SMS 재시도 규칙",
          description: "API에서 내려준 SMS 재시도 설명",
          active: true,
          requiresApproval: false,
          rows: [
            { id: "count", label: "재시도 횟수", value: "최대 9회" },
            { id: "interval", label: "재시도 간격", value: "실패 후 1분" },
          ],
        },
      ],
    });

    render(<MessageTenantApplicationSettings />);

    expect(screen.getByText("최대 9회")).toBeInTheDocument();
    expect(screen.queryByText("최대 2회")).not.toBeInTheDocument();
  });

  it("excludes inactive trigger rules from the retroactive order settings and save payload", async () => {
    const inactiveReminder = {
      ...DEFAULT_TRIGGER_RULES[2],
      isActive: false,
    };
    const triggerRules = [
      DEFAULT_TRIGGER_RULES[0],
      DEFAULT_TRIGGER_RULES[1],
      inactiveReminder,
      DEFAULT_TRIGGER_RULES[3],
    ];
    mockSettingsQueries(true, {
      ...DEFAULT_AUTOMATION_POLICIES,
      pastTriggerConfig: {
        sendIntervalMinutes: 1,
        ruleOrder: triggerRules.map((rule) => rule.id),
      },
    }, triggerRules);

    render(<MessageTenantApplicationSettings />);

    fireEvent.click(screen.getByText("지난 자동 전송 처리 규칙"));

    expect(screen.getByText(DEFAULT_TRIGGER_RULES[0].name)).toBeInTheDocument();
    expect(screen.getByText(DEFAULT_TRIGGER_RULES[1].name)).toBeInTheDocument();
    expect(screen.queryByText(inactiveReminder.name)).not.toBeInTheDocument();
    expect(screen.getByText(DEFAULT_TRIGGER_RULES[3].name)).toBeInTheDocument();

    const intervalInput = screen.getByRole("spinbutton", { name: "늦은 등록 자동 전송 간격" });
    fireEvent.change(intervalInput, { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() => {
      expect(mockedSettingsApi.updateMessageAutomationPastTriggerConfig).toHaveBeenCalledWith({
        sendIntervalMinutes: 2,
        ruleOrder: [
          DEFAULT_TRIGGER_RULES[0].id,
          DEFAULT_TRIGGER_RULES[1].id,
          DEFAULT_TRIGGER_RULES[3].id,
        ],
      });
    });
  });

  it("shows the sender application item and duplicate send policy before approval", () => {
    mockSettingsQueries(false);

    const { container } = render(<MessageTenantApplicationSettings />);

    expect(screen.getAllByText("메시지 발송 기능 신청").length).toBeGreaterThan(0);
    expect(screen.getByText("제공기록지 전송 자동화 규칙")).toBeInTheDocument();
    expect(screen.getByText("지난 자동 전송 처리 규칙")).toBeInTheDocument();
    expect(screen.getByText("SMS 재시도 규칙")).toBeInTheDocument();
    expect(screen.getByText("중복 전송 확인")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "제공기록지 전송 자동화 규칙 활성화" })).toBeInTheDocument();
    expect(container.querySelector('[data-component="messages-settings-tenant-application"]')).toBeInTheDocument();
  });

  it("policy switches stay disabled while unapproved and only approval-gated active policies render off", () => {
    mockSettingsQueries(false);

    render(<MessageTenantApplicationSettings />);

    const approvalGatedSwitchNames = [
      "제공기록지 전송 자동화 규칙 활성화",
      "지난 자동 전송 처리 규칙 활성화",
      "중복 전송 확인 활성화",
    ];

    for (const name of approvalGatedSwitchNames) {
      const policySwitch = screen.getByRole("switch", { name });
      expect(policySwitch).toBeDisabled();
      expect(policySwitch).toHaveAttribute("aria-checked", "false");
    }

    const nonApprovalGatedSwitchNames = [
      "SMS 재시도 규칙 활성화",
    ];

    for (const name of nonApprovalGatedSwitchNames) {
      const policySwitch = screen.getByRole("switch", { name });
      expect(policySwitch).toBeDisabled();
      expect(policySwitch).toHaveAttribute("aria-checked", "true");
    }

    // Clicking a disabled switch must not toggle it on.
    fireEvent.click(screen.getByRole("switch", { name: approvalGatedSwitchNames[0] }));
    expect(screen.getByRole("switch", { name: approvalGatedSwitchNames[0] })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("sender application submit posts the approval request and refetches the approval state", async () => {
    mockSettingsQueries(false);
    mockedSettingsApi.requestMessageSenderApproval.mockResolvedValue({
      approvalStatus: "pending",
      isApproved: false,
      canRequest: false,
      requestedAt: "2026-07-09T00:00:00.000Z",
      approvedAt: null,
    });

    render(<MessageTenantApplicationSettings />);

    for (const checkbox of screen.getAllByRole("checkbox")) {
      fireEvent.click(checkbox);
    }

    fireEvent.click(screen.getByRole("button", { name: "메시지 발송 신청하기" }));

    await waitFor(() => {
      expect(mockedSettingsApi.requestMessageSenderApproval).toHaveBeenCalledTimes(1);
    });

    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ["settings", "message-sender-approval"],
    });
  });
});
