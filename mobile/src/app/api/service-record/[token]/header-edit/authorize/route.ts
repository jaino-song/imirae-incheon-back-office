import { NextRequest, NextResponse } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import { backendJsonResponse, errorResponse, withNoStore } from "@/lib/api/route-utils";
import {
    getServiceRecordAuthorization,
    setServiceRecordHeaderEditCookie,
} from "@/lib/api/service-record-auth";

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ token: string }> },
) {
    const { token: linkToken } = await params;
    const authorization = getServiceRecordAuthorization(request, { allowHeaderEdit: true });

    try {
        const response = await serverAPIClient.post(
            "/service-record/header-edit/authorize",
            { linkToken },
            { headers: { Authorization: authorization } },
        );
        if (response.status >= 200 && response.status < 300) {
            const capability = authorization.match(/^Bearer\s+(.+)$/)?.[1];
            const authorizedResponse = withNoStore(
                NextResponse.json({ ok: true }, { status: response.status }),
            );
            if (capability) {
                setServiceRecordHeaderEditCookie(
                    authorizedResponse,
                    linkToken,
                    capability,
                );
            }
            return authorizedResponse;
        }
        return withNoStore(backendJsonResponse(response));
    } catch (error) {
        return errorResponse(error, "authorize service-record header edit");
    }
}
