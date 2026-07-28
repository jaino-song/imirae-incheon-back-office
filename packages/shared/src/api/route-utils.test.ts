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
});
