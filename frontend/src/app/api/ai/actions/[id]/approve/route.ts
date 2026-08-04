import { NextRequest } from "next/server";
import { proxyAgentRequest } from "../../../agent/_proxy";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
    const id = encodeURIComponent((await context.params).id);
    return proxyAgentRequest(request, `/ai/actions/${id}/approve`, "POST", await request.json());
}
