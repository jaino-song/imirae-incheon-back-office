/**
 * @jest-environment node
 */
import { AxiosError, AxiosHeaders } from "axios";
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";

import { POST } from "./route";

jest.mock("@/lib/api/server", () => ({
    serverAPIClient: {
        post: jest.fn(),
    },
}));

const mockPost = serverAPIClient.post as jest.Mock;

function createRequest(authenticated = true) {
    return new NextRequest("http://localhost/api/message-trigger-jobs/job-1/cancel", {
        method: "POST",
        headers: authenticated ? { cookie: "auth_token=token-1" } : {},
    });
}

describe("POST /api/message-trigger-jobs/[id]/cancel", () => {
    beforeEach(() => {
        mockPost.mockReset();
    });

    it("forwards the authenticated cancel request to the backend", async () => {
        mockPost.mockResolvedValue({
            status: 200,
            data: { id: "job-1", status: "canceled" },
        });

        const response = await POST(createRequest(), {
            params: Promise.resolve({ id: "job-1" }),
        });

        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ id: "job-1", status: "canceled" });
        expect(mockPost).toHaveBeenCalledWith(
            "/message-trigger-jobs/job-1/cancel",
            {},
            { headers: { Authorization: "Bearer token-1" } },
        );
    });

    it("preserves a backend conflict response for a job that is no longer pending", async () => {
        mockPost.mockRejectedValue(
            new AxiosError("Conflict", "ERR_BAD_RESPONSE", undefined, undefined, {
                status: 409,
                statusText: "Conflict",
                headers: {},
                config: { headers: new AxiosHeaders() },
                data: { message: "이미 발송되었거나 취소할 수 없는 상태입니다." },
            }),
        );

        const response = await POST(createRequest(), {
            params: Promise.resolve({ id: "job-1" }),
        });

        expect(response.status).toBe(409);
        expect(await response.json()).toEqual({ message: "이미 발송되었거나 취소할 수 없는 상태입니다." });
    });

    it("requires authentication before forwarding", async () => {
        const response = await POST(createRequest(false), {
            params: Promise.resolve({ id: "job-1" }),
        });

        expect(response.status).toBe(401);
        expect(mockPost).not.toHaveBeenCalled();
    });
});
