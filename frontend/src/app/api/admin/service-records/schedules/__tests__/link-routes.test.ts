/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";

import { POST as prepareLink } from "../[scheduleId]/prepare-link/route";
import { POST as resetLink } from "../[scheduleId]/reset-link/route";
import { POST as sendLink } from "../[scheduleId]/send-link/route";

jest.mock("@/lib/api/server", () => ({
    serverAPIClient: {
        post: jest.fn(),
    },
}));

const mockPost = serverAPIClient.post as jest.Mock;
const preparedLinkToken = `efl_${"a".repeat(43)}`;

function createRequest(path: string, body?: object, authenticated = true): NextRequest {
    return new NextRequest(`http://localhost${path}`, {
        method: "POST",
        headers: {
            ...(authenticated ? { cookie: "auth_token=token-1" } : {}),
            ...(body ? { "content-type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
    });
}

describe("service-record link proxy routes", () => {
    beforeEach(() => {
        mockPost.mockReset();
    });

    it("prepares an exact service-record URL for the manually entered recipient phone", async () => {
        mockPost.mockResolvedValue({
            status: 201,
            data: {
                serviceRecordUrl: `https://mobile.test/service-record/${preparedLinkToken}`,
                preparedLinkToken,
                expiresAt: "2026-07-20T00:00:00.000Z",
            },
        });

        const response = await prepareLink(
            createRequest("/api/admin/service-records/schedules/11/prepare-link", {
                recipientPhone: "01066211878",
            }),
            { params: Promise.resolve({ scheduleId: "11" }) },
        );

        expect(response.status).toBe(201);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(mockPost).toHaveBeenCalledWith(
            "/admin/service-records/schedules/11/prepare-link",
            { recipientPhone: "01066211878" },
            { headers: { Authorization: "Bearer token-1" } },
        );
        await expect(response.json()).resolves.toEqual(expect.objectContaining({ preparedLinkToken }));
    });

    it("forwards only the validated prepared token when sending", async () => {
        mockPost.mockResolvedValue({
            status: 201,
            data: { ok: true, scheduledFor: "2026-07-13T00:00:00.000Z" },
        });

        const response = await sendLink(
            createRequest("/api/admin/service-records/schedules/11/send-link", {
                preparedLinkToken,
                recipientPhone: "01066211878",
                ignored: "do-not-forward",
            }),
            { params: Promise.resolve({ scheduleId: "11" }) },
        );

        expect(response.status).toBe(201);
        expect(mockPost).toHaveBeenCalledWith(
            "/admin/service-records/schedules/11/send-link",
            { preparedLinkToken, recipientPhone: "01066211878" },
            { headers: { Authorization: "Bearer token-1" } },
        );
    });

    it("resets a link without calling the send endpoint", async () => {
        mockPost.mockResolvedValue({
            status: 201,
            data: {
                serviceRecordUrl: `https://mobile.test/service-record/${preparedLinkToken}`,
                expiresAt: "2026-07-20T00:00:00.000Z",
            },
        });

        const response = await resetLink(
            createRequest("/api/admin/service-records/schedules/11/reset-link"),
            { params: Promise.resolve({ scheduleId: "11" }) },
        );

        expect(response.status).toBe(201);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(mockPost).toHaveBeenCalledWith(
            "/admin/service-records/schedules/11/reset-link",
            {},
            { headers: { Authorization: "Bearer token-1" } },
        );
        expect(mockPost).not.toHaveBeenCalledWith(
            expect.stringContaining("/send-link"),
            expect.anything(),
            expect.anything(),
        );
    });

    it("rejects malformed prepared tokens before they reach the backend", async () => {
        const response = await sendLink(
            createRequest("/api/admin/service-records/schedules/11/send-link", {
                preparedLinkToken: "efl_invalid",
            }),
            { params: Promise.resolve({ scheduleId: "11" }) },
        );

        expect(response.status).toBe(400);
        expect(mockPost).not.toHaveBeenCalled();
    });

    it("rejects malformed recipient phones before they reach the backend", async () => {
        const response = await sendLink(
            createRequest("/api/admin/service-records/schedules/11/send-link", {
                preparedLinkToken,
                recipientPhone: "010-12",
            }),
            { params: Promise.resolve({ scheduleId: "11" }) },
        );

        expect(response.status).toBe(400);
        expect(mockPost).not.toHaveBeenCalled();
    });

    it("requires admin authentication before preparing a bearer link", async () => {
        const response = await prepareLink(
            createRequest("/api/admin/service-records/schedules/11/prepare-link", undefined, false),
            { params: Promise.resolve({ scheduleId: "11" }) },
        );

        expect(response.status).toBe(401);
        expect(mockPost).not.toHaveBeenCalled();
    });

    it("requires admin authentication before resetting a bearer link", async () => {
        const response = await resetLink(
            createRequest("/api/admin/service-records/schedules/11/reset-link", undefined, false),
            { params: Promise.resolve({ scheduleId: "11" }) },
        );

        expect(response.status).toBe(401);
        expect(mockPost).not.toHaveBeenCalled();
    });
});
