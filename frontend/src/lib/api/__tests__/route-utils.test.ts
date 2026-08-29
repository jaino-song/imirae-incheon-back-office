/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import { proxyGetRequest, proxyLocalGetRequest, proxyPostRequest } from "../route-utils";

jest.mock("@/lib/api/server", () => ({
    serverAPIClient: {
        get: jest.fn(),
        post: jest.fn(),
    },
}));

const mockGet = serverAPIClient.get as jest.Mock;
const mockPost = serverAPIClient.post as jest.Mock;

function createJsonRequest(body: string): NextRequest {
    return new NextRequest("http://localhost/api/proxy", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            cookie: "auth_token=token-1; eformsign_access_token=eformsign-token",
        },
        body,
    });
}

describe("route-utils proxy body parsing", () => {
    beforeEach(() => {
        mockGet.mockReset();
        mockPost.mockReset();
    });

    it("rejects malformed JSON POST bodies before proxying", async () => {
        const response = await proxyPostRequest(
            createJsonRequest("{bad-json"),
            "/api/documents/doc-1/re_request_outsider",
            "re-request outsider",
        );

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toEqual({
            error: "Request body must be valid JSON",
        });
        expect(mockPost).not.toHaveBeenCalled();
    });

    it("preserves safe GET query params while dropping provider credentials", async () => {
        mockGet.mockResolvedValue({
            status: 200,
            data: { documents: [], total_count: 0 },
        });

        const request = new NextRequest(
            "http://localhost/api/eformsign/documents/expired?limit=20&skip=40&accessToken=client-token",
            {
                method: "GET",
                headers: {
                    cookie: "auth_token=token-1; eformsign_access_token=eformsign-token",
                },
            },
        );

        const response = await proxyGetRequest(
            request,
            "/api/documents/rejected",
            "fetch expired documents",
        );

        expect(response.status).toBe(200);
        expect(mockGet).toHaveBeenCalledWith(
            "/api/documents/rejected",
            {
                params: {
                    limit: "20",
                    skip: "40",
                },
                headers: { Authorization: "Bearer token-1" },
            },
        );
    });

    it("proxies local reads without requiring or forwarding an eformsign token", async () => {
        mockGet.mockResolvedValue({
            status: 200,
            data: { documents: [], total_rows: 0 },
        });
        const request = new NextRequest(
            "http://localhost/api/eformsign/documents?limit=20&accessToken=client-token"
            + "&refresh_token=refresh-secret&external-token=external-secret"
            + "&oauth_token=oauth-secret&apiKey=api-secret&authorization=bearer-secret",
            {
                headers: { cookie: "auth_token=token-1" },
            },
        );

        const response = await proxyLocalGetRequest(
            request,
            "/api/documents",
            "fetch local documents",
        );

        expect(response.status).toBe(200);
        expect(mockGet).toHaveBeenCalledWith("/api/documents", {
            params: { limit: "20" },
            headers: { Authorization: "Bearer token-1" },
        });
    });
});
