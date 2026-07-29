import { NextRequest } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import { backendJsonResponse, errorResponse, withNoStore } from "@/lib/api/route-utils";
import { getServiceRecordAuthorization } from "@/lib/api/service-record-auth";

export async function PUT(request: NextRequest) {
    const authorization = getServiceRecordAuthorization(request, { allowHeaderEdit: true });
    try {
        const body = await request.json().catch(() => ({}));
        const response = await serverAPIClient.put("/service-record/header", body, {
            headers: { Authorization: authorization },
        });
        return withNoStore(backendJsonResponse(response));
    } catch (error) {
        return errorResponse(error, "save service record header");
    }
}
