import { NextRequest } from "next/server";
import { proxyAgentRequest } from "../_proxy";

export async function POST(request: NextRequest) {
    return proxyAgentRequest(request, "/ai/agent/emergency-disable", "POST");
}
