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

const ENDPOINT = "/settings/contract-automation-policies/auto-finalize";
const autoFinalizeConfigSchema = z.object({
  enabled: z.boolean(),
  graceDays: z.number().int().min(0).max(30),
  maxAttempts: z.number().int().min(1).max(10),
});

export async function PUT(request: NextRequest) {
  const token = getAuthToken(request);
  if (!token) return unauthorizedResponse("Unauthorized");

  const { data, response: invalid } = await parseBody(autoFinalizeConfigSchema, request);
  if (invalid) return invalid;

  try {
    return backendJsonResponse(await serverAPIClient.put(ENDPOINT, data, { headers: getAuthHeaders(token) }));
  } catch (error) {
    return errorResponse(error, "contract automation auto-finalize config update");
  }
}
