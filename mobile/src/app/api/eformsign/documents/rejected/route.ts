import { NextRequest } from "next/server";
import { proxyLocalGetRequest } from "@/lib/api/route-utils";

export async function GET(request: NextRequest) {
    return proxyLocalGetRequest(request, "/api/documents/rejected", "fetch rejected documents");
}
