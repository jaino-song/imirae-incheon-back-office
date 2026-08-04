import { fireEvent, render, screen } from "@testing-library/react";

import { AgentActionApprovalCard } from "./AgentActionApprovalCard";

const BASE_COMPONENT = "mobile_chat_tests_action-approval";

const defaultProps = {
    "data-component": BASE_COMPONENT,
    actionId: "action-1",
    capability: "messages.send",
    title: "메시지 발송",
    summary: "발송 전에 변경 내용을 확인해 주세요.",
    expiresAt: "2099-08-03T00:00:00.000Z",
    expectedRevision: "revision-1",
    risk: "reversible-write",
    target: { clientId: "client-1" },
    changes: { body: "안내 메시지" },
    provider: "resend",
    estimatedCost: "₩100",
};

describe("AgentActionApprovalCard", () => {
    it("renders the caller ancestry, safety labels, details, and touch-sized actions", () => {
        render(<AgentActionApprovalCard {...defaultProps} />);

        const card = screen.getByLabelText("승인 대기 작업");
        expect(card).toHaveAttribute("data-component", BASE_COMPONENT);
        expect(card).toHaveAttribute("data-source-component", "AgentActionApprovalCard");
        expect(card).toHaveAttribute("data-slot", "action-proposal");
        expect(card.querySelector(`[data-component="${BASE_COMPONENT}_content"]`)).toBeInTheDocument();
        expect(card.querySelector(`[data-component="${BASE_COMPONENT}_header"]`)).toBeInTheDocument();
        expect(card.querySelector(`[data-component="${BASE_COMPONENT}_actions"]`)).toBeInTheDocument();
        expect(screen.getByText("대상 변경")).toBeInTheDocument();
        expect(screen.getByText(/clientId/)).toBeInTheDocument();
        expect(screen.getByText("외부 제공자")).toBeInTheDocument();
        expect(screen.getByText("resend")).toBeInTheDocument();
        expect(screen.getByText("예상 비용")).toBeInTheDocument();
        expect(screen.getByText("₩100")).toBeInTheDocument();

        expect(screen.getByRole("button", { name: "승인하고 실행" })).toHaveClass("min-h-11");
        expect(screen.getByRole("button", { name: "거절" })).toHaveClass("min-h-11");
    });

    it("requires acknowledgement and forwards the token with the revision", () => {
        const onApprove = jest.fn();
        const onReject = jest.fn();
        render(
            <AgentActionApprovalCard
                {...defaultProps}
                acknowledgementToken="ack-token"
                onApprove={onApprove}
                onReject={onReject}
            />,
        );

        const approve = screen.getByRole("button", { name: "승인하고 실행" });
        expect(approve).toBeDisabled();

        fireEvent.click(screen.getByRole("checkbox"));
        expect(approve).toBeEnabled();
        fireEvent.click(approve);
        fireEvent.click(screen.getByRole("button", { name: "거절" }));

        expect(onApprove).toHaveBeenCalledWith("action-1", "revision-1", "ack-token");
        expect(onReject).toHaveBeenCalledWith("action-1");
    });

    it("disables both actions after the action is terminal", () => {
        render(
            <AgentActionApprovalCard
                {...defaultProps}
                terminal
                onApprove={jest.fn()}
                onReject={jest.fn()}
            />,
        );

        expect(screen.getByRole("button", { name: "승인하고 실행" })).toBeDisabled();
        expect(screen.getByRole("button", { name: "거절" })).toBeDisabled();
    });
});
