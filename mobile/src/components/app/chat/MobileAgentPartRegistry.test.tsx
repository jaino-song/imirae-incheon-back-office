import { fireEvent, render, screen } from "@testing-library/react";

import { MobileAgentPartRegistry } from "./MobileAgentPartRegistry";

describe("MobileAgentPartRegistry", () => {
    it("preserves the entity domain when selecting a choice", () => {
        const onEntitySelect = jest.fn();
        render(<MobileAgentPartRegistry
            part={{
                type: "data-entity-choice",
                data: {
                    entityType: "employees",
                    prompt: "직원 선택",
                    choices: [{ id: "employee-1", label: "김직원" }, { id: "employee-2", label: "이직원" }],
                },
            }}
            onEntitySelect={onEntitySelect}
            onApproveAction={jest.fn()}
            onRejectAction={jest.fn()}
            onSubmitForm={jest.fn()}
        />);

        fireEvent.click(screen.getByRole("button", { name: "김직원" }));
        expect(onEntitySelect).toHaveBeenCalledWith("employee-1", "employees");
    });

    it("renders sanitized terminal failure details for operator recovery", () => {
        render(<MobileAgentPartRegistry
            part={{
                type: "data-action-result",
                data: {
                    actionId: "action-1",
                    status: "failed",
                    summary: "일부 구독에 전달하지 못했습니다.",
                    result: { status: "partial", delivered: 1, failed: 2, notificationId: 9 },
                },
            }}
            onEntitySelect={jest.fn()}
            onApproveAction={jest.fn()}
            onRejectAction={jest.fn()}
            onSubmitForm={jest.fn()}
        />);

        expect(screen.getByText("실패")).toBeInTheDocument();
        expect(screen.getByText("처리 상세")).toBeInTheDocument();
        expect(screen.getByText(/"delivered": 1/)).toBeInTheDocument();
        expect(screen.getByText(/"failed": 2/)).toBeInTheDocument();
    });

    it("requires acknowledgement when a reversible proposal carries a server token", () => {
        const onApproveAction = jest.fn();
        render(<MobileAgentPartRegistry
            part={{
                type: "data-action-proposal",
                data: {
                    actionId: "action-reversible",
                    capability: "contracts.prepareDispatch",
                    title: "계약 준비",
                    summary: "계약 발송 준비 정보를 확인합니다.",
                    expiresAt: "2099-08-03T00:00:00.000Z",
                    expectedRevision: "revision-1",
                    risk: "reversible-write",
                    changes: { clientId: 1 },
                    acknowledgementToken: "ack-token",
                },
            }}
            onEntitySelect={jest.fn()}
            onApproveAction={onApproveAction}
            onRejectAction={jest.fn()}
            onSubmitForm={jest.fn()}
        />);
        const approve = screen.getByRole("button", { name: "승인하고 실행" });

        expect(approve).toBeDisabled();
        fireEvent.click(screen.getByRole("checkbox"));
        expect(approve).toBeEnabled();
        fireEvent.click(approve);
        expect(onApproveAction).toHaveBeenCalledWith("action-reversible", "revision-1", "ack-token");
    });
});
