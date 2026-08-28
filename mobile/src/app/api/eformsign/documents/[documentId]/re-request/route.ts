import { NextRequest } from "next/server";
import { z } from "zod";

import { proxyPostRequest } from "@/lib/api/route-utils";

type RouteParams = { params: Promise<{ documentId: string }> };

// Mirrors backend ReRequestOutsiderDocumentRequestDto (eformsign.dto.ts):
// stepType + stepSeq are required; comment and recipientPhone are optional.
// Passthrough keeps forward-compatible fields while the shared proxy strips
// provider credential-shaped fields before forwarding.
const reRequestSchema = z
    .object({
        stepType: z.string().min(1),
        stepSeq: z.string().min(1),
    })
    .passthrough();

export async function POST(request: NextRequest, { params }: RouteParams) {
    const { documentId } = await params;

    return proxyPostRequest(
        request,
        `/api/documents/${encodeURIComponent(documentId)}/re_request_outsider`,
        "re-request eformsign document",
        { bodySchema: reRequestSchema },
    );
}
