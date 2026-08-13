/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { proxyAgentRequest } from "../_proxy";

const mockCookies = jest.fn();
jest.mock("next/headers", () => ({ cookies: () => mockCookies() }));

describe("Release A agent bearer proxy", () => {
    const originalFetch = globalThis.fetch;
    const originalBackend = process.env.DEVELOPMENT_API_BASE_URL;

    beforeEach(() => {
        process.env.DEVELOPMENT_API_BASE_URL = "https://backend.example.test";
        mockCookies.mockResolvedValue({ get: () => ({ value: "token-a" }) });
        globalThis.fetch = jest.fn();
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        if (originalBackend === undefined) delete process.env.DEVELOPMENT_API_BASE_URL;
        else process.env.DEVELOPMENT_API_BASE_URL = originalBackend;
        jest.clearAllMocks();
    });

    it("fails before contacting the backend without the auth cookie", async () => {
        mockCookies.mockResolvedValue({ get: () => undefined });
        const response = await proxyAgentRequest(new NextRequest("http://localhost/api/ai/agent/capabilities"), "/ai/capabilities", "GET");
        expect(response.status).toBe(401);
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("forwards bearer auth and preserves the session stream header", async () => {
        (globalThis.fetch as jest.Mock).mockResolvedValue(new Response("stream", {
            status: 200,
            headers: {
                "content-type": "text/event-stream",
                "cache-control": "no-cache",
                "x-vercel-ai-ui-message-stream": "v1",
                "x-agent-session-id": "session-a",
            },
        }));
        const response = await proxyAgentRequest(
            new NextRequest("http://localhost/api/ai/agent/chat", { method: "POST" }),
            "/ai/agent/chat",
            "POST",
            { messages: [] },
        );
        expect(response.status).toBe(200);
        expect(response.headers.get("x-agent-session-id")).toBe("session-a");
        expect(response.headers.get("cache-control")).toBe("no-cache");
        expect(response.headers.get("x-vercel-ai-ui-message-stream")).toBe("v1");
        expect(globalThis.fetch).toHaveBeenCalledWith(
            "https://backend.example.test/ai/agent/chat",
            expect.objectContaining({ method: "POST", headers: { Authorization: "Bearer token-a", "Content-Type": "application/json" }, body: JSON.stringify({ messages: [] }) }),
        );
    });
});
