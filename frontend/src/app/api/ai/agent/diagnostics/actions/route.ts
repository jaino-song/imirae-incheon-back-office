import { NextRequest } from "next/server";
import { proxyAgentRequest } from "../../_proxy";

export async function GET(request: NextRequest) {
    return proxyAgentRequest(request, "/ai/agent/diagnostics/actions", "GET");
}
