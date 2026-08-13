import { NextRequest } from "next/server";

import { errorResponse } from "@babyjamjam/shared/api";
import { serverAPIClient } from "@/lib/api/server";
import {
    backendJsonResponse,
    getAuthHeaders,
    getAuthToken,
    invalidJsonResponse,
    readJsonObjectBody,
    unauthorizedResponse,
} from "@/lib/api/route-utils";

export async function POST(request: NextRequest) {
    const token = getAuthToken(request);
    if (!token) {
        return unauthorizedResponse("Authentication required. Please log in.");
    }

    try {
        const body = await readJsonObjectBody(request);
        const response = await serverAPIClient.post("/eformsign-docs/jobs/creation", body, {
            headers: getAuthHeaders(token),
        });
        return backendJsonResponse(response);
    } catch (error) {
        return invalidJsonResponse(error) ?? errorResponse(error, "enqueue eformsign document creation");
    }
}
