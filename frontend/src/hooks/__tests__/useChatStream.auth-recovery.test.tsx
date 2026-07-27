import { act, renderHook, waitFor } from "@testing-library/react";
import { ReadableStream } from "stream/web";
import { TextDecoder, TextEncoder } from "util";

import { useChatStream } from "../useChatStream";

const SESSION_EXPIRED_MESSAGE =
    "세션이 만료되었습니다. 페이지를 새로고침하거나 다시 로그인해 주세요.";
const TEMPORARY_ERROR_MESSAGE =
    "일시적인 오류로 응답을 가져오지 못했습니다. 잠시 후 다시 시도해 주세요.";

function createSSEStream(events: string[]): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();

    return new ReadableStream<Uint8Array>({
        start(controller) {
            events.forEach((event) => controller.enqueue(encoder.encode(event)));
            controller.close();
        },
    });
}

function createResponse({
    body,
    ok,
    status,
}: {
    body?: ReadableStream<Uint8Array>;
    ok: boolean;
    status: number;
}): Response {
    return {
        body: body ?? null,
        ok,
        status,
    } as unknown as Response;
}

describe("useChatStream auth recovery", () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
        localStorage.clear();
        Object.assign(globalThis, {
            TextEncoder,
            TextDecoder: TextDecoder as unknown as typeof globalThis.TextDecoder,
        });
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    test("refreshes an expired session and retries the stream request once", async () => {
        const fetchMock = jest
            .fn()
            .mockResolvedValueOnce(createResponse({ ok: false, status: 401 }))
            .mockResolvedValueOnce(createResponse({ ok: true, status: 200 }))
            .mockResolvedValueOnce(
                createResponse({
                    body: createSSEStream([
                        'data: {"type":"chunk","content":"갱신 성공"}\n\n',
                        'data: {"type":"done","sessionId":"refreshed-session"}\n\n',
                    ]),
                    ok: true,
                    status: 200,
                }),
            );
        globalThis.fetch = fetchMock as typeof fetch;

        const { result } = renderHook(() => useChatStream());

        await act(async () => {
            await result.current.sendMessage("안녕");
        });

        expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
            "/api/ai/chat/stream",
            "/api/auth/refresh",
            "/api/ai/chat/stream",
        ]);
        expect(result.current.messages.at(-1)?.content).toBe("갱신 성공");
        expect(result.current.state).toBe("complete");
    });

    test("shows a session-expired message when the retried stream is still unauthorized", async () => {
        const fetchMock = jest
            .fn()
            .mockResolvedValueOnce(createResponse({ ok: false, status: 401 }))
            .mockResolvedValueOnce(createResponse({ ok: true, status: 200 }))
            .mockResolvedValueOnce(createResponse({ ok: false, status: 401 }));
        globalThis.fetch = fetchMock as typeof fetch;
        jest.spyOn(console, "error").mockImplementation(() => undefined);

        const { result } = renderHook(() => useChatStream());

        await act(async () => {
            await result.current.sendMessage("안녕");
        });

        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(result.current.messages.at(-1)?.content).toBe(SESSION_EXPIRED_MESSAGE);
        expect(result.current.error).toBe(SESSION_EXPIRED_MESSAGE);
        expect(result.current.state).toBe("error");
    });

    test("shows a temporary-error message for server failures", async () => {
        jest.useFakeTimers();
        const fetchMock = jest
            .fn()
            .mockResolvedValueOnce(createResponse({ ok: false, status: 500 }))
            .mockResolvedValueOnce(createResponse({ ok: false, status: 500 }));
        globalThis.fetch = fetchMock as typeof fetch;
        jest.spyOn(console, "error").mockImplementation(() => undefined);

        const { result } = renderHook(() => useChatStream());

        await act(async () => {
            await result.current.sendMessage("안녕");
        });
        await act(async () => {
            jest.advanceTimersByTime(1000);
        });

        await waitFor(() => {
            expect(result.current.state).toBe("error");
        });
        expect(result.current.messages.at(-1)?.content).toBe(TEMPORARY_ERROR_MESSAGE);
        expect(result.current.error).toBe(TEMPORARY_ERROR_MESSAGE);
        expect(result.current.messages.at(-1)?.content).not.toContain("HTTP error");
    });
});
