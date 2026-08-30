import { NextRequest, NextResponse } from "next/server";
/** Browser provider primitives are retired in favour of server-mediated jobs. */
export async function POST(_request: NextRequest): Promise<NextResponse> {
    return NextResponse.json(
        {
            code: "EFORMSIGN_PROVIDER_OPERATION_SERVER_ONLY",
            error: "eformsign provider operations are server-only",
        },
        { status: 410, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
}
