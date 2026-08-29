import { NextRequest } from "next/server";

import { proxyLocalGetRequest } from "@/lib/api/route-utils";

// Filter params forwarded verbatim to the backend, which owns their validation.
// Blank values are dropped so the backend keeps its own defaults.
const PASSTHROUGH_FILTER_PARAMS = ["section", "templateId", "templateMatch", "search"] as const;

/**
 * GET /api/eformsign/documents/status-counts
 * Raw status signals for the current branch, with the same pre-slice filters as
 * the paginated documents endpoint (section or templateId/templateMatch, search,
 * excludeDeleted). The client folds the signals into per-category counts for the
 * filter pills.
 */
export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const backendParams = new URLSearchParams();

    for (const name of PASSTHROUGH_FILTER_PARAMS) {
        const value = searchParams.get(name)?.trim();
        if (value) {
            backendParams.set(name, value);
        }
    }

    if (searchParams.get("excludeDeleted") === "true") {
        backendParams.set("excludeDeleted", "true");
    }

    const query = backendParams.toString();
    return proxyLocalGetRequest(
        request,
        `/api/documents/status-counts${query ? `?${query}` : ""}`,
        "fetch eformsign document status counts",
    );
}
