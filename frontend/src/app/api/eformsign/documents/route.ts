import { NextRequest, NextResponse } from "next/server";
import {
    errorResponse,
    getAuthHeaders,
    getAuthToken,
    sanitizeUpstreamClientError,
    unauthorizedResponse,
} from "@/lib/api/route-utils";
import { serverAPIClient } from "@/lib/api/server";

/**
 * GET /api/eformsign/documents
 * Unified endpoint to fetch all eformsign documents (in-progress, completed, expired)
 *
 * Query params:
 * - limit: number of documents to fetch (default: 100)
 * - skip: number of documents to skip for pagination (default: 0)
 */
export async function GET(request: NextRequest) {
    const authToken = getAuthToken(request);

    if (!authToken) {
        return unauthorizedResponse("Authentication required. Please log in.");
    }

    const { searchParams } = new URL(request.url);
    const limit = searchParams.get("limit") || "100";
    const skip = searchParams.get("skip") || "0";
    const type = searchParams.get("type");
    const templateId = searchParams.get("templateId") || "";
    const templateMatch = searchParams.get("templateMatch") || "include";
    // Forwarded verbatim: the backend validates section and, when present, resolves
    // the template whitelist itself (server-side area_template registry).
    const section = searchParams.get("section") || "";
    const backendPathByType: Record<string, string> = {
        "in-progress": "/api/documents/in-progress",
        completed: "/api/documents/completed",
        expired: "/api/documents/rejected",
        // Deprecated alias for old callers. New UI filters use "expired".
        rejected: "/api/documents/rejected",
    };

    const backendPath = type && backendPathByType[type]
        ? backendPathByType[type]
        : "/api/documents";

    try {
        const response = await serverAPIClient.get(backendPath, {
            params: {
                limit,
                skip,
                ...(templateId ? { templateId, templateMatch } : {}),
                ...(section ? { section } : {}),
                ...(searchParams.get("statusCategory")
                    ? { statusCategory: searchParams.get("statusCategory") }
                    : {}),
                ...(searchParams.get("search")
                    ? { search: searchParams.get("search") }
                    : {}),
                ...(searchParams.get("excludeDeleted") === "true"
                    ? { excludeDeleted: "true" }
                    : {}),
            },
            headers: getAuthHeaders(authToken),
        });

        if (response.status >= 400) {
            return NextResponse.json(
                sanitizeUpstreamClientError(response.data, "Failed to fetch all eformsign documents"),
                { status: response.status },
            );
        }

        return NextResponse.json(response.data);
    } catch (error) {
        return errorResponse(error, "fetch all eformsign documents");
    }
}

export async function DELETE(request: NextRequest) {
    const authToken = getAuthToken(request);

    if (!authToken) {
        return unauthorizedResponse("Authentication required. Please log in.");
    }

    const { searchParams } = new URL(request.url);
    const isPermanent = searchParams.get("is_permanent");
    try {
        const body = await request.json().catch(() => ({}));

        const response = await serverAPIClient.delete("/api/documents", {
            params: isPermanent ? { is_permanent: isPermanent } : {},
            data: body,
            headers: getAuthHeaders(authToken),
        });

        if (response.status >= 400) {
            return NextResponse.json(
                sanitizeUpstreamClientError(response.data, "Failed to delete eformsign documents"),
                { status: response.status },
            );
        }

        return NextResponse.json(response.data);
    } catch (error) {
        return errorResponse(error, "delete eformsign documents");
    }
}
