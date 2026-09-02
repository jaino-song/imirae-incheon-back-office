import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import {
    errorResponse,
    getUpstreamErrorStatus,
    logUpstreamError,
    sanitizeUpstreamClientError,
} from "@/lib/api/route-utils";

type RouteParams = { params: Promise<{ id: string }> };

const CLIENT_RETENTION_BLOCKED_CODE = "CLIENT_RETENTION_BLOCKED";
const CLIENT_RETENTION_BLOCKED_MESSAGE =
    "연결된 운영 또는 이력 데이터가 있어 고객을 삭제할 수 없습니다.";
const CLIENT_DELETE_CONFLICT_FALLBACK =
    "연결된 정보 때문에 고객을 삭제할 수 없습니다. 잠시 후 다시 시도해 주세요.";

function getUpstreamErrorData(error: unknown): unknown {
    if (!error || typeof error !== "object" || !("response" in error)) return undefined;
    const response = (error as { response?: { data?: unknown } }).response;
    return response?.data;
}

function getUpstreamErrorCode(error: unknown): unknown {
    const data = getUpstreamErrorData(error);
    if (!data || typeof data !== "object") return undefined;
    return (data as { code?: unknown }).code;
}

// Helper to get auth token from request
function getAuthToken(request: NextRequest): string | null {
    return request.cookies.get("auth_token")?.value || null;
}

// Helper to create authorization headers
function getAuthHeaders(token: string | null): Record<string, string> {
    return token ? { Authorization: `Bearer ${token}` } : {};
}

// GET /api/clients/[id] - Get a client by ID
export async function GET(request: NextRequest, { params }: RouteParams) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { id } = await params;
        const response = await serverAPIClient.get(`/clients/${id}`, {
            headers: getAuthHeaders(token),
        });
        return NextResponse.json(response.data);
    } catch (error) {
        logUpstreamError("fetch client", error);
        return NextResponse.json(
            sanitizeUpstreamClientError(
                getUpstreamErrorData(error),
                "Failed to fetch client",
            ),
            { status: getUpstreamErrorStatus(error) },
        );
    }
}

// PATCH /api/clients/[id] - Update a client
export async function PATCH(request: NextRequest, { params }: RouteParams) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { id } = await params;
        const body = await request.json();
        const response = await serverAPIClient.patch(`/clients/${id}`, body, {
            headers: getAuthHeaders(token),
        });
        return NextResponse.json(response.data);
    } catch (error) {
        logUpstreamError("update client", error);
        return NextResponse.json(
            sanitizeUpstreamClientError(
                getUpstreamErrorData(error),
                "Failed to update client",
            ),
            { status: getUpstreamErrorStatus(error) },
        );
    }
}

// DELETE /api/clients/[id] - Delete a client
export async function DELETE(request: NextRequest, { params }: RouteParams) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { id } = await params;
        await serverAPIClient.delete(`/clients/${id}`, {
            headers: getAuthHeaders(token),
        });
        return NextResponse.json({ success: true });
    } catch (error) {
        if (getUpstreamErrorStatus(error) === 409) {
            const isAllowlistedConflict = getUpstreamErrorCode(error) === CLIENT_RETENTION_BLOCKED_CODE;
            logUpstreamError("delete client", error);
            return NextResponse.json(
                {
                    error: isAllowlistedConflict
                        ? CLIENT_RETENTION_BLOCKED_MESSAGE
                        : CLIENT_DELETE_CONFLICT_FALLBACK,
                    code: CLIENT_RETENTION_BLOCKED_CODE,
                },
                { status: 409 },
            );
        }
        return errorResponse(error, "delete client");
    }
}
