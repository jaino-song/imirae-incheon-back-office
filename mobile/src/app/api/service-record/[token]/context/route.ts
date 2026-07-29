import { NextRequest } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import { backendJsonResponse, errorResponse, withNoStore } from "@/lib/api/route-utils";
import { getServiceRecordAuthorization } from "@/lib/api/service-record-auth";

// Guarded by the minted access token from the path-scoped HttpOnly cookie.
export async function GET(request: NextRequest) {
    const authorization = getServiceRecordAuthorization(request, { allowHeaderEdit: true });
    try {
        const response = await serverAPIClient.get("/service-record/context", {
            headers: { Authorization: authorization },
        });
        return withNoStore(backendJsonResponse(response));
    } catch (error) {
        return errorResponse(error, "service record context");
    }
}
