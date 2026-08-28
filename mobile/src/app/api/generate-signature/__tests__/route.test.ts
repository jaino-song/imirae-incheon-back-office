/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { POST } from "../route";

function createRequest(body: BodyInit): NextRequest {
    return new NextRequest("http://localhost/api/generate-signature", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            cookie: "auth_token=auth-token",
        },
        body,
    });
}

describe("POST /api/generate-signature", () => {
    it("returns the provider-operation tombstone regardless of request body", async () => {
        const response = await POST(createRequest(JSON.stringify({ executionTime: 1 })));

        expect(response.status).toBe(410);
        await expect(response.json()).resolves.toMatchObject({
            code: "EFORMSIGN_PROVIDER_OPERATION_SERVER_ONLY",
        });
    });
});
