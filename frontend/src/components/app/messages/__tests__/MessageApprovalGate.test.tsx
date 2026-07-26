import { render, screen } from "@testing-library/react";
import { useQuery } from "@tanstack/react-query";
import { MessageApprovalGate } from "../MessageApprovalGate";

jest.mock("@tanstack/react-query", () => ({
  useQuery: jest.fn(),
}));

const mockedUseQuery = jest.mocked(useQuery);

const APPROVAL_MESSAGE =
  "메시지 발송 승인 후에 설정 가능합니다. 설정에서 메시지 발송 기능을 신청해 주세요.";

function mockSenderApproval(isApproved: boolean, isLoading = false) {
  mockedUseQuery.mockReturnValue({
    data: isLoading
      ? undefined
      : {
          approvalStatus: isApproved ? "approved" : "not_requested",
          isApproved,
          canRequest: !isApproved,
          requestedAt: null,
          approvedAt: isApproved ? "2026-06-05T00:00:00.000Z" : null,
        },
    isLoading,
  } as unknown as ReturnType<typeof useQuery>);
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("MessageApprovalGate", () => {
  it("renders children when the branch is approved", () => {
    mockSenderApproval(true);

    render(
      <MessageApprovalGate dataComponent="desktop_test_message-approval-gate">
        <div>approved content</div>
      </MessageApprovalGate>,
    );

    expect(screen.getByText("approved content")).toBeInTheDocument();
    expect(screen.queryByText(APPROVAL_MESSAGE)).not.toBeInTheDocument();
  });

  it("renders the approval-required notice with the default data-component when unapproved", () => {
    mockSenderApproval(false);

    const { container } = render(
      <MessageApprovalGate dataComponent="desktop_test_message-approval-gate">
        <div>approved content</div>
      </MessageApprovalGate>,
    );

    expect(screen.queryByText("approved content")).not.toBeInTheDocument();
    expect(screen.getByText(APPROVAL_MESSAGE)).toBeInTheDocument();
    expect(
      container.querySelector('[data-component="desktop_test_message-approval-gate_notice"]'),
    ).toBeInTheDocument();
  });

  it("renders children while the approval query is loading", () => {
    mockSenderApproval(false, true);

    render(
      <MessageApprovalGate dataComponent="desktop_test_message-approval-gate">
        <div>approved content</div>
      </MessageApprovalGate>,
    );

    expect(screen.getByText("approved content")).toBeInTheDocument();
    expect(screen.queryByText(APPROVAL_MESSAGE)).not.toBeInTheDocument();
  });
});
