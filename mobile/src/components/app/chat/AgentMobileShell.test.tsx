import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AgentMobileShell } from "./AgentMobileShell";

jest.mock("@/hooks/useAgentChat", () => ({
    useAgentChat: () => ({
        messages: [],
        status: "ready",
        errorState: null,
        sendMessage: jest.fn(),
        stop: jest.fn(),
        resetBranch: jest.fn(),
        sessions: [{ id: "session-a", title: "첫 대화" }],
        selectSession: jest.fn(),
        deleteSession: jest.fn(),
        approveAction: jest.fn(),
        rejectAction: jest.fn(),
        submitStructuredForm: jest.fn(),
        submitFeedback: jest.fn(),
    }),
}));

describe("AgentMobileShell drawer accessibility", () => {
    it("moves focus into the modal drawer, inerts the app, and restores focus on Escape", async () => {
        const user = userEvent.setup();
        render(<AgentMobileShell />);
        const menu = screen.getByRole("button", { name: "대화 목록" });

        await user.click(menu);

        const dialog = screen.getByRole("dialog", { name: "대화 목록" });
        expect(dialog).toHaveFocus();
        expect(document.querySelector('[data-slot="application-content"]')).toHaveProperty("inert", true);

        await user.keyboard("{Escape}");

        await waitFor(() => expect(screen.queryByRole("dialog", { name: "대화 목록" })).not.toBeInTheDocument());
        expect(menu).toHaveFocus();
        expect(document.querySelector('[data-slot="application-content"]')).toHaveProperty("inert", false);
    });
});
