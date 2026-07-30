import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import {
  getAuthHeaders,
  getAuthToken,
  unauthorizedResponse,
} from "@/lib/api/route-utils";

type RouteParams = { params: Promise<{ documentId: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const authToken = getAuthToken(request);

    if (!authToken) {
      return unauthorizedResponse("Authentication required. Please log in.");
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
      const payload = JSON.parse(Buffer.from(response.data).toString("utf-8"));
      return NextResponse.json(payload, { status: response.status });
    }

    return new NextResponse(response.data, {
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
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to preview eformsign document" },
      { status: 500 }
    );
  }
}
