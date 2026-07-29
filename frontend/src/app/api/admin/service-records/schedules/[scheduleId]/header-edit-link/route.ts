import { isAxiosError } from "axios";
import { NextRequest, NextResponse } from "next/server";

import { serverAPIClient } from "@/lib/api/server";

type RouteParams = { params: Promise<{ scheduleId: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
    const token = request.cookies.get("auth_token")?.value;
    if (!token) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { scheduleId } = await params;
    if (!/^[1-9]\d*$/.test(scheduleId)) {
        return NextResponse.json({ error: "Invalid schedule id" }, { status: 400 });
    }

    try {
        const response = await serverAPIClient.post(
            `/admin/service-records/schedules/${scheduleId}/header-edit-link`,
            {},
            { headers: { Authorization: `Bearer ${token}` } },
        );
        return NextResponse.json(response.data ?? {}, {
            status: response.status,
            headers: { "Cache-Control": "no-store" },
        });
    } catch (error) {
        if (isAxiosError(error) && error.response) {
            return NextResponse.json(error.response.data ?? { error: "Request failed" }, {
                status: error.response.status,
            });
        }
        console.error("[API] Error creating service-record header edit link");
        return NextResponse.json(
            { error: "Failed to create service-record header edit link" },
            { status: 500 },
        );
    }
}
