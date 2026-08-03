import { NextRequest } from "next/server";
import { z } from "zod";

import {
  backendJsonResponse,
  errorResponse,
  getAuthHeaders,
  getAuthToken,
  parseBody,
  unauthorizedResponse,
} from "@/lib/api/route-utils";
import { serverAPIClient } from "@/lib/api/server";

const ENDPOINT = "/settings/message-automation-policies/past-trigger";
const pastTriggerConfigSchema = z.object({
  sendIntervalMinutes: z.number().int().min(1).max(1440),
  ruleOrder: z.array(z.string()),
});

export async function PUT(request: NextRequest) {
  const token = getAuthToken(request);
  if (!token) return unauthorizedResponse("Unauthorized");

  const { data, response: invalid } = await parseBody(pastTriggerConfigSchema, request);
  if (invalid) return invalid;

  try {
    return backendJsonResponse(await serverAPIClient.put(ENDPOINT, data, { headers: getAuthHeaders(token) }));
  } catch (error) {
    return errorResponse(error, "message automation past trigger config update");
  }
}
