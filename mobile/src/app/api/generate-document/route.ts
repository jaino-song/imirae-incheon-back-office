import { NextRequest, NextResponse } from "next/server";

/** Browser provider primitives are retired in favour of dispatch-headless. */
export async function POST(_request: NextRequest): Promise<NextResponse> {
    return NextResponse.json(
        {
            code: "EFORMSIGN_PROVIDER_OPERATION_SERVER_ONLY",
            error: "Use the server-mediated eformsign dispatch operation",
        },
        { status: 410, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
}
