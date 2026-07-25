import { expect, request, test } from "@playwright/test";

const UNAUTHENTICATED_STORAGE_STATE = {
    cookies: [],
    origins: [],
};

/**
 * Negative auth tests for the Next.js middleware proxy/prefetch bypass class
 * (advisory GHSA-26hh-7cqf-hhc6, fixed in Next 16.2.x). An unauthenticated
 * caller must not reach protected content through RSC suffixes, prefetch
 * headers, or dynamic-route parameter variants. Kept as a permanent regression
 * gate — if a future Next bump reopens the bypass, one of these flips to 2xx.
 *
 * These tests explicitly override the project's `auth.json` storageState so no
 * session cookie is present.
 */
test.describe("middleware auth-bypass protection", () => {
    const PROTECTED_PAGE = "/clients"; // requires auth_token + selected_branch_id
    const PROTECTED_API = "/api/admin/clients";

    // A protected page, hit unauthenticated, must redirect to /login (307) —
    // never return prerendered/protected 2xx content.
    test("unauthenticated protected page redirects to /login", async () => {
        const ctx = await request.newContext({ storageState: UNAUTHENTICATED_STORAGE_STATE });
        const res = await ctx.get(PROTECTED_PAGE, { maxRedirects: 0 });
        expect(res.status()).toBe(307);
        expect(res.headers()["location"] ?? "").toContain("/login");
        await ctx.dispose();
    });

    // RSC suffix variant — the historical bypass shape. Must still redirect/deny,
    // never 200 with RSC payload.
    test("unauthenticated .rsc suffix does not bypass auth", async () => {
        const ctx = await request.newContext({ storageState: UNAUTHENTICATED_STORAGE_STATE });
        const res = await ctx.get(`${PROTECTED_PAGE}.rsc`, { maxRedirects: 0 });
        expect(res.status(), "protected content must not be served for .rsc").not.toBe(200);
        expect([307, 308, 401, 404]).toContain(res.status());
        await ctx.dispose();
    });

    // Segment-prefetch header variant (RSC / Next-Router-Prefetch).
    test("unauthenticated RSC prefetch headers do not bypass auth", async () => {
        const ctx = await request.newContext({ storageState: UNAUTHENTICATED_STORAGE_STATE });
        const res = await ctx.get(PROTECTED_PAGE, {
            headers: { RSC: "1", "Next-Router-Prefetch": "1" },
            maxRedirects: 0,
        });
        expect(res.status(), "prefetch must not serve protected content").not.toBe(200);
        expect([307, 308, 401]).toContain(res.status());
        await ctx.dispose();
    });

    // Dynamic-route parameter variant.
    test("unauthenticated dynamic route param does not bypass auth", async () => {
        const ctx = await request.newContext({ storageState: UNAUTHENTICATED_STORAGE_STATE });
        const res = await ctx.get("/clients/123", { maxRedirects: 0 });
        expect(res.status()).not.toBe(200);
        expect([307, 308, 401, 404]).toContain(res.status());
        await ctx.dispose();
    });

    // Protected API returns 401 JSON, not protected data.
    test("unauthenticated protected API returns 401", async () => {
        const ctx = await request.newContext({ storageState: UNAUTHENTICATED_STORAGE_STATE });
        const res = await ctx.get(PROTECTED_API, { maxRedirects: 0 });
        expect(res.status()).toBe(401);
        await ctx.dispose();
    });

    // Guardrail against over-blocking: the authenticated session (auth.json,
    // the project default storageState) must still reach the protected page.
    test("authenticated session still reaches protected page", async ({ page }) => {
        const res = await page.goto(PROTECTED_PAGE, { waitUntil: "domcontentloaded" });
        expect(res?.status()).toBe(200);
        expect(page.url()).not.toContain("/login");
    });
});
