import { createRouteUtils, logUpstreamError } from "./route-utils";

describe("logUpstreamError", () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("caps the upstream response body at 2,000 characters", () => {
        const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

        logUpstreamError("proxy", new Error("upstream failed"), "a".repeat(2_001));

        expect(errorSpy).toHaveBeenCalledWith("[proxy] Error:", expect.objectContaining({
            body: `${"a".repeat(2_000)}…(truncated)`,
        }));
    });

    it("preserves the existing two-argument call shape", () => {
        const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

        logUpstreamError("proxy", new Error("upstream failed"));

        expect(errorSpy).toHaveBeenCalledWith("[proxy] Error:", expect.not.objectContaining({
            body: expect.anything(),
        }));
    });

    it("redacts provider credentials and member identity from upstream bodies", () => {
        const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

        logUpstreamError(
            "proxy",
            new Error("provider failed"),
            JSON.stringify({
                access_token: "access-secret",
                refreshToken: "refresh-secret",
                memberEmail: "staff@example.com",
                safe: "kept",
            }),
        );

        const logged = JSON.stringify(errorSpy.mock.calls);
        expect(logged).toContain("[REDACTED]");
        expect(logged).not.toContain("access-secret");
        expect(logged).not.toContain("refresh-secret");
        expect(logged).not.toContain("staff@example.com");
        expect(logged).toContain("safe");
    });
});

describe("createRouteUtils legacy-message errorResponse", () => {
    const serverAPIClient = {
        delete: jest.fn(),
        get: jest.fn(),
        post: jest.fn(),
    } as unknown as Parameters<typeof createRouteUtils>[0]["serverAPIClient"];

    const { errorResponse } = createRouteUtils({
        errorResponseMode: "legacy-message",
        secureCookies: false,
        serverAPIClient,
    });

    function upstreamError(status: number, data: unknown) {
        return { response: { status, data } };
    }

    beforeEach(() => {
        jest.spyOn(console, "error").mockImplementation(() => undefined);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("surfaces the Nest exception message instead of the generic HTTP error name", async () => {
        const response = errorResponse(
            upstreamError(400, {
                message: "duration must equal the Korean business-day count (15) for the submitted service period",
                error: "Bad Request",
                statusCode: 400,
            }),
            "create client",
        );

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toEqual({
            error: "duration must equal the Korean business-day count (15) for the submitted service period",
        });
    });

    it("joins a ValidationPipe message array into one readable line", async () => {
        const response = errorResponse(
            upstreamError(400, {
                message: ["name must be a string", "phone must be a valid Korean phone number"],
                error: "Bad Request",
                statusCode: 400,
            }),
            "create client",
        );

        await expect(response.json()).resolves.toEqual({
            error: "name must be a string, phone must be a valid Korean phone number",
        });
    });

    it("falls back to the upstream error field when no message is present", async () => {
        const response = errorResponse(
            upstreamError(409, { error: "자동 고객 등록이 꺼져 있습니다." }),
            "create client",
        );

        await expect(response.json()).resolves.toEqual({
            error: "자동 고객 등록이 꺼져 있습니다.",
        });
    });

    it("falls back to the context placeholder when the upstream body carries nothing usable", async () => {
        const response = errorResponse(upstreamError(500, {}), "create client");

        await expect(response.json()).resolves.toEqual({ error: "Failed to create client" });
    });

    it("still redacts credentials that appear inside an upstream message", async () => {
        const response = errorResponse(
            upstreamError(400, { message: "upstream rejected Bearer abc.def.ghi" }),
            "create client",
        );

        const body = await response.json();
        expect(body.error).toContain("[REDACTED]");
        expect(body.error).not.toContain("abc.def.ghi");
    });
});
