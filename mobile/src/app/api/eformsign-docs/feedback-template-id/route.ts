import { NextRequest, NextResponse } from "next/server";

import { errorResponse, getAuthHeaders, getAuthToken } from "@/lib/api/route-utils";
import { serverAPIClient } from "@/lib/api/server";

export async function GET(request: NextRequest) {
  const authToken = getAuthToken(request);

  if (!authToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const response = await serverAPIClient.get("/eformsign-docs/feedback-template-id", {
      headers: getAuthHeaders(authToken),
    });

    if (response.status >= 400) {
      const errorMessage =
        response.data?.error ??
        response.data?.message ??
        `Backend returned ${response.status}`;
      return NextResponse.json({ error: errorMessage }, { status: response.status });
    }

    return NextResponse.json(response.data);
  } catch (error) {
    return errorResponse(error, "get service record template id");
  }
}
