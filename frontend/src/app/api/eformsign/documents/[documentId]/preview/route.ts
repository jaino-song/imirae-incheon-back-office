import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import {
  getAuthHeaders,
  getAuthToken,
  unauthorizedResponse,
} from "@/lib/api/route-utils";

type RouteParams = { params: Promise<{ documentId: string }> };

async function proxyPreview(
  request: NextRequest,
  { params }: RouteParams,
  includeBody: boolean,
) {
  try {
    const authToken = getAuthToken(request);

    if (!authToken) {
      return includeBody
        ? unauthorizedResponse("Authentication required. Please log in.")
        : new NextResponse(null, { status: 401 });
    }

    const { documentId } = await params;
    const attachment = request.nextUrl.searchParams.get("attachment") === "true";

    const response = await serverAPIClient.get(`/api/documents/${documentId}/download_files`, {
      params: {
        fileType: "document",
      },
      headers: getAuthHeaders(authToken),
      responseType: "arraybuffer",
    });

    const contentType = String(response.headers["content-type"] ?? "application/octet-stream");

    if (contentType.includes("application/json")) {
      if (!includeBody) {
        return new NextResponse(null, {
          status: response.status,
          headers: { "Content-Type": contentType },
        });
      }

      const payload = JSON.parse(Buffer.from(response.data).toString("utf-8"));
      return NextResponse.json(payload, { status: response.status });
    }

    return new NextResponse(includeBody ? response.data : null, {
      status: response.status,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": attachment
          ? `attachment; filename="${documentId}.pdf"`
          : "inline",
        "Content-Length": String(response.data.byteLength),
      },
    });
  } catch (error) {
    if (!includeBody) {
      return new NextResponse(null, { status: 500 });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to preview eformsign document" },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest, context: RouteParams) {
  return proxyPreview(request, context, true);
}

export async function HEAD(request: NextRequest, context: RouteParams) {
  return proxyPreview(request, context, false);
}
