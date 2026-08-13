import { resolveRuntimeNetworkConfig } from "./runtime-config";

describe("resolveRuntimeNetworkConfig", () => {
    it("should preserve the Railway-compatible defaults when overrides are absent", () => {
        expect(resolveRuntimeNetworkConfig({})).toEqual({
            host: "0.0.0.0",
            port: 3001,
        });
    });

    it("should use explicit Lightsail network overrides", () => {
        expect(
            resolveRuntimeNetworkConfig({
                APP_HOST: "127.0.0.1",
                APP_PORT: "4001",
            }),
        ).toEqual({
            host: "127.0.0.1",
            port: 4001,
        });
    });

    it("should reject an invalid explicit port", () => {
        expect(() => resolveRuntimeNetworkConfig({ APP_PORT: "invalid" })).toThrow(
            "APP_PORT must be an integer between 1 and 65535",
        );
    });
});
