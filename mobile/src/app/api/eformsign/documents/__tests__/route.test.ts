/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { GET } from "../route";
import { proxyLocalGetRequest } from "@/lib/api/route-utils";

jest.mock("@/lib/api/route-utils", () => ({
    proxyDeleteRequest: jest.fn(),
    proxyLocalGetRequest: jest.fn(),
}));

const mockProxyLocalGetRequest = proxyLocalGetRequest as jest.Mock;

function createRequest(path: string): NextRequest {
    return new NextRequest(`http://localhost${path}`);
}

describe("GET /api/eformsign/documents", () => {
    beforeEach(() => {
        mockProxyLocalGetRequest.mockReset();
        mockProxyLocalGetRequest.mockResolvedValue(new Response("{}", { status: 200 }));
    });

    it("rejects non-integer limits before proxying", async () => {
        const response = await GET(createRequest("/api/eformsign/documents?limit=abc"));

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toEqual({ error: "limit must be an integer" });
        expect(mockProxyLocalGetRequest).not.toHaveBeenCalled();
    });

    it("rejects out-of-range limits before proxying", async () => {
        const response = await GET(createRequest("/api/eformsign/documents?limit=101"));

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toEqual({ error: "limit must be between 1 and 100" });
        expect(mockProxyLocalGetRequest).not.toHaveBeenCalled();
    });

    it("rejects negative skip values before proxying", async () => {
        const response = await GET(createRequest("/api/eformsign/documents?skip=-1"));

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toEqual({ error: "skip must be greater than or equal to 0" });
        expect(mockProxyLocalGetRequest).not.toHaveBeenCalled();
    });

    it("normalizes valid pagination params before proxying", async () => {
        await GET(createRequest("/api/eformsign/documents?limit=25&skip=50"));

        expect(mockProxyLocalGetRequest).toHaveBeenCalledWith(
            expect.any(NextRequest),
            "/api/documents?limit=25&skip=50",
            "fetch all eformsign documents",
        );
    });

    it("forwards the section filter verbatim for the backend to resolve", async () => {
        await GET(createRequest("/api/eformsign/documents?limit=25&skip=0&section=maternity"));

        expect(mockProxyLocalGetRequest).toHaveBeenCalledWith(
            expect.any(NextRequest),
            "/api/documents?limit=25&skip=0&section=maternity",
            "fetch all eformsign documents",
        );
    });

    // 서명 완료 and 검토 필요 send the same statusCategory and differ ONLY by
    // displayStatus, which the backend applies before the limit/skip slice. While the
    // param was missing from the allowlist both pills asked the identical question,
    // so the rows never split while the separately-fetched counters did.
    it("asks a different backend question for each provider-review pill", async () => {
        const backendPathFor = async (displayStatus: string) => {
            mockProxyLocalGetRequest.mockClear();
            await GET(
                createRequest(
                    `/api/eformsign/documents?limit=25&skip=0&section=maternity&statusCategory=in-progress&displayStatus=${displayStatus}`,
                ),
            );
            return mockProxyLocalGetRequest.mock.calls[0]![1] as string;
        };

        const signed = await backendPathFor("signed");
        const review = await backendPathFor("review");

        expect(signed).toContain("displayStatus=signed");
        expect(review).toContain("displayStatus=review");
        expect(signed).not.toEqual(review);
    });

    it("drops a blank displayStatus so the backend keeps its own default", async () => {
        await GET(createRequest("/api/eformsign/documents?limit=25&skip=0&displayStatus=%20"));

        expect(mockProxyLocalGetRequest).toHaveBeenCalledWith(
            expect.any(NextRequest),
            "/api/documents?limit=25&skip=0",
            "fetch all eformsign documents",
        );
    });

    // The allowlist is the only thing that forwards a filter: there is no auto-forward
    // fallback once the route pre-encodes its own query. This drives every filter the
    // mobile client can emit through in one request, so a param that is wired into the
    // client but not here fails here rather than in production.
    it("forwards every filter the mobile client can send", async () => {
        await GET(
            createRequest(
                "/api/eformsign/documents?limit=25&skip=0&section=maternity" +
                    "&statusCategory=in-progress&displayStatus=review&search=%EA%B9%80&excludeDeleted=true",
            ),
        );

        const backendPath = mockProxyLocalGetRequest.mock.calls[0]![1] as string;
        const forwarded = new URLSearchParams(backendPath.split("?")[1]);
        expect(Object.fromEntries(forwarded)).toEqual({
            limit: "25",
            skip: "0",
            section: "maternity",
            statusCategory: "in-progress",
            displayStatus: "review",
            search: "김",
            excludeDeleted: "true",
        });
    });
});
