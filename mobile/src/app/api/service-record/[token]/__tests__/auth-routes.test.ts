/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";

import { GET as getContext } from "../context/route";
import { POST as authorizeHeaderEdit } from "../header-edit/authorize/route";
import { POST as submitSession } from "../sessions/[index]/submit/route";
import { POST as verifyPhone } from "../verify/route";

jest.mock("@/lib/api/server", () => ({
    serverAPIClient: {
        get: jest.fn(),
        post: jest.fn(),
    },
}));

const mockGet = serverAPIClient.get as jest.Mock;
const mockPost = serverAPIClient.post as jest.Mock;

describe("service-record authentication routes", () => {
    beforeEach(() => {
        mockGet.mockReset();
        mockPost.mockReset();
    });

    it("stores the verified access token in a path-scoped HttpOnly cookie", async () => {
        mockPost.mockResolvedValue({
            status: 200,
            data: { ok: true, accessToken: "persisted-access-token" },
        });
        const request = new NextRequest("http://localhost/api/service-record/link-token/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ phone: "010-1234-5678" }),
        });

        const response = await verifyPhone(request, {
            params: Promise.resolve({ token: "link-token" }),
        });

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ ok: true });
        expect(response.headers.get("set-cookie")).toEqual(expect.stringContaining("service_record_access=persisted-access-token"));
        expect(response.headers.get("set-cookie")).toEqual(expect.stringContaining("HttpOnly"));
        expect(response.headers.get("set-cookie")).toEqual(expect.stringContaining("SameSite=lax"));
        expect(response.headers.get("set-cookie")).toEqual(expect.stringContaining("Path=/api/service-record/link-token"));
    });

    it("forwards the persisted access cookie when the browser sends no Authorization header", async () => {
        mockGet.mockResolvedValue({ status: 200, data: { totalSessions: 1 } });
        const request = new NextRequest("http://localhost/api/service-record/link-token/context", {
            headers: { cookie: "service_record_access=persisted-access-token" },
        });

        const response = await getContext(request);

        expect(response.status).toBe(200);
        expect(mockGet).toHaveBeenCalledWith("/service-record/context", {
            headers: { Authorization: "Bearer persisted-access-token" },
        });
    });

    it("stores a validated admin header-edit capability in a path-scoped HttpOnly cookie", async () => {
        mockPost.mockResolvedValue({
            status: 200,
            data: { ok: true },
        });
        const request = new NextRequest(
            "http://localhost/api/service-record/link-token/header-edit/authorize",
            {
                method: "POST",
                headers: { Authorization: "Bearer sreh_admin_token" },
            },
        );

        const response = await authorizeHeaderEdit(request, {
            params: Promise.resolve({ token: "link-token" }),
        });

        expect(response.status).toBe(200);
        expect(mockPost).toHaveBeenCalledWith(
            "/service-record/header-edit/authorize",
            { linkToken: "link-token" },
            { headers: { Authorization: "Bearer sreh_admin_token" } },
        );
        expect(response.headers.get("set-cookie")).toEqual(
            expect.stringContaining("service_record_header_edit=sreh_admin_token"),
        );
        expect(response.headers.get("set-cookie")).toEqual(expect.stringContaining("HttpOnly"));
        expect(response.headers.get("set-cookie")).toEqual(
            expect.stringContaining("Path=/api/service-record/link-token"),
        );
    });

    it("uses the admin capability for basic information context when both cookies exist", async () => {
        mockGet.mockResolvedValue({ status: 200, data: { canEditHeader: true } });
        const request = new NextRequest("http://localhost/api/service-record/link-token/context", {
            headers: {
                cookie: [
                    "service_record_access=provider-access-token",
                    "service_record_header_edit=sreh_admin_token",
                ].join("; "),
            },
        });

        const response = await getContext(request);

        expect(response.status).toBe(200);
        expect(mockGet).toHaveBeenCalledWith("/service-record/context", {
            headers: { Authorization: "Bearer sreh_admin_token" },
        });
    });

    it("never forwards an admin capability to a daily session endpoint", async () => {
        mockPost.mockResolvedValue({
            status: 401,
            data: { message: "Unauthorized" },
        });
        const request = new NextRequest(
            "http://localhost/api/service-record/link-token/sessions/1/submit",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    cookie: "service_record_header_edit=sreh_admin_token",
                },
                body: JSON.stringify({ serviceDate: "2026-07-29" }),
            },
        );

        const response = await submitSession(request, {
            params: Promise.resolve({ token: "link-token", index: "1" }),
        });

        expect(response.status).toBe(401);
        expect(mockPost).toHaveBeenCalledWith(
            "/service-record/sessions/1/submit",
            { serviceDate: "2026-07-29" },
            { headers: { Authorization: "" } },
        );
    });
});
