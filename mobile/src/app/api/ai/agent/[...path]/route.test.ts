/**
 * @jest-environment node
 */
import { cookies } from "next/headers";
import { NextRequest } from "next/server";

import { GET, POST } from "./route";

jest.mock("next/headers", () => ({
    cookies: jest.fn(),
}));

jest.mock("@/lib/api/server", () => ({
    BACKEND_BASE_URL: "https://backend.example.test",
}));

const mockCookies = cookies as jest.Mock;
const mockFetch = jest.fn();
const originalFetch = global.fetch;

function setAuthCookie(token?: string): void {
    mockCookies.mockResolvedValue({
        get: jest.fn((name: string) => name === "auth_token" && token ? { value: token } : undefined),
    });
}

function routeParams(...path: string[]): { params: Promise<{ path: string[] }> } {
    return { params: Promise.resolve({ path }) };
}

describe("mobile AI agent catch-all proxy", () => {
    beforeAll(() => {
        global.fetch = mockFetch as typeof fetch;
    });

    afterAll(() => {
        global.fetch = originalFetch;
    });

    beforeEach(() => {
        mockCookies.mockReset();
        mockFetch.mockReset();
    });

    it("rejects unauthenticated requests before contacting the backend", async () => {
        setAuthCookie();

        const response = await GET(
            new NextRequest("http://localhost/api/ai/agent/capabilities"),
            routeParams("capabilities"),
        );

        expect(response.status).toBe(401);
        expect(mockFetch).not.toHaveBeenCalled();
    });

    it("preserves authenticated stream headers and forwards upstream acceleration when present", async () => {
        setAuthCookie("token-a");
        mockFetch.mockResolvedValue(new Response("event: message\ndata: {}\n\n", {
            status: 200,
            headers: {
                "content-type": "text/event-stream",
                "cache-control": "no-cache",
                "x-accel-buffering": "no",
                "x-agent-session-id": "session-a",
                "x-vercel-ai-ui-message-stream": "v1",
            },
        }));

        const body = JSON.stringify({ messages: [] });
        const response = await POST(
            new NextRequest("http://localhost/api/ai/agent/chat?sessionId=s1", {
                method: "POST",
                body,
                headers: { "content-type": "application/json" },
            }),
            routeParams("chat"),
        );

        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toBe("text/event-stream");
        expect(response.headers.get("cache-control")).toBe("no-cache");
        expect(response.headers.get("x-accel-buffering")).toBe("no");
        expect(response.headers.get("x-agent-session-id")).toBe("session-a");
        expect(response.headers.get("x-vercel-ai-ui-message-stream")).toBe("v1");
        expect(mockFetch).toHaveBeenCalledWith(
            "https://backend.example.test/ai/agent/chat?sessionId=s1",
            expect.objectContaining({
                method: "POST",
                headers: { Authorization: "Bearer token-a", "Content-Type": "application/json" },
                body,
            }),
        );
    });

    it("does not synthesize acceleration when the upstream omits it", async () => {
        setAuthCookie("token-b");
        mockFetch.mockResolvedValue(new Response(JSON.stringify({ capabilities: [] }), {
            status: 200,
            headers: {
                "content-type": "application/json",
                "cache-control": "no-store",
                "x-agent-session-id": "session-b",
            },
        }));

        const response = await GET(
            new NextRequest("http://localhost/api/ai/agent/capabilities"),
            routeParams("capabilities"),
        );

        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toBe("application/json");
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(response.headers.get("x-agent-session-id")).toBe("session-b");
        expect(response.headers.get("x-accel-buffering")).toBeNull();
        expect(response.headers.get("x-vercel-ai-ui-message-stream")).toBeNull();
        expect(mockFetch).toHaveBeenCalledWith(
            "https://backend.example.test/ai/capabilities",
            expect.objectContaining({
                method: "GET",
                headers: { Authorization: "Bearer token-b" },
                body: undefined,
            }),
        );
    });
});
