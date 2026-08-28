import { act, renderHook } from "@testing-library/react";
import { ReadableStream } from "stream/web";
import { TextDecoder, TextEncoder } from "util";

import { useChatStream } from "../useChatStream";

function createSSEResponse(expiresAt: string): Response {
    const encoder = new TextEncoder();
    const body = [
        `event: message\ndata: ${JSON.stringify({
            type: "confirmation",
            confirmationMessage: "산모를 등록하시겠습니까?",
            confirmationIntentId: "opaque-intent",
            confirmationNonce: "opaque-nonce",
            confirmationExpiresAt: expiresAt,
            sessionId: "confirmation-session",
        })}\n\n`,
        `event: message\ndata: ${JSON.stringify({ type: "done", sessionId: "confirmation-session" })}\n\n`,
    ];
    let index = 0;

    return {
        ok: true,
        body: new ReadableStream<Uint8Array>({
        pull(controller) {
            if (index >= body.length) {
                controller.close();
                return;
            }
            controller.enqueue(encoder.encode(body[index]));
            index += 1;
        },
        }),
    } as unknown as Response;
}

function createJsonResponse(body: unknown, status = 200): Response {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
        text: async () => JSON.stringify(body),
    } as unknown as Response;
}

describe("useChatStream legacy confirmation", () => {
    const originalFetch = globalThis.fetch;
    const originalTextEncoder = globalThis.TextEncoder;
    const originalTextDecoder = globalThis.TextDecoder;

    beforeEach(() => {
        localStorage.clear();
        Object.assign(globalThis, {
            TextEncoder,
            TextDecoder: TextDecoder as unknown as typeof globalThis.TextDecoder,
        });
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        Object.assign(globalThis, {
            TextEncoder: originalTextEncoder,
            TextDecoder: originalTextDecoder,
        });
    });

    async function receivePreview(expiresAt = "2099-01-01T00:00:00.000Z") {
        const confirmRequests: Array<{ body: Record<string, unknown> }> = [];
        globalThis.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);
            if (url.includes("/api/ai/chat/stream")) {
                return createSSEResponse(expiresAt);
            }
            if (url.includes("/api/ai/chat/confirm")) {
                confirmRequests.push({ body: JSON.parse(String(init?.body)) });
                return createJsonResponse({ success: true, data: { message: "산모가 등록되었습니다" } });
            }
            if (url.includes("/api/ai/chat/persist")) {
                return createJsonResponse({});
            }
            return createJsonResponse({});
        }) as typeof fetch;

        const hook = renderHook(() => useChatStream());
        await act(async () => {
            await hook.result.current.sendMessage("정보 변경 요청");
        });
        return { hook, confirmRequests };
    }

    it("stores only opaque intent fields and confirms through the typed endpoint", async () => {
        const { hook, confirmRequests } = await receivePreview();

        expect(hook.result.current.pendingConfirmation).toEqual({
            intentId: "opaque-intent",
            nonce: "opaque-nonce",
            sessionId: "confirmation-session",
            expiresAt: "2099-01-01T00:00:00.000Z",
        });
        expect(JSON.stringify(hook.result.current.pendingConfirmation)).not.toContain("confirmed");

        await act(async () => {
            await hook.result.current.confirmAction();
        });

        expect(confirmRequests).toEqual([{
            body: {
                intentId: "opaque-intent",
                nonce: "opaque-nonce",
                sessionId: "confirmation-session",
            },
        }]);
        expect(hook.result.current.pendingConfirmation).toBeNull();
        expect(hook.result.current.messages.at(-1)?.content).toBe("산모가 등록되었습니다");
        expect(hook.result.current.state).toBe("complete");
    });

    it("cancels locally and never treats plain-text confirmation as authority", async () => {
        const { hook, confirmRequests } = await receivePreview();

        await act(async () => {
            hook.result.current.cancelAction();
        });
        expect(hook.result.current.pendingConfirmation).toBeNull();
        expect(confirmRequests).toHaveLength(0);

        await act(async () => {
            await hook.result.current.sendMessage("확인");
        });
        expect(confirmRequests).toHaveLength(0);
    });

    it("fails closed for expiry and replay responses without retrying", async () => {
        const expired = await receivePreview("2000-01-01T00:00:00.000Z");

        await act(async () => {
            await expired.hook.result.current.confirmAction();
        });
        expect(expired.confirmRequests).toHaveLength(0);
        expect(expired.hook.result.current.error).toContain("이미 처리되었거나 만료");

        const replay = await receivePreview();
        globalThis.fetch = jest.fn(async (input: RequestInfo | URL) => {
            if (String(input).includes("/api/ai/chat/stream")) return createSSEResponse("2099-01-01T00:00:00.000Z");
            if (String(input).includes("/api/ai/chat/confirm")) return createJsonResponse({ error: "replayed" }, 409);
            return createJsonResponse({});
        }) as typeof fetch;
        // The stream was already received with the previous mock; only the
        // confirmation request is intentionally replayed here.
        await act(async () => {
            await replay.hook.result.current.confirmAction();
        });
        await act(async () => {
            await replay.hook.result.current.confirmAction();
        });
        expect((globalThis.fetch as jest.Mock).mock.calls.filter(([input]) => String(input).includes("/api/ai/chat/confirm"))).toHaveLength(1);
        expect(replay.hook.result.current.error).toContain("이미 처리되었거나 만료");
    });
});
