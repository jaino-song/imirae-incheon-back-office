import { logUpstreamError } from "./route-utils";

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
