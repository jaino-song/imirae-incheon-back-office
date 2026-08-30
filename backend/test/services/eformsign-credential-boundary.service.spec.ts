import { ForbiddenException, Logger } from "@nestjs/common";
import {
    EformsignCredentialBoundary,
    assertEformsignProviderCapability,
} from "application/services/eformsign-credential-boundary.service";

describe("EformsignCredentialBoundary", () => {
    const owner = {
        userId: "user-1",
        branchId: "branch-1",
        globalRole: "owner",
        branchRole: "owner",
    };

    it("fails closed when the authenticated principal has no branch", () => {
        expect(() => assertEformsignProviderCapability(
            { ...owner, branchId: undefined },
            "document.cancel",
        )).toThrow(ForbiddenException);
    });

    it("requires an operation capability for the principal role", () => {
        expect(() => assertEformsignProviderCapability(
            { ...owner, globalRole: "user", branchRole: "user" },
            "document.cancel",
        )).toThrow(ForbiddenException);

        expect(() => assertEformsignProviderCapability(
            { ...owner, globalRole: "user", branchRole: "manager" },
            "document.cancel",
        )).toThrow(ForbiddenException);
    });

    it("rejects worker principals that carry user or role identity", () => {
        expect(() => assertEformsignProviderCapability(
            {
                branchId: "branch-1",
                source: "worker",
                userId: "user-1",
                globalRole: "owner",
            },
            "document.read",
        )).toThrow(ForbiddenException);
    });

    it("acquires configured credentials internally and returns only the operation result", async () => {
        const client = {
            getAccessToken: jest.fn().mockResolvedValue({
                oauth_token: {
                    access_token: "server-access",
                    refresh_token: "server-refresh",
                },
            }),
            refreshAccessToken: jest.fn(),
        };
        const boundary = new EformsignCredentialBoundary(client as never);

        await expect(boundary.withCredentials(
            owner,
            "document.cancel",
            ({ accessToken, refreshToken }) => ({
                providerCall: accessToken,
                refreshCall: refreshToken,
            }),
        )).resolves.toEqual({
            providerCall: "server-access",
            refreshCall: "server-refresh",
        });
        expect(client.getAccessToken).toHaveBeenCalledWith(expect.any(Number));
    });

    it("sanitizes credential-shaped provider errors before logging", async () => {
        const client = {
            getAccessToken: jest.fn().mockRejectedValue(
                new Error("access_token=server-access refresh_token=server-refresh"),
            ),
            refreshAccessToken: jest.fn(),
        };
        const boundary = new EformsignCredentialBoundary(client as never);
        const loggerSpy = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);

        await expect(boundary.withCredentials(owner, "document.cancel", () => undefined))
            .rejects.toThrow("access_token=server-access");
        const logged = loggerSpy.mock.calls.flat().join(" ");
        expect(logged).not.toContain("server-access");
        expect(logged).not.toContain("server-refresh");

        loggerSpy.mockRestore();
    });
});
