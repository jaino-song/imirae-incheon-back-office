import { NextRequest, NextResponse } from "next/server";

import {
  errorResponse,
  getAuthHeaders,
  getAuthToken,
  unauthorizedResponse,
} from "@/lib/api/route-utils";
import { serverAPIClient } from "@/lib/api/server";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const token = getAuthToken(request);

  if (!token) {
    return unauthorizedResponse("Authentication required. Please log in.");
  }

  const { id } = await context.params;

  try {
    const body = await request.json().catch(() => ({}));
    const response = await serverAPIClient.patch(
      `/users/${encodeURIComponent(id)}/account-assignment`,
      body,
      { headers: getAuthHeaders(token) },
    );

    return NextResponse.json(response.data, { status: response.status });
  } catch (error) {
    return errorResponse(error, "update user account assignment");
  }
}
