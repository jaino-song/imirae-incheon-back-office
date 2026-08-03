import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AgentMobileShell } from "./AgentMobileShell";

const mockSendMessage = jest.fn();

jest.mock("@/hooks/useAgentChat", () => ({
    useAgentChat: () => ({
        messages: [],
        status: "ready",
        errorState: null,
        sendMessage: mockSendMessage,
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
    beforeEach(() => mockSendMessage.mockClear());

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

    it("does not submit the composer while Korean IME is composing", () => {
        render(<AgentMobileShell />);
        const composer = screen.getByRole("textbox", { name: "질문 입력" });

        fireEvent.change(composer, { target: { value: "한글" } });
        fireEvent.keyDown(composer, { key: "Enter", isComposing: true });
        expect(mockSendMessage).not.toHaveBeenCalled();

        fireEvent.keyDown(composer, { key: "Enter", isComposing: false });
        expect(mockSendMessage).toHaveBeenCalledWith("한글");
    });
});
