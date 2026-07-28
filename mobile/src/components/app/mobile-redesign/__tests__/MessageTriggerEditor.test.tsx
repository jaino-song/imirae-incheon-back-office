import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { MessageTriggerEditor } from "../MessageTriggerEditor";

const createRule = jest.fn();
const updateRule = jest.fn();
const deleteRule = jest.fn();

jest.mock("@/features/message-triggers/hooks/use-message-triggers", () => ({
  useMessageTriggerTemplates: () => ({
    data: [{
      key: "SERVICE_INFO",
      name: "서비스 안내",
      description: "서비스 시작 안내",
      allowedEventTypes: ["SERVICE_START"],
      allowedRecipientTypes: ["CLIENT"],
      requiredVariables: [],
      providers: { sms: { templateKey: "SERVICE_INFO" } },
    }],
    isLoading: false,
  }),
  useCreateMessageTriggerRule: () => ({ mutateAsync: createRule, isPending: false }),
  useUpdateMessageTriggerRule: () => ({ mutateAsync: updateRule, isPending: false }),
  useDeleteMessageTriggerRule: () => ({ mutateAsync: deleteRule, isPending: false }),
}));

describe("MessageTriggerEditor", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    createRule.mockResolvedValue({ id: "new-rule" });
    updateRule.mockResolvedValue({});
    deleteRule.mockResolvedValue({});
  });

  it("creates a mobile automation rule with the same rule fields as desktop", async () => {
    const onClose = jest.fn();
    render(<MessageTriggerEditor rule={null} onClose={onClose} />);

    fireEvent.change(screen.getByLabelText("규칙 이름"), { target: { value: "서비스 시작 안내" } });
    fireEvent.click(screen.getByRole("button", { name: "규칙 저장" }));

    await waitFor(() => expect(createRule).toHaveBeenCalledWith({
      name: "서비스 시작 안내",
      isActive: true,
      eventType: "SERVICE_START",
      offsetType: "BEFORE_DAYS",
      offsetDays: 7,
      recipientType: "CLIENT",
      templateKey: "SERVICE_INFO",
    }));
    expect(onClose).toHaveBeenCalled();
  });

  it("updates and deletes an existing rule", async () => {
    const onClose = jest.fn();
    render(<MessageTriggerEditor
      rule={{
        id: "rule-1",
        branchId: "branch-1",
        name: "기존 규칙",
        isActive: false,
        eventType: "SERVICE_START",
        offsetType: "BEFORE_DAYS",
        offsetDays: 3,
        recipientType: "CLIENT",
        templateKey: "SERVICE_INFO",
        createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-01T00:00:00.000Z",
      }}
      onClose={onClose}
    />);

    fireEvent.change(screen.getByLabelText("규칙 이름"), { target: { value: "수정 규칙" } });
    fireEvent.click(screen.getByRole("button", { name: "규칙 저장" }));

    await waitFor(() => expect(updateRule).toHaveBeenCalledWith({
      id: "rule-1",
      dto: expect.objectContaining({ name: "수정 규칙", isActive: false, offsetDays: 3 }),
    }));

    fireEvent.click(screen.getByRole("button", { name: "규칙 삭제" }));
    fireEvent.click(screen.getByRole("button", { name: "삭제 확인" }));

    await waitFor(() => expect(deleteRule).toHaveBeenCalledWith("rule-1"));
  });
});
