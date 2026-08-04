import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { AgentShell } from "./AgentShell";

const mockSendMessage = jest.fn();
const mockRenameSession = jest.fn().mockResolvedValue(true);
const mockAgentChatState: {
    status: "ready" | "submitted" | "streaming";
    messages: Array<{ id: string; role: "assistant"; parts: Array<{ type: string; data?: unknown }> }>;
    error: Error | null;
    actionError: { code: string; message: string; effectState: "nothing-happened" | "succeeded-unconfirmed" | "partial" } | null;
} = { status: "ready", messages: [], error: null, actionError: null };

jest.mock("next/navigation", () => ({
    useRouter: () => ({ push: jest.fn() }),
}));

jest.mock("@/hooks/useAgentChat", () => ({
    useAgentChat: () => ({
        messages: mockAgentChatState.messages,
        sendMessage: mockSendMessage,
        status: mockAgentChatState.status,
        error: mockAgentChatState.error,
        actionError: mockAgentChatState.actionError,
        stop: jest.fn(),
        regenerate: jest.fn(),
        resetBranch: jest.fn(),
        sessions: [{ id: "session-a", title: "첫 대화", updatedAt: "2026-08-03" }],
        selectSession: jest.fn(),
        renameSession: mockRenameSession,
        deleteSession: jest.fn(),
        approveAction: jest.fn(),
        rejectAction: jest.fn(),
        submitStructuredForm: jest.fn(),
        submitFeedback: jest.fn(),
    }),
}));

describe("AgentShell input composition", () => {
    beforeEach(() => {
        mockSendMessage.mockClear();
        mockRenameSession.mockClear();
        mockAgentChatState.status = "ready";
        mockAgentChatState.messages = [];
        mockAgentChatState.error = null;
        mockAgentChatState.actionError = null;
        const media = {
            matches: false,
            addEventListener: jest.fn(),
            removeEventListener: jest.fn(),
        };
        Object.defineProperty(window, "matchMedia", {
            configurable: true,
            value: jest.fn(() => media),
        });
    });

    it("does not submit the composer while Korean IME is composing", () => {
        render(<AgentShell />);
        const composer = screen.getByRole("textbox", { name: "질문 입력" });

        fireEvent.change(composer, { target: { value: "한글" } });
        fireEvent.keyDown(composer, { key: "Enter", isComposing: true });
        expect(mockSendMessage).not.toHaveBeenCalled();

        fireEvent.keyDown(composer, { key: "Enter", isComposing: false });
        expect(mockSendMessage).toHaveBeenCalledWith({ text: "한글" });
    });

    it("does not rename a session while Korean IME is composing", async () => {
        render(<AgentShell />);
        fireEvent.click(screen.getByRole("button", { name: "첫 대화 이름 변경" }));
        const renameInput = screen.getByRole("textbox", { name: "대화 제목" });
        fireEvent.change(renameInput, { target: { value: "새 제목" } });

        fireEvent.keyDown(renameInput, { key: "Enter", isComposing: true });
        expect(mockRenameSession).not.toHaveBeenCalled();

        fireEvent.keyDown(renameInput, { key: "Enter", isComposing: false });
        await waitFor(() => expect(mockRenameSession).toHaveBeenCalledWith("session-a", "새 제목"));
    });

    it("does not render the desktop archive action while retaining rename and delete actions", () => {
        render(<AgentShell />);

        expect(screen.queryByRole("button", { name: "첫 대화 보관" })).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: "첫 대화 이름 변경" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "첫 대화 삭제" })).toBeInTheDocument();
    });

    it.each(["submitted", "streaming"] as const)("disables structured forms while the agent status is %s", (status) => {
        mockAgentChatState.status = status;
        mockAgentChatState.messages = [{
            id: "assistant-form",
            role: "assistant",
            parts: [{
                type: "data-form",
                data: {
                    formId: "profile-form",
                    title: "프로필",
                    schemaVersion: "1",
                    fields: [{ name: "name", label: "이름", type: "text" }],
                },
            }],
        }];

        render(<AgentShell />);

        expect(screen.getByRole("button", { name: "입력 제출" })).toBeDisabled();
        expect(screen.getByRole("heading", { name: "프로필" }).closest("form")).toHaveAttribute("aria-busy", "true");
    });

    it("keeps stream and action errors in separate completed namespaces", () => {
        mockAgentChatState.error = new Error("stream failed");
        mockAgentChatState.actionError = { code: "action_failed", message: "작업 결과를 확인하세요.", effectState: "partial" };

        render(<AgentShell />);

        const alerts = screen.getAllByRole("alert");
        expect(alerts).toHaveLength(2);
        expect(alerts[0]).toHaveAttribute("data-component", "desktop_chat_agent-shell_thread_messages_stream-error");
        expect(alerts[1]).toHaveAttribute("data-component", "desktop_chat_agent-shell_thread_messages_action-error");
    });
});
