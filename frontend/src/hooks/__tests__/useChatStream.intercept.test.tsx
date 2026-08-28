import { renderHook, act } from "@testing-library/react";
import { useChatStream, ChatMessage } from "../useChatStream";

describe("useChatStream command intercept", () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
        globalThis.fetch = jest.fn();
        localStorage.clear();
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    test("intercepts '산모 등록' and does not call SSE endpoint", async () => {
        const { result } = renderHook(() => useChatStream());

        await act(async () => {
            await result.current.sendMessage("산모 등록");
        });

        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
        expect((globalThis.fetch as jest.Mock).mock.calls[0]?.[0]).toBe("/api/ai/chat/persist");
        expect(result.current.messages.some((m: ChatMessage) => m.ui?.type === "clientRegistrationWizard")).toBe(true);
    });

    test("keeps the extracted provider name in the registration draft", async () => {
        const { result } = renderHook(() => useChatStream());

        await act(async () => {
            await result.current.sendMessage("산모 등록. 이름은 홍길동이야. 관리사는 김영희야.");
        });

        expect(result.current.messages.at(-1)?.ui?.registrationDraft).toEqual(
            expect.objectContaining({ employeeName: "김영희" }),
        );
    });

    test("restores a prompted registration wizard marker from history", async () => {
        (globalThis.fetch as jest.Mock).mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                messages: [{
                    role: "assistant",
                    content: "[산모 등록 위자드 표시됨] 연락처 알려주세요.",
                    timestamp: "2026-08-28T00:00:00.000Z",
                }],
                sessionId: "session-1",
                hasMore: false,
                total: 1,
            }),
        });
        const { result } = renderHook(() => useChatStream());

        await act(async () => {
            await result.current.loadHistory();
        });

        expect(result.current.messages).toEqual([expect.objectContaining({
            content: "",
            ui: { type: "clientRegistrationWizard" },
        })]);
    });
});
