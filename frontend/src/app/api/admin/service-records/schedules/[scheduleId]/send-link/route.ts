import { isAxiosError } from "axios";
import { NextRequest, NextResponse } from "next/server";

import { serverAPIClient } from "@/lib/api/server";

type RouteParams = { params: Promise<{ scheduleId: string }> };
const PREPARED_LINK_TOKEN_PATTERN = /^efl_[A-Za-z0-9_-]{40,64}$/;
const RECIPIENT_PHONE_PATTERN = /^01[016789]-?\d{3,4}-?\d{4}$/;

function getAuthToken(request: NextRequest): string | null {
    return request.cookies.get("auth_token")?.value || null;
}

function getAuthHeaders(token: string | null): Record<string, string> {
    return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function POST(request: NextRequest, { params }: RouteParams) {
    const token = getAuthToken(request);
    if (!token) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { scheduleId } = await params;
    const requestBody = await request.json().catch(() => ({}));
    const preparedLinkToken = requestBody && typeof requestBody === "object"
        ? (requestBody as { preparedLinkToken?: unknown }).preparedLinkToken
        : undefined;
    const recipientPhone = requestBody && typeof requestBody === "object"
        ? (requestBody as { recipientPhone?: unknown }).recipientPhone
        : undefined;
    if (
        preparedLinkToken !== undefined
        && (typeof preparedLinkToken !== "string" || !PREPARED_LINK_TOKEN_PATTERN.test(preparedLinkToken))
    ) {
        return NextResponse.json({ error: "Invalid prepared service-record link" }, { status: 400 });
    }
    if (
        recipientPhone !== undefined
        && (typeof recipientPhone !== "string" || !RECIPIENT_PHONE_PATTERN.test(recipientPhone))
    ) {
        return NextResponse.json({ error: "Invalid recipient phone" }, { status: 400 });
    }

    try {
        const body = {
            ...(preparedLinkToken ? { preparedLinkToken } : {}),
            ...(recipientPhone ? { recipientPhone } : {}),
        };
        const response = await serverAPIClient.post(
            `/admin/service-records/schedules/${encodeURIComponent(scheduleId)}/send-link`,
            body,
            { headers: getAuthHeaders(token) },
        );
        return NextResponse.json(response.data ?? {}, { status: response.status });
    } catch (error) {
        if (isAxiosError(error) && error.response) {
            return NextResponse.json(error.response.data ?? { error: "Request failed" }, {
                status: error.response.status,
            });
        }
        console.error("[API] Error sending service record link");
        return NextResponse.json({ error: "Failed to send service record link" }, { status: 500 });
    }
}
