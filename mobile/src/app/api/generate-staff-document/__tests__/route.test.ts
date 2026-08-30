/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { POST } from "../route";

describe("POST /api/generate-staff-document", () => {
    it("returns the provider-operation tombstone without forwarding caller credentials", async () => {
        const request = new NextRequest("http://localhost/api/generate-staff-document", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                cookie: "auth_token=auth-token",
            },
            body: JSON.stringify({
                documentId: "doc-1",
                accessToken: "caller-token",
                refreshToken: "caller-refresh",
            }),
        });

        const response = await POST(request);

        expect(response.status).toBe(410);
        await expect(response.json()).resolves.toEqual({
            code: "EFORMSIGN_PROVIDER_OPERATION_SERVER_ONLY",
            error: "Use the server-mediated eformsign finalize operation",
        });
    });
});
