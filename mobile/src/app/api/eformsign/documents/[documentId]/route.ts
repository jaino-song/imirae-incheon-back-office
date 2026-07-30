import { NextRequest } from "next/server";
import { proxyLocalGetRequest } from "@/lib/api/route-utils";

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ documentId: string }> }
) {
    const { documentId } = await params;

    return proxyLocalGetRequest(
        request,
        `/api/documents/${encodeURIComponent(documentId)}`,
        "fetch eformsign document detail"
    );
}
