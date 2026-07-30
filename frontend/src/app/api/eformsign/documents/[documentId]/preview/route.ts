import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import {
  getAuthHeaders,
  getAuthToken,
  getUpstreamErrorStatus,
  unauthorizedResponse,
} from "@/lib/api/route-utils";

type RouteParams = { params: Promise<{ documentId: string }> };
type UpstreamErrorWithHeaders = {
  response?: {
    headers?: Record<string, unknown>;
  };
};

const HEAD_ERROR_HEADER_ALLOWLIST = [
  "content-type",
  "retry-after",
  "www-authenticate",
] as const;

function headErrorResponse(error: unknown): NextResponse {
  const upstreamHeaders = (
    error && typeof error === "object"
      ? (error as UpstreamErrorWithHeaders).response?.headers
      : undefined
  );
  const headers = new Headers();

  for (const name of HEAD_ERROR_HEADER_ALLOWLIST) {
    const value = upstreamHeaders?.[name];
    if (typeof value === "string" || typeof value === "number") {
      headers.set(name, String(value));
    }
  }

  headers.set("Cache-Control", "no-store");

  return new NextResponse(null, {
    status: getUpstreamErrorStatus(error, 502),
    headers,
  });
}

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

    const upstreamPath = `/api/documents/${documentId}/download_files`;
    const upstreamConfig = {
      params: {
        fileType: "document",
      },
      headers: getAuthHeaders(authToken),
    };
    const response = includeBody
      ? await serverAPIClient.get(upstreamPath, {
          ...upstreamConfig,
          responseType: "arraybuffer",
        })
      : await serverAPIClient.head(upstreamPath, upstreamConfig);

    const contentType = String(response.headers["content-type"] ?? "application/octet-stream");

    if (!includeBody) {
      const contentLength = response.headers["content-length"];
      return new NextResponse(null, {
        status: response.status,
        headers: {
          "Content-Type": contentType,
          "Content-Disposition": attachment
            ? `attachment; filename="${documentId}.pdf"`
            : "inline",
          ...(contentLength !== undefined
            ? { "Content-Length": String(contentLength) }
            : {}),
          "Cache-Control": "no-store",
        },
      });
    }

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
    if (!includeBody) {
      return headErrorResponse(error);
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
