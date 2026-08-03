import { render, screen } from "@testing-library/react";

import { MobileAgentPartRegistry } from "./MobileAgentPartRegistry";

describe("MobileAgentPartRegistry", () => {
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
});
