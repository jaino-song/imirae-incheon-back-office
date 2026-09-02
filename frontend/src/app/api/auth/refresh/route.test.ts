/**
 * @jest-environment node
 */
import { cookies } from "next/headers";
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import { POST } from "./route";

jest.mock("next/headers", () => ({
    cookies: jest.fn(),
}));

jest.mock("@/lib/api/server", () => ({
    serverAPIClient: {
        post: jest.fn(),
    },
}));

const mockCookies = cookies as jest.MockedFunction<typeof cookies>;
const mockServerPost = serverAPIClient.post as jest.Mock;
const cookieStore = {
    set: jest.fn(),
    delete: jest.fn(),
};

function createRequest(cookie = "refresh_token=old-refresh; auto_login=1"): NextRequest {
    return new NextRequest("http://localhost/api/auth/refresh", {
        method: "POST",
        headers: { cookie },
    });
}

describe("POST /api/auth/refresh", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockCookies.mockResolvedValue(cookieStore as never);
    });

    it("rotates the HTTP-only session cookies without returning tokens in the body", async () => {
        mockServerPost.mockResolvedValue({
            data: {
                accessToken: "new-access",
                refreshToken: "new-refresh",
            },
        });

        const response = await POST(createRequest());

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ success: true });
        expect(mockServerPost).toHaveBeenCalledWith("/auth/refresh-token", {
            refreshToken: "old-refresh",
        });
        expect(cookieStore.set).toHaveBeenCalledWith(
            "auth_token",
            "new-access",
            expect.objectContaining({ httpOnly: true, path: "/" }),
        );
        expect(cookieStore.set).toHaveBeenCalledWith(
            "refresh_token",
            "new-refresh",
            expect.objectContaining({ httpOnly: true, path: "/" }),
        );
    });

    it("returns 401 without contacting the backend when the refresh cookie is missing", async () => {
        const response = await POST(createRequest("auto_login=1"));

        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toEqual({
            error: "Session refresh required",
            code: "AUTH_REFRESH_REQUIRED",
        });
        expect(mockServerPost).not.toHaveBeenCalled();
    });

    it("clears the local session when the refresh token is rejected", async () => {
        mockServerPost.mockRejectedValue({ response: { status: 401, data: { error: "Unauthorized" } } });

        const response = await POST(createRequest());

        expect(response.status).toBe(401);
        expect(cookieStore.delete).toHaveBeenCalledWith("auth_token");
        expect(cookieStore.delete).toHaveBeenCalledWith("refresh_token");
        expect(cookieStore.delete).toHaveBeenCalledWith("auto_login");
        await expect(response.json()).resolves.toEqual({
            error: "Session refresh failed",
            code: "AUTH_REFRESH_FAILED",
        });
    });

    it("clears the local session when upstream answers without a usable token pair", async () => {
        // A 200 with missing tokens is unrecoverable, not transient: it must surface as
        // 401 so the browser interceptor redirects to /login. Reported as 502 the tab
        // would keep issuing 401s forever with no way out.
        mockServerPost.mockResolvedValue({ data: { accessToken: "only-access" } });

        const response = await POST(createRequest());

        expect(response.status).toBe(401);
        expect(cookieStore.delete).toHaveBeenCalledWith("auth_token");
        expect(cookieStore.delete).toHaveBeenCalledWith("refresh_token");
        await expect(response.json()).resolves.toEqual({
            error: "Session refresh failed",
            code: "AUTH_REFRESH_FAILED",
        });
    });

    it("keeps session cookies on a transient upstream failure", async () => {
        mockServerPost.mockRejectedValue({ response: { status: 503 } });

        const response = await POST(createRequest());

        expect(response.status).toBe(502);
        expect(cookieStore.delete).not.toHaveBeenCalled();
        await expect(response.json()).resolves.toEqual({
            error: "Session refresh failed",
            code: "AUTH_REFRESH_FAILED",
        });
    });
});
