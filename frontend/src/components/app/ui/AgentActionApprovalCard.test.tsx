import { render, screen } from "@testing-library/react";

import { AgentActionApprovalCard } from "./AgentActionApprovalCard";

describe("AgentActionApprovalCard", () => {
    const dataComponent = "desktop_chat_tests_agent-part-registry_action-approval";

    it("composes the shared Card primitives and exposes its owned slots", () => {
        render(
            <AgentActionApprovalCard
                data-component={dataComponent}
                actionId="action-1"
                capability="clients.update"
                title="고객 정보 수정"
                summary="변경 내용을 확인해 주세요."
                expiresAt="2099-08-03T00:00:00.000Z"
                expectedRevision="revision-1"
                changes={{ name: "홍길동" }}
            />,
        );

        const card = screen.getByLabelText("승인 대기 작업");
        expect(card).toHaveAttribute("data-component", dataComponent);
        expect(card).toHaveAttribute("data-source-component", "Card");
        expect(card.querySelector(`[data-component="${dataComponent}_content"]`)).toBeInTheDocument();
        expect(card.querySelector('[data-source-component="CardContent"]')).toBeInTheDocument();
        expect(card.querySelector(`[data-component="${dataComponent}_content_summary"]`)).toBeInTheDocument();
        expect(card.querySelector('[data-slot="actions"]')).toBeInTheDocument();
    });
});
