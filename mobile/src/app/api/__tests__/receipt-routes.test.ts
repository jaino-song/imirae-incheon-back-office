/**
 * @jest-environment node
 */
import { AxiosError } from "axios";
import { NextRequest } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import { POST as verify } from "../receipt/[token]/verify/route";
import { GET as image } from "../receipt/[token]/image/route";
import { GET as status } from "../receipt/[token]/status/route";

jest.mock("@/lib/api/server", () => ({ serverAPIClient: { get: jest.fn(), post: jest.fn() } }));

const mockGet = serverAPIClient.get as jest.Mock;
const mockPost = serverAPIClient.post as jest.Mock;
const params = { params: Promise.resolve({ token: "efr_t" }) };

// serverAPIClient's validateStatus rejects every 4xx, so the backend always
// THROWS an AxiosError on 4xx rather than resolving — mirror that here.
function axiosClientError(status: number, data: unknown): AxiosError {
    return Object.assign(new AxiosError("Request failed"), { response: { status, data } });
}

describe("receipt BFF routes", () => {
    beforeEach(() => {
        mockGet.mockReset();
        mockPost.mockReset();
    });

    it("status proxies the backend payload with no-store", async () => {
        mockGet.mockResolvedValue({
            status: 200,
            data: {
                ok: true,
                state: "pending",
                branchName: "인천 아이미래로",
                remainingAttempts: 5,
                lockedUntil: null,
                expiresAt: "2026-10-03T00:00:00.000Z",
            },
        });
        const response = await status(new NextRequest("http://localhost/api/receipt/efr_t/status"), params);
        expect(mockGet).toHaveBeenCalledWith("/receipt-links/efr_t/status", { headers: {} });
        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toContain("no-store");
        expect((await response.json()).branchName).toBe("인천 아이미래로");
    });

    it("status passes a 410 expired body through verbatim", async () => {
        mockGet.mockRejectedValue(axiosClientError(410, { reason: "expired" }));
        const response = await status(new NextRequest("http://localhost/api/receipt/efr_t/status"), params);
        expect(response.status).toBe(410);
        expect(await response.json()).toEqual({ reason: "expired" });
    });

    it("forwards the caller's X-Forwarded-For header to the backend for per-IP rate limiting", async () => {
        mockGet.mockResolvedValue({
            status: 200,
            data: {
                ok: true,
                state: "pending",
                branchName: "인천 아이미래로",
                remainingAttempts: 5,
                lockedUntil: null,
                expiresAt: "2026-10-03T00:00:00.000Z",
            },
        });
        const request = new NextRequest("http://localhost/api/receipt/efr_t/status", {
            headers: { "x-forwarded-for": "203.0.113.5" },
        });
        await status(request, params);
        expect(mockGet).toHaveBeenCalledWith("/receipt-links/efr_t/status", {
            headers: { "X-Forwarded-For": "203.0.113.5" },
        });
    });

    it("verify sets the HttpOnly access cookie and never returns the access token to the browser", async () => {
        mockPost.mockResolvedValue({ status: 200, data: { ok: true, accessToken: "efra_secret", clientName: "김산모" } });
        const request = new NextRequest("http://localhost/api/receipt/efr_t/verify", {
            method: "POST",
            body: JSON.stringify({ birthday: "940315" }),
            headers: { "content-type": "application/json" },
        });
        const response = await verify(request, params);
        expect(mockPost).toHaveBeenCalledWith(
            "/receipt-links/efr_t/verify",
            { birthday: "940315" },
            { headers: {} },
        );
        expect(await response.json()).toEqual({ ok: true, clientName: "김산모" });
        const cookie = response.headers.get("set-cookie") ?? "";
        expect(cookie).toContain("receipt_access=efra_secret");
        expect(cookie).toContain("HttpOnly");
        expect(cookie).toContain("Path=/api/receipt/efr_t");
        expect(cookie).not.toContain("김산모");
        expect(cookie).toMatch(/SameSite=Lax/i);
        const maxAgeMatch = cookie.match(/Max-Age=(\d+)/i);
        expect(maxAgeMatch).not.toBeNull();
        expect(Number(maxAgeMatch?.[1])).toBeLessThanOrEqual(30 * 24 * 60 * 60);
        // Secure is intentionally not asserted here: it's derived from
        // getServerRuntimeConfig().isProductionNodeEnv, which reflects this test
        // process's NODE_ENV rather than a stubbable runtime config value.
    });

    it("verify passes 401/423 bodies through", async () => {
        mockPost.mockRejectedValue(axiosClientError(401, { reason: "verification_failed", remainingAttempts: 2 }));
        const request = new NextRequest("http://localhost/api/receipt/efr_t/verify", {
            method: "POST",
            body: JSON.stringify({ birthday: "000000" }),
            headers: { "content-type": "application/json" },
        });
        const response = await verify(request, params);
        expect(response.status).toBe(401);
        expect(await response.json()).toEqual({ reason: "verification_failed", remainingAttempts: 2 });
    });

    it("verify treats a 400 without reason (validation pipe) as invalid_format", async () => {
        mockPost.mockRejectedValue(axiosClientError(400, { message: ["birthday must be a string"] }));
        const request = new NextRequest("http://localhost/api/receipt/efr_t/verify", {
            method: "POST",
            body: JSON.stringify({ birthday: 123 }),
            headers: { "content-type": "application/json" },
        });
        const response = await verify(request, params);
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ reason: "invalid_format" });
    });

    it("verify passes a locked 423 body through with lockedUntil", async () => {
        mockPost.mockRejectedValue(axiosClientError(423, { reason: "locked", lockedUntil: "2026-09-03T01:00:00.000Z" }));
        const request = new NextRequest("http://localhost/api/receipt/efr_t/verify", {
            method: "POST",
            body: JSON.stringify({ birthday: "940315" }),
            headers: { "content-type": "application/json" },
        });
        const response = await verify(request, params);
        expect(response.status).toBe(423);
        expect(await response.json()).toEqual({ reason: "locked", lockedUntil: "2026-09-03T01:00:00.000Z" });
    });

    it("verify returns an error instead of forwarding an unrecognized 2xx payload as verified", async () => {
        // A 200 that doesn't match { ok: true, accessToken, clientName } would otherwise be
        // forwarded as-is, and the page's `response.ok` check would treat the mother as
        // verified without the BFF ever having minted the access cookie.
        mockPost.mockResolvedValue({ status: 200, data: { unexpected: "shape" } });
        const request = new NextRequest("http://localhost/api/receipt/efr_t/verify", {
            method: "POST",
            body: JSON.stringify({ birthday: "940315" }),
            headers: { "content-type": "application/json" },
        });
        const response = await verify(request, params);
        expect(response.status).toBe(500);
        const body = (await response.json()) as { ok?: boolean };
        expect(body.ok).toBeUndefined();
        expect(response.headers.get("set-cookie")).toBeNull();
    });

    it("image requires the cookie and streams the png with the backend's headers", async () => {
        const denied = await image(new NextRequest("http://localhost/api/receipt/efr_t/image"), params);
        expect(denied.status).toBe(401);
        expect(await denied.json()).toEqual({ reason: "access_required" });
        expect(mockGet).not.toHaveBeenCalled();

        mockGet.mockResolvedValue({
            status: 200,
            data: Buffer.from("png"),
            headers: { "content-type": "image/png", "content-disposition": 'attachment; filename="receipt.png"' },
        });
        const request = new NextRequest("http://localhost/api/receipt/efr_t/image?download=1", {
            headers: { cookie: "receipt_access=efra_secret" },
        });
        const response = await image(request, params);
        expect(mockGet).toHaveBeenCalledWith(
            "/receipt-links/efr_t/image",
            expect.objectContaining({
                params: { download: "1" },
                responseType: "arraybuffer",
                headers: { "X-Receipt-Access-Token": "efra_secret" },
            }),
        );
        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toBe("image/png");
        expect(response.headers.get("content-disposition")).toContain("attachment");
        expect(response.headers.get("cache-control")).toBe("private, no-store");
        expect(response.headers.get("x-content-type-options")).toBe("nosniff");
        expect(Buffer.from(await response.arrayBuffer()).toString()).toBe("png");
    });

    it("image passes a 401 access_required body through when the backend rejects the token", async () => {
        // responseType: "arraybuffer" means axios buffers the 4xx error body as a Buffer too
        // (not parsed JSON) — the route must decode it before forwarding.
        mockGet.mockRejectedValue(axiosClientError(401, Buffer.from(JSON.stringify({ reason: "access_required" }))));
        const request = new NextRequest("http://localhost/api/receipt/efr_t/image", {
            headers: { cookie: "receipt_access=stale" },
        });
        const response = await image(request, params);
        expect(response.status).toBe(401);
        expect(await response.json()).toEqual({ reason: "access_required" });
    });
});
