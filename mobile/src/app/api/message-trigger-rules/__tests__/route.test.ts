/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import {
  DELETE as deleteRule,
  GET as getRule,
  PATCH as updateRule,
} from "../[triggerId]/route";
import { GET as listRules, POST as createRule } from "../route";

jest.mock("@/lib/api/server", () => ({
  serverAPIClient: {
    delete: jest.fn(),
    get: jest.fn(),
  patch: jest.fn(),
    put: jest.fn(),
    post: jest.fn(),
  },
}));

const mockDelete = serverAPIClient.delete as jest.Mock;
const mockGet = serverAPIClient.get as jest.Mock;
const mockPatch = serverAPIClient.patch as jest.Mock;
const mockPut = serverAPIClient.put as jest.Mock;
const mockPost = serverAPIClient.post as jest.Mock;

function createRequest(path: string, init: { method?: string; body?: BodyInit; headers?: Record<string, string> } = {}): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method: init.method,
    headers: {
      cookie: "auth_token=auth-token",
      ...init.headers,
    },
    body: init.body,
  });
}

describe("Message trigger rule API routes", () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    mockDelete.mockReset();
    mockGet.mockReset();
    mockPatch.mockReset();
    mockPut.mockReset();
    mockPost.mockReset();
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  describe("auth rejection", () => {
    const noAuth = { headers: { cookie: "" } };
    const ctx = { params: Promise.resolve({ triggerId: "rule_123" }) };

    it("rejects rule GET without an auth cookie before proxying", async () => {
      const response = await getRule(createRequest("/api/message-trigger-rules/rule_123", noAuth), ctx);
      expect(response.status).toBe(401);
      expect(mockGet).not.toHaveBeenCalled();
    });

    it("rejects rule PATCH without an auth cookie before proxying", async () => {
      const response = await updateRule(
        createRequest("/api/message-trigger-rules/rule_123", { method: "PATCH", headers: { cookie: "" } }),
        ctx,
      );
      expect(response.status).toBe(401);
      expect(mockPatch).not.toHaveBeenCalled();
    });

    it("rejects rule DELETE without an auth cookie before proxying", async () => {
      const response = await deleteRule(
        createRequest("/api/message-trigger-rules/rule_123", { method: "DELETE", headers: { cookie: "" } }),
        ctx,
      );
      expect(response.status).toBe(401);
      expect(mockDelete).not.toHaveBeenCalled();
    });
  });

  it("preserves backend error status and sanitizes payload when listing rules", async () => {
    mockGet.mockRejectedValue({
      response: {
        status: 403,
        data: { error: "trigger access denied" },
      },
    });

    const response = await listRules(createRequest("/api/message-trigger-rules"));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Failed to fetch message trigger rules" });
  });

  const validRulePayload = {
    name: "Reminder",
    eventType: "SERVICE_START",
    offsetType: "BEFORE_DAYS",
    recipientType: "CLIENT",
    templateKey: "SERVICE_START_REMINDER",
  };

  it("forwards the validated payload to the backend when creating rules", async () => {
    mockPost.mockResolvedValue({
      status: 202,
      data: { queued: true },
    });

    const response = await createRule(
      createRequest("/api/message-trigger-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...validRulePayload, offsetDays: 3 }),
      }),
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ queued: true });
    expect(mockPost).toHaveBeenCalledWith(
      "/message-trigger-rules",
      { ...validRulePayload, offsetDays: 3 },
      expect.anything(),
    );
  });

  it("rejects a create body missing required fields before proxying", async () => {
    const response = await createRule(
      createRequest("/api/message-trigger-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Reminder" }),
      }),
    );

    expect(response.status).toBe(400);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("forwards branch activation updates to the dedicated backend endpoint", async () => {
    mockPut.mockResolvedValue({
      status: 200,
      data: { id: "rule_123", isActive: false },
    });

    const { PUT: updateBranchActivation } = await import("../[triggerId]/branch-activation/route");
    const response = await updateBranchActivation(
      createRequest("/api/message-trigger-rules/rule_123/branch-activation", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: false }),
      }),
      { params: Promise.resolve({ triggerId: "rule_123" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ id: "rule_123", isActive: false });
    expect(mockPut).toHaveBeenCalledWith(
      "/message-trigger-rules/rule_123/branch-activation",
      { isActive: false },
      expect.anything(),
    );
  });

  it("rejects malformed create JSON before proxying", async () => {
    const response = await createRule(
      createRequest("/api/message-trigger-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{bad-json",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Request body must be valid JSON",
    });
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("rejects unsafe trigger IDs before proxying", async () => {
    const response = await getRule(
      createRequest("/api/message-trigger-rules/bad%2Fid"),
      { params: Promise.resolve({ triggerId: "bad%2Fid" }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid trigger id" });
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("forwards a validated partial update to the backend path", async () => {
    mockPatch.mockResolvedValue({
      status: 200,
      data: { id: "rule_123", isActive: false },
    });

    const response = await updateRule(
      createRequest("/api/message-trigger-rules/rule_123", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: false }),
      }),
      { params: Promise.resolve({ triggerId: "rule_123" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ id: "rule_123", isActive: false });
    expect(mockPatch).toHaveBeenCalledWith(
      "/message-trigger-rules/rule_123",
      { isActive: false },
      expect.anything(),
    );
  });

  it("rejects an update body with a mistyped field before proxying", async () => {
    const response = await updateRule(
      createRequest("/api/message-trigger-rules/rule_123", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: 123 }),
      }),
      { params: Promise.resolve({ triggerId: "rule_123" }) },
    );

    expect(response.status).toBe(400);
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it("rejects malformed update JSON before proxying", async () => {
    const response = await updateRule(
      createRequest("/api/message-trigger-rules/rule_123", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: "{bad-json",
      }),
      { params: Promise.resolve({ triggerId: "rule_123" }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Request body must be valid JSON",
    });
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it("preserves backend delete status and payload", async () => {
    mockDelete.mockResolvedValue({
      status: 202,
      data: { queued: true },
    });

    const response = await deleteRule(
      createRequest("/api/message-trigger-rules/rule_123", { method: "DELETE" }),
      { params: Promise.resolve({ triggerId: "rule_123" }) },
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ queued: true });
  });
});
