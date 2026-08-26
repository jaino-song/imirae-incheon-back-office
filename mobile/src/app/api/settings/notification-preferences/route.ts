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

const ENDPOINT = "/settings/notification-preferences";
const notificationPreferencesSchema = z.object({
  emailNotificationsEnabled: z.boolean(),
}).strict();

export async function GET(request: NextRequest) {
  const token = getAuthToken(request);
  if (!token) return unauthorizedResponse("Unauthorized");

  try {
    return backendJsonResponse(
      await serverAPIClient.get(ENDPOINT, { headers: getAuthHeaders(token) }),
    );
  } catch (error) {
    return errorResponse(error, "notification preferences fetch");
  }
}

export async function PUT(request: NextRequest) {
  const token = getAuthToken(request);
  if (!token) return unauthorizedResponse("Unauthorized");

  const { data, response: invalid } = await parseBody(
    notificationPreferencesSchema,
    request,
  );
  if (invalid) return invalid;

  try {
    return backendJsonResponse(
      await serverAPIClient.put(ENDPOINT, data, { headers: getAuthHeaders(token) }),
    );
  } catch (error) {
    return errorResponse(error, "notification preferences update");
  }
}
