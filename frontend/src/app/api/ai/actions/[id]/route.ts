import { NextRequest } from "next/server";
import { proxyAgentRequest } from "../../agent/_proxy";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
    const id = encodeURIComponent((await context.params).id);
    return proxyAgentRequest(request, `/ai/actions/${id}`, "GET");
}
