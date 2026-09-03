import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";

function getAuthToken(request: NextRequest): string | null {
  return request.cookies.get("auth_token")?.value || null;
}

function getAuthHeaders(token: string | null): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

type RouteContext = {
  params: Promise<{ triggerId: string }>;
};

export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { triggerId } = await context.params;
    const response = await serverAPIClient.put(
      `/message-trigger-rules/${triggerId}/branch-activation`,
      body,
      { headers: getAuthHeaders(token) },
    );
    return NextResponse.json(response.data);
  } catch (error) {
    console.error("[API] Error updating message trigger rule branch activation:", error);
    return NextResponse.json(
      { error: "Failed to update message trigger rule branch activation" },
      { status: 500 },
    );
  }
}
