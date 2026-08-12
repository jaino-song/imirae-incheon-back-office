/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";

import { POST } from "../route";

jest.mock("@/lib/api/server", () => ({
  serverAPIClient: {
    post: jest.fn(),
  },
}));

const mockPost = serverAPIClient.post as jest.Mock;

function createRequest(id: string, authenticated = true): NextRequest {
  return new NextRequest(`http://localhost/api/message-trigger-jobs/${id}/cancel`, {
    method: "POST",
    headers: authenticated ? { cookie: "auth_token=auth-token" } : {},
  });
}

describe("POST /api/message-trigger-jobs/[id]/cancel", () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    mockPost.mockReset();
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("requires authentication before proxying", async () => {
    const response = await POST(createRequest("job-1", false), {
      params: Promise.resolve({ id: "job-1" }),
    });

    expect(response.status).toBe(401);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("rejects an id the validator refuses before proxying", async () => {
    // Manual-scheduled rows synthesize ids like "log:41" (see backend
    // MessageTriggerService.listManualScheduledSmsLogs) — the colon fails
    // isValidJobId's [A-Za-z0-9_-] charset. That is exactly why those rows
    // must never reach this endpoint (see the mobile isCancelable fix in
    // MessagesDataPages.tsx, which now excludes them from the cancel action).
    const response = await POST(createRequest("log:41"), {
      params: Promise.resolve({ id: "log:41" }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid message trigger job id" });
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("forwards an authenticated cancel request for a valid job id", async () => {
    mockPost.mockResolvedValue({
      status: 200,
      data: { id: "job-1", status: "canceled" },
    });

    const response = await POST(createRequest("job-1"), {
      params: Promise.resolve({ id: "job-1" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ id: "job-1", status: "canceled" });
    expect(mockPost).toHaveBeenCalledWith(
      "/message-trigger-jobs/job-1/cancel",
      {},
      { headers: { Authorization: "Bearer auth-token" } },
    );
  });

  it("preserves a backend conflict response for a job that is no longer pending", async () => {
    mockPost.mockRejectedValue({
      response: {
        status: 409,
        data: { message: "이미 발송되었거나 취소할 수 없는 상태입니다." },
      },
    });

    const response = await POST(createRequest("job-1"), {
      params: Promise.resolve({ id: "job-1" }),
    });

    expect(response.status).toBe(409);
    // errorResponse sanitizes upstream error bodies (packages/shared/src/api/route-utils.ts) —
    // only a whitelisted `code`/`hasKakaoAccount` survive, so the upstream message text is
    // replaced with the route's own fallback rather than passed through.
    await expect(response.json()).resolves.toEqual({ error: "Failed to cancel message trigger job" });
  });
});
