import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { AgentShell } from "./AgentShell";

const mockSendMessage = jest.fn();
const mockRenameSession = jest.fn().mockResolvedValue(true);

jest.mock("next/navigation", () => ({
    useRouter: () => ({ push: jest.fn() }),
}));

jest.mock("@/hooks/useAgentChat", () => ({
    useAgentChat: () => ({
        messages: [],
        sendMessage: mockSendMessage,
        status: "ready",
        error: null,
        actionError: null,
        stop: jest.fn(),
        regenerate: jest.fn(),
        resetBranch: jest.fn(),
        sessions: [{ id: "session-a", title: "첫 대화", updatedAt: "2026-08-03" }],
        selectSession: jest.fn(),
        renameSession: mockRenameSession,
        archiveSession: jest.fn(),
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
});
