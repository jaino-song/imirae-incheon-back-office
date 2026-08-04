import { NextRequest } from "next/server";
import { proxyAgentRequest } from "../../_proxy";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Context) {
    const id = encodeURIComponent((await context.params).id);
    return proxyAgentRequest(request, `/ai/agent/sessions/${id}`, "GET");
}

export async function PATCH(request: NextRequest, context: Context) {
    const id = encodeURIComponent((await context.params).id);
    return proxyAgentRequest(request, `/ai/agent/sessions/${id}`, "PATCH", await request.json());
}

export async function DELETE(request: NextRequest, context: Context) {
    const id = encodeURIComponent((await context.params).id);
    return proxyAgentRequest(request, `/ai/agent/sessions/${id}`, "DELETE");
}
