import { NextRequest } from "next/server";

import {
  backendJsonResponse,
  errorResponse,
  getAuthHeaders,
  getAuthToken,
  unauthorizedResponse,
} from "@/lib/api/route-utils";
import { serverAPIClient } from "@/lib/api/server";

const ENDPOINT = "/settings/contract-automation-policies";

export async function GET(request: NextRequest) {
  const token = getAuthToken(request);
  if (!token) return unauthorizedResponse("Unauthorized");

  try {
    return backendJsonResponse(await serverAPIClient.get(ENDPOINT, { headers: getAuthHeaders(token) }));
  } catch (error) {
    return errorResponse(error, "contract automation policies fetch");
  }
}
