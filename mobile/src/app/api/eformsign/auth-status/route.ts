import { NextRequest, NextResponse } from "next/server";
import { getAuthToken } from "@/lib/api/route-utils";

export async function GET(request: NextRequest) {
    return NextResponse.json({
        hasAppAuthToken: Boolean(getAuthToken(request)),
        providerSession: "server-only" as const,
    });
}
