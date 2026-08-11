import { isAxiosError } from "axios";
import { NextRequest, NextResponse } from "next/server";

import { serverAPIClient } from "@/lib/api/server";

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
    const token = request.cookies.get("auth_token")?.value;
    if (!token) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    try {
        const response = await serverAPIClient.post(
            `/message-trigger-jobs/${encodeURIComponent(id)}/cancel`,
            {},
            { headers: { Authorization: `Bearer ${token}` } },
        );

        return NextResponse.json(response.data ?? {}, { status: response.status });
    } catch (error) {
        if (isAxiosError(error) && error.response) {
            return NextResponse.json(error.response.data ?? { error: "Request failed" }, {
                status: error.response.status,
            });
        }

        console.error("message trigger job cancel failed:", error);
        return NextResponse.json({ error: "Failed to cancel message trigger job" }, { status: 500 });
    }
}
