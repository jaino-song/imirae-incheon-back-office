import { NextRequest, NextResponse } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import {
    getAuthHeaders,
    getAuthToken,
    unauthorizedResponse,
} from "@/lib/api/route-utils";
// Deliberately the shared sanitizing errorResponse: the local
// "@/lib/api/route-utils" binds errorResponse to legacy-message mode, which
// forwards upstream error text to the browser. File-storage mirrors mobile's
// sanitized error behaviour.
import { errorResponse } from "@babyjamjam/shared/api";
import {
    documentPath,
    invalidFileIdResponse,
    isValidFileId,
} from "../../../file-route-utils";

// The backend decides Content-Type / Content-Disposition /
// X-Content-Type-Options; the proxy only copies them through and never
// invents its own values beyond the octet-stream/inline fallbacks.
function copyNosniffHeader(
    upstreamHeaders: Record<string, unknown> | undefined,
    headers: Record<string, string>,
): void {
    const nosniff = upstreamHeaders?.["x-content-type-options"];
    if (nosniff) {
        headers["X-Content-Type-Options"] = String(nosniff);
    }
}

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ fileId: string }> }
) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return unauthorizedResponse("Unauthorized");
        }

        const { fileId } = await params;
        if (!isValidFileId(fileId)) {
            return invalidFileIdResponse();
        }

        const { searchParams } = new URL(request.url);
        const attachment = searchParams.get("attachment");

        const url = documentPath(
            fileId,
            attachment === "true" ? "/download?attachment=true" : "/download",
        );

        const response = await serverAPIClient.get(url, {
            headers: getAuthHeaders(token),
            responseType: "arraybuffer",
        });

        const headers: Record<string, string> = {
            "Content-Type": String(response.headers["content-type"] ?? "application/octet-stream"),
            "Content-Disposition": String(response.headers["content-disposition"] ?? "inline"),
            "Content-Length": String(response.data.byteLength),
        };
        copyNosniffHeader(response.headers, headers);

        return new NextResponse(response.data, {
            status: response.status,
            headers,
        });
    } catch (error) {
        if (error && typeof error === "object" && "response" in error) {
            const axiosError = error as { response?: { status: number } };
            if (axiosError.response?.status === 404) {
                return NextResponse.json({ error: "Document not found" }, { status: 404 });
            }
        }
        return errorResponse(error, "download document");
    }
}

// Answers metadata preflights without transferring the file body. HEAD
// responses stay body-less on every path, including errors.
export async function HEAD(
    request: NextRequest,
    { params }: { params: Promise<{ fileId: string }> }
) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return new NextResponse(null, { status: 401 });
        }

        const { fileId } = await params;
        if (!isValidFileId(fileId)) {
            return new NextResponse(null, { status: 400 });
        }

        const response = await serverAPIClient.get(documentPath(fileId), {
            headers: getAuthHeaders(token),
        });

        const headers: Record<string, string> = {
            "Content-Type": response.data?.mimeType || "application/octet-stream",
            "Content-Disposition": "inline",
        };
        if (typeof response.data?.fileSize === "number") {
            headers["Content-Length"] = String(response.data.fileSize);
        }
        copyNosniffHeader(response.headers, headers);

        return new NextResponse(null, { headers });
    } catch (error) {
        if (error && typeof error === "object" && "response" in error) {
            const axiosError = error as { response?: { status: number } };
            if (axiosError.response?.status === 404) {
                return new NextResponse(null, { status: 404 });
            }
        }
        return new NextResponse(null, { status: 500 });
    }
}
