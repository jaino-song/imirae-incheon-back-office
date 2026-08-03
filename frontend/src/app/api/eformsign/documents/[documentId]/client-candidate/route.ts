import { NextRequest } from "next/server";
import { proxyLocalGetRequest } from "@/lib/api/route-utils";

type RouteParams = { params: Promise<{ documentId: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { documentId } = await params;

  return proxyLocalGetRequest(
    request,
    `/api/documents/${encodeURIComponent(documentId)}/client-candidate`,
    "fetch eformsign contract client candidate"
  );
}
