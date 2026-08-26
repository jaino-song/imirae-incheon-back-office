/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import { GET } from "./route";

jest.mock("@/lib/api/server", () => ({
    serverAPIClient: { get: jest.fn() },
}));

const mockGet = serverAPIClient.get as jest.Mock;

function createRequest(path: string, cookie = "auth_token=auth-token") {
    return new NextRequest(`http://localhost${path}`, { headers: { cookie } });
}

describe("employee work-history API route", () => {
    beforeEach(() => mockGet.mockReset());

    it("requires app authentication before proxying", async () => {
        const response = await GET(createRequest("/api/employees/7/work-history", ""), {
            params: Promise.resolve({ id: "7" }),
        });

        expect(response.status).toBe(401);
        expect(mockGet).not.toHaveBeenCalled();
    });

    it("rejects invalid ids and pagination before proxying", async () => {
        await expect(
            GET(createRequest("/api/employees/0/work-history?page=1&limit=20"), {
                params: Promise.resolve({ id: "0" }),
            }),
        ).resolves.toMatchObject({ status: 400 });
        await expect(
            GET(createRequest("/api/employees/7/work-history?page=0&limit=20"), {
                params: Promise.resolve({ id: "7" }),
            }),
        ).resolves.toMatchObject({ status: 400 });
        await expect(
            GET(createRequest("/api/employees/7/work-history?page=1&limit=101"), {
                params: Promise.resolve({ id: "7" }),
            }),
        ).resolves.toMatchObject({ status: 400 });
        expect(mockGet).not.toHaveBeenCalled();
    });

    it("forwards branch-authenticated paginated history without widening the payload", async () => {
        mockGet.mockResolvedValue({
            status: 200,
            data: {
                data: [{
                    scheduleId: 22,
                    clientId: 11,
                    clientName: "박서연",
                    role: "primary",
                    startDate: "2025-01-01",
                    endDate: "2025-06-30",
                    status: "completed",
                }],
                total: 1,
                page: 2,
                limit: 10,
                totalPages: 1,
            },
        });

        const response = await GET(createRequest("/api/employees/7/work-history?page=2&limit=10"), {
            params: Promise.resolve({ id: "7" }),
        });

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toMatchObject({ total: 1, page: 2 });
        expect(mockGet).toHaveBeenCalledWith("/employees/7/work-history", {
            params: { page: "2", limit: "10" },
            headers: { Authorization: "Bearer auth-token" },
        });
    });
});
