/**
 * Regression lock for the timeout inversion that broke the iframe fallback.
 *
 * The headless dispatch crosses three hops, each with its own timeout:
 *   browser axios  →  Next.js route proxy  →  Nest backend
 *
 * They must stay ordered backend < proxy < browser. When the proxy alone was
 * raised to 180s and the browser was left on the shared 30s default, the browser
 * aborted first: the backend's verdict — the thing that carries `fallbackHint`
 * and drives the iframe fallback — never arrived, so staff were stranded on a
 * dead processing step with a message telling them to press a button that was
 * never rendered.
 *
 * The browser hop is the one that silently regresses, because omitting a
 * per-call timeout inherits `api`'s 30s default rather than failing loudly.
 */
import fs from "fs";
import path from "path";

const mockPost = jest.fn();

jest.mock("@/lib/api/client", () => ({
    api: {
        post: (...args: unknown[]) => mockPost(...args),
        get: jest.fn(),
    },
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let eformsignApi: any;

const ROUTES_DIR = path.join(__dirname, "../../app/api/eformsign-docs");

function readProxyTimeout(routeFile: string): number {
    const source = fs.readFileSync(path.join(ROUTES_DIR, routeFile, "route.ts"), "utf8");
    const match = /timeout:\s*([\d_]+)/.exec(source);
    if (!match) throw new Error(`no timeout found in ${routeFile}/route.ts`);
    return Number(match[1].replace(/_/g, ""));
}

function timeoutOf(call: unknown[]): number | undefined {
    const config = call[2] as { timeout?: number } | undefined;
    return config?.timeout;
}

describe("headless dispatch timeout ordering", () => {
    beforeEach(async () => {
        jest.clearAllMocks();
        mockPost.mockResolvedValue({ data: { ok: true } });
        ({ eformsignApi } = await import("../api"));
    });

    it("sends an explicit browser-side timeout for dispatch-headless", async () => {
        await eformsignApi.dispatchHeadless({}, 1, "p-1");

        const timeout = timeoutOf(mockPost.mock.calls[0]);
        expect(timeout).toBeDefined();
        expect(timeout).toBeGreaterThanOrEqual(180_000);
    });

    it("sends an explicit browser-side timeout for finalize-headless", async () => {
        await eformsignApi.finalizeHeadless("doc-1", undefined, "p-1");

        const timeout = timeoutOf(mockPost.mock.calls[0]);
        expect(timeout).toBeDefined();
        expect(timeout).toBeGreaterThanOrEqual(180_000);
    });

    it.each([
        ["dispatch-headless", () => eformsignApi.dispatchHeadless({}, 1, "p-1")],
        ["finalize-headless", () => eformsignApi.finalizeHeadless("doc-1", undefined, "p-1")],
    ])("keeps the browser hop above the %s proxy hop", async (routeFile, call) => {
        await call();

        const browserTimeout = timeoutOf(mockPost.mock.calls[0]);
        const proxyTimeout = readProxyTimeout(routeFile);

        // Strictly greater: if the browser gives up first, the proxy's response —
        // and with it the backend's fallbackHint — is thrown away.
        expect(browserTimeout).toBeGreaterThan(proxyTimeout);
    });
});
