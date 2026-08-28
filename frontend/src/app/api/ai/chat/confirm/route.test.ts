/**
 * @jest-environment node
 */
import { cookies } from "next/headers";
import { NextRequest } from "next/server";

import { POST } from "./route";

jest.mock("next/headers", () => ({
    cookies: jest.fn(),
}));

const mockCookies = cookies as jest.MockedFunction<typeof cookies>;

function request(body: unknown): NextRequest {
    return new NextRequest("http://localhost/api/ai/chat/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
}

describe("POST /api/ai/chat/confirm", () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
        jest.clearAllMocks();
        mockCookies.mockResolvedValue({
            get: jest.fn().mockReturnValue({ value: "access-token" }),
        } as never);
        globalThis.fetch = jest.fn() as typeof fetch;
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    it("rejects unauthenticated confirmation before proxying", async () => {
        mockCookies.mockResolvedValue({ get: jest.fn().mockReturnValue(undefined) } as never);

        const response = await POST(request({ intentId: "i", nonce: "n" }));

        expect(response.status).toBe(401);
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("rejects model-style confirmation fields and never forwards them", async () => {
        const response = await POST(request({ intentId: "i", nonce: "n", confirmed: true }));

        expect(response.status).toBe(400);
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("forwards only the opaque intent tuple and preserves the result", async () => {
        (globalThis.fetch as jest.Mock).mockResolvedValue(
            new Response(JSON.stringify({ success: true, data: { message: "완료" } }), { status: 200 }),
        );

        const response = await POST(request({ intentId: "intent-1", nonce: "nonce-1", sessionId: "session-1" }));

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ success: true, data: { message: "완료" } });
        expect(JSON.parse((globalThis.fetch as jest.Mock).mock.calls[0][1].body)).toEqual({
            intentId: "intent-1",
            nonce: "nonce-1",
            sessionId: "session-1",
        });
    });

    it("maps replay/expiry errors without exposing upstream details", async () => {
        (globalThis.fetch as jest.Mock).mockResolvedValue(
            new Response("raw confirmation intent details", { status: 409 }),
        );

        const response = await POST(request({ intentId: "intent-1", nonce: "nonce-1" }));

        expect(response.status).toBe(409);
        const body = await response.text();
        expect(body).not.toContain("raw confirmation intent details");
    });
});
