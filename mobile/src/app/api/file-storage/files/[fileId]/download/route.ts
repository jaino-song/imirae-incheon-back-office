import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import {
    errorResponse,
    getAuthHeaders,
    getAuthToken,
    unauthorizedResponse,
} from "@/lib/api/route-utils";
import {
    documentPath,
    invalidFileIdResponse,
    isValidFileId,
} from "../../../file-route-utils";

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

        // The backend decides Content-Type / Content-Disposition /
        // X-Content-Type-Options; the proxy only copies them through and never
        // invents its own values beyond the octet-stream/inline fallbacks.
        // Dropping nosniff here would let a browser re-sniff a type the backend
        // deliberately allowlisted for inline display.
        const headers: Record<string, string> = {
            "Content-Type": String(response.headers["content-type"] ?? "application/octet-stream"),
            "Content-Disposition": String(response.headers["content-disposition"] ?? "inline"),
            "Content-Length": String(response.data.byteLength),
        };
        const nosniff = response.headers["x-content-type-options"];
        if (nosniff) {
            headers["X-Content-Type-Options"] = String(nosniff);
        }

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
