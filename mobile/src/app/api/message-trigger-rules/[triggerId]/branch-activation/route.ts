import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { serverAPIClient } from "@/lib/api/server";
import {
  backendJsonResponse,
  errorResponse,
  getAuthHeaders,
  getAuthToken,
  parseBody,
  unauthorizedResponse,
} from "@/lib/api/route-utils";

const branchActivationSchema = z.object({
  isActive: z.boolean(),
});

type RouteContext = {
  params: Promise<{ triggerId: string }>;
};

function isValidTriggerId(triggerId: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(triggerId);
}

export async function PUT(request: NextRequest, context: RouteContext) {
  const token = getAuthToken(request);
  if (!token) {
    return unauthorizedResponse("Unauthorized");
  }

  const { triggerId } = await context.params;
  if (!isValidTriggerId(triggerId)) {
    return NextResponse.json({ error: "Invalid trigger id" }, { status: 400 });
  }

  const { data, response: invalid } = await parseBody(branchActivationSchema, request);
  if (invalid) {
    return invalid;
  }

  try {
    const response = await serverAPIClient.put(
      `/message-trigger-rules/${encodeURIComponent(triggerId)}/branch-activation`,
      data,
      { headers: getAuthHeaders(token) },
    );
    return backendJsonResponse(response);
  } catch (error) {
    return errorResponse(error, "update message trigger branch activation");
  }
}
