import { NextRequest } from "next/server";
import { proxyAgentRequest } from "../agent/_proxy";

export async function GET(request: NextRequest) {
    return proxyAgentRequest(request, "/ai/actions", "GET");
}
