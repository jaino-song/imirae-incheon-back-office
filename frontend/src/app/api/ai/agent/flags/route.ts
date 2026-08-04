import { NextRequest } from "next/server";
import { proxyAgentRequest } from "../_proxy";

export async function PATCH(request: NextRequest) {
    return proxyAgentRequest(request, "/ai/agent/flags", "PATCH", await request.json());
}
