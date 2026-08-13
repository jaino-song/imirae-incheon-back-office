import { NextRequest } from "next/server";

import { errorResponse } from "@babyjamjam/shared/api";
import { serverAPIClient } from "@/lib/api/server";
import {
    backendJsonResponse,
    getAuthHeaders,
    getAuthToken,
    unauthorizedResponse,
} from "@/lib/api/route-utils";

export async function GET(request: NextRequest) {
    const token = getAuthToken(request);
    if (!token) {
        return unauthorizedResponse("Authentication required. Please log in.");
    }

    try {
        const response = await serverAPIClient.get("/eformsign-docs/jobs/summary", {
            headers: getAuthHeaders(token),
        });
        return backendJsonResponse(response);
    } catch (error) {
        return errorResponse(error, "fetch eformsign document job summary");
    }
}
