import { NextRequest, NextResponse } from "next/server";

/** Legacy provider token path retained as a deterministic tombstone. */
export async function POST(_request: NextRequest): Promise<NextResponse> {
    return NextResponse.json(
        {
            code: "EFORMSIGN_CREDENTIALS_SERVER_ONLY",
            error: "Raw eformsign credentials are not exposed",
        },
        { status: 410, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
}
