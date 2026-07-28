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

describe("POST /api/ai/chat/stream", () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
        jest.clearAllMocks();
        mockCookies.mockResolvedValue({
            get: jest.fn().mockReturnValue({ value: "access-token" }),
        } as never);
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        jest.restoreAllMocks();
    });

    it("logs the upstream body server-side without exposing it to the client", async () => {
        const upstreamDiagnostic = "permission scope mismatch";
        globalThis.fetch = jest.fn().mockResolvedValue(
            new Response(upstreamDiagnostic, { status: 403 }),
        ) as typeof fetch;
        const consoleErrorSpy = jest
            .spyOn(console, "error")
            .mockImplementation(() => undefined);
        const request = new NextRequest("http://localhost/api/ai/chat/stream", {
            method: "POST",
            body: JSON.stringify({ message: "안녕" }),
            headers: { "Content-Type": "application/json" },
        });

        const response = await POST(request);
        const body = await response.text();

        expect(response.status).toBe(403);
        expect(body).toContain("Streaming unavailable");
        expect(body).not.toContain(upstreamDiagnostic);
        expect(consoleErrorSpy).toHaveBeenCalledWith(
            "[chat upstream stream request] Error:",
            expect.objectContaining({
                status: 403,
                body: upstreamDiagnostic,
            }),
        );
    });
});
