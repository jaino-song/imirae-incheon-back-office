/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import { DELETE, GET, PATCH } from "./route";

jest.mock("@/lib/api/server", () => ({
    serverAPIClient: {
        get: jest.fn(),
        patch: jest.fn(),
        delete: jest.fn(),
    },
}));

const mockGet = serverAPIClient.get as jest.Mock;
const mockPatch = serverAPIClient.patch as jest.Mock;
const mockDelete = serverAPIClient.delete as jest.Mock;

function createRequest(method = "DELETE", body?: object): NextRequest {
    return new NextRequest("http://localhost/api/clients/75", {
        method,
        headers: {
            cookie: "auth_token=access-token",
            ...(body ? { "content-type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
    });
}

describe("PATCH /api/clients/[id]", () => {
    beforeEach(() => {
        mockPatch.mockReset();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("forwards an empty relink-only update", async () => {
        mockPatch.mockResolvedValue({ data: { id: 75 } });

        const response = await PATCH(createRequest("PATCH", {}), {
            params: Promise.resolve({ id: "75" }),
        });

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ id: 75 });
        expect(mockPatch).toHaveBeenCalledWith(
            "/clients/75",
            {},
            { headers: { Authorization: "Bearer access-token" } },
        );
    });

    it("preserves the upstream status without logging or returning private details", async () => {
        const privateMessage = "private customer details";
        const privateToken = "Bearer private-token";
        const consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);
        mockPatch.mockRejectedValue({
            response: {
                status: 404,
                data: {
                    code: "CLIENT_NOT_FOUND",
                    message: privateMessage,
                },
            },
            config: {
                headers: { Authorization: privateToken },
                data: privateMessage,
            },
        });

        const response = await PATCH(createRequest("PATCH", {}), {
            params: Promise.resolve({ id: "75" }),
        });

        expect(response.status).toBe(404);
        await expect(response.json()).resolves.toEqual({
            error: "Failed to update client",
            code: "CLIENT_NOT_FOUND",
        });
        const logged = JSON.stringify(consoleError.mock.calls);
        expect(logged).not.toContain(privateMessage);
        expect(logged).not.toContain(privateToken);
    });
});

describe("GET /api/clients/[id]", () => {
    beforeEach(() => {
        mockGet.mockReset();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("preserves a sanitized upstream not-found response", async () => {
        const privateMessage = "private database details";
        const consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);
        mockGet.mockRejectedValue({
            response: {
                status: 404,
                data: {
                    code: "CLIENT_NOT_FOUND",
                    message: privateMessage,
                },
            },
            config: {
                headers: { Authorization: "Bearer private-token" },
            },
        });

        const response = await GET(createRequest("GET"), {
            params: Promise.resolve({ id: "75" }),
        });

        expect(response.status).toBe(404);
        await expect(response.json()).resolves.toEqual({
            error: "Failed to fetch client",
            code: "CLIENT_NOT_FOUND",
        });
        expect(JSON.stringify(consoleError.mock.calls)).not.toContain(privateMessage);
        expect(JSON.stringify(consoleError.mock.calls)).not.toContain("private-token");
    });
});

describe("DELETE /api/clients/[id]", () => {
    beforeEach(() => {
        mockDelete.mockReset();
    });

    it("passes through the allowlisted safe detail for a coded delete conflict", async () => {
        mockDelete.mockRejectedValue({
            response: {
                status: 409,
                data: {
                    error: "Conflict",
                    code: "CLIENT_DELETE_CONFLICT",
                    message: "연결된 데이터로 인해 고객을 삭제할 수 없습니다. 잠시 후 다시 시도해 주세요.",
                },
            },
        });

        const response = await DELETE(createRequest(), {
            params: Promise.resolve({ id: "75" }),
        });

        expect(response.status).toBe(409);
        await expect(response.json()).resolves.toEqual({
            error: "연결된 데이터로 인해 고객을 삭제할 수 없습니다. 잠시 후 다시 시도해 주세요.",
            code: "CLIENT_DELETE_CONFLICT",
        });
    });

    it("does not expose an unrecognized upstream conflict message", async () => {
        mockDelete.mockRejectedValue({
            response: {
                status: 409,
                data: {
                    error: "Conflict",
                    message: "relation client_private_internal_fkey failed",
                },
            },
        });

        const response = await DELETE(createRequest(), {
            params: Promise.resolve({ id: "75" }),
        });

        expect(response.status).toBe(409);
        await expect(response.json()).resolves.toEqual({
            error: "연결된 정보 때문에 고객을 삭제할 수 없습니다. 잠시 후 다시 시도해 주세요.",
            code: "CLIENT_DELETE_CONFLICT",
        });
    });
});
