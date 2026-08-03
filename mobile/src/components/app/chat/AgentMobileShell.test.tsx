import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AgentMobileShell } from "./AgentMobileShell";

const mockSendMessage = jest.fn();
const mockMessages: unknown[] = [];

jest.mock("@/hooks/useAgentChat", () => ({
    useAgentChat: () => ({
        messages: mockMessages,
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
    beforeEach(() => {
        mockMessages.length = 0;
        mockSendMessage.mockClear();
    });

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

    it("passes the full message ancestry to action approval parts", () => {
        mockMessages.push({
            id: "assistant-approval",
            role: "assistant",
            parts: [{
                type: "data-action-proposal",
                data: {
                    actionId: "action-1",
                    capability: "messages.send",
                    title: "메시지 발송",
                    summary: "발송 전에 확인해 주세요.",
                    expiresAt: "2099-08-03T00:00:00.000Z",
                    expectedRevision: "revision-1",
                    changes: { body: "안내" },
                },
            }],
        });

        render(<AgentMobileShell />);

        expect(screen.getByLabelText("승인 대기 작업")).toHaveAttribute(
            "data-component",
            "mobile_chat_agent-shell_thread_message-assistant_part-0_action-approval",
        );
    });
});
