/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import {
  GET as getMessageSenderApproval,
  POST as requestMessageSenderApproval,
} from "../message-sender-approval/route";
import { GET as getMessageAutomationPolicies } from "../message-automation-policies/route";
import { PUT as updateMessageAutomationPastTriggerConfig } from "../message-automation-policies/past-trigger/route";
import {
  GET as getNotificationPreferences,
  PUT as updateNotificationPreferences,
} from "../notification-preferences/route";
import {
  GET as getClientRegistrationPolicy,
  PUT as updateClientRegistrationPolicy,
} from "../client-registration-policy/route";

jest.mock("@/lib/api/server", () => ({
  serverAPIClient: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
  },
}));

const mockGet = serverAPIClient.get as jest.Mock;
const mockPost = serverAPIClient.post as jest.Mock;
const mockPut = serverAPIClient.put as jest.Mock;

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

describe("settings API routes", () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset();
    mockPut.mockReset();
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  function noCookieRequest(path: string, method = "GET"): NextRequest {
    return new NextRequest(`http://localhost${path}`, { method });
  }

  it("requires auth before fetching message sender approval status", async () => {
    const response = await getMessageSenderApproval(noCookieRequest("/api/settings/message-sender-approval"));
    expect(response.status).toBe(401);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("requires auth before requesting message sender approval", async () => {
    const response = await requestMessageSenderApproval(noCookieRequest("/api/settings/message-sender-approval", "POST"));
    expect(response.status).toBe(401);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("rejects malformed message sender approval JSON before proxying", async () => {
    const response = await requestMessageSenderApproval(
      createRequest("/api/settings/message-sender-approval", {
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

  it("forwards an empty message sender approval request body before proxying", async () => {
    mockPost.mockResolvedValue({ status: 200, data: { approvalStatus: "pending" } });

    const response = await requestMessageSenderApproval(
      createRequest("/api/settings/message-sender-approval", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
    );

    expect(response.status).toBe(200);
    expect(mockPost).toHaveBeenCalledWith(
      "/settings/message-sender-approval/request",
      {},
      { headers: { Authorization: "Bearer auth-token" } },
    );
  });

  it("forwards validated message sender approval request to the backend", async () => {
    mockPost.mockResolvedValue({ status: 200, data: { approvalStatus: "pending" } });

    const approvalBody = { senderPhone: "01012345678" };

    const response = await requestMessageSenderApproval(
      createRequest("/api/settings/message-sender-approval", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(approvalBody),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ approvalStatus: "pending" });
    expect(mockPost).toHaveBeenCalledWith(
      "/settings/message-sender-approval/request",
      approvalBody,
      { headers: { Authorization: "Bearer auth-token" } },
    );
  });

  it("requires auth before fetching message automation policies", async () => {
    const response = await getMessageAutomationPolicies(
      noCookieRequest("/api/settings/message-automation-policies"),
    );

    expect(response.status).toBe(401);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("proxies message automation policy reads", async () => {
    const payload = {
      policies: [
        {
          id: "service-start",
          title: "Service start",
          description: "Sends when service starts",
          active: true,
          requiresApproval: false,
          rows: [],
        },
      ],
      pastTriggerConfig: {
        sendIntervalMinutes: 30,
        ruleOrder: ["service-start"],
      },
    };
    mockGet.mockResolvedValue({ status: 200, data: payload });

    const response = await getMessageAutomationPolicies(
      createRequest("/api/settings/message-automation-policies"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(payload);
    expect(mockGet).toHaveBeenCalledWith(
      "/settings/message-automation-policies",
      { headers: { Authorization: "Bearer auth-token" } },
    );
  });

  it("requires auth before updating message automation past-trigger config", async () => {
    const response = await updateMessageAutomationPastTriggerConfig(
      noCookieRequest(
        "/api/settings/message-automation-policies/past-trigger",
        "PUT",
      ),
    );

    expect(response.status).toBe(401);
    expect(mockPut).not.toHaveBeenCalled();
  });

  it("proxies validated message automation past-trigger config updates", async () => {
    const config = {
      sendIntervalMinutes: 30,
      ruleOrder: ["service-start", "service-end"],
    };
    mockPut.mockResolvedValue({ status: 200, data: config });

    const response = await updateMessageAutomationPastTriggerConfig(
      createRequest("/api/settings/message-automation-policies/past-trigger", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(config);
    expect(mockPut).toHaveBeenCalledWith(
      "/settings/message-automation-policies/past-trigger",
      config,
      { headers: { Authorization: "Bearer auth-token" } },
    );
  });

  it.each([
    ["sendIntervalMinutes below the minimum", { sendIntervalMinutes: 0, ruleOrder: [] }],
    ["sendIntervalMinutes above the maximum", { sendIntervalMinutes: 1441, ruleOrder: [] }],
    ["non-array ruleOrder", { sendIntervalMinutes: 30, ruleOrder: "service-start" }],
  ])("rejects %s before proxying", async (_caseName, body) => {
    const response = await updateMessageAutomationPastTriggerConfig(
      createRequest("/api/settings/message-automation-policies/past-trigger", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    );

    expect(response.status).toBe(400);
    const responseBody = await response.json();
    expect(responseBody.error).toBe("Invalid request body");
    expect(Array.isArray(responseBody.issues)).toBe(true);
    expect(mockPut).not.toHaveBeenCalled();
  });

  it("requires auth before fetching notification preferences", async () => {
    const response = await getNotificationPreferences(
      noCookieRequest("/api/settings/notification-preferences"),
    );

    expect(response.status).toBe(401);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("proxies notification preference reads", async () => {
    const preferences = { emailNotificationsEnabled: false };
    mockGet.mockResolvedValue({ status: 200, data: preferences });

    const response = await getNotificationPreferences(
      createRequest("/api/settings/notification-preferences"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(preferences);
    expect(mockGet).toHaveBeenCalledWith(
      "/settings/notification-preferences",
      { headers: { Authorization: "Bearer auth-token" } },
    );
  });

  it("requires auth before updating notification preferences", async () => {
    const response = await updateNotificationPreferences(
      noCookieRequest("/api/settings/notification-preferences", "PUT"),
    );

    expect(response.status).toBe(401);
    expect(mockPut).not.toHaveBeenCalled();
  });

  it.each([
    ["missing the boolean", {}],
    ["using a string boolean", { emailNotificationsEnabled: "false" }],
    ["using an unknown field", { emailNotificationsEnabled: true, unexpected: true }],
  ])("rejects notification preference updates %s before proxying", async (_caseName, body) => {
    const response = await updateNotificationPreferences(
      createRequest("/api/settings/notification-preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    );

    expect(response.status).toBe(400);
    const responseBody = await response.json();
    expect(responseBody.error).toBe("Invalid request body");
    expect(mockPut).not.toHaveBeenCalled();
  });

  it("proxies a validated notification preference update", async () => {
    const preferences = { emailNotificationsEnabled: false };
    mockPut.mockResolvedValue({ status: 200, data: preferences });

    const response = await updateNotificationPreferences(
      createRequest("/api/settings/notification-preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(preferences),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(preferences);
    expect(mockPut).toHaveBeenCalledWith(
      "/settings/notification-preferences",
      preferences,
      { headers: { Authorization: "Bearer auth-token" } },
    );
  });

  it("proxies client registration policy reads and partial updates", async () => {
    const policy = { clientAutoRegistration: true, greetingOnAutoRegistration: false };
    mockGet.mockResolvedValue({ status: 200, data: policy });
    mockPut.mockResolvedValue({ status: 200, data: { ...policy, greetingOnAutoRegistration: true } });

    expect((await getClientRegistrationPolicy(createRequest("/api/settings/client-registration-policy"))).status).toBe(200);
    const response = await updateClientRegistrationPolicy(createRequest("/api/settings/client-registration-policy", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ greetingOnAutoRegistration: true }),
    }));

    expect(response.status).toBe(200);
    expect(mockPut).toHaveBeenCalledWith(
      "/settings/client-registration-policy",
      { greetingOnAutoRegistration: true },
      { headers: { Authorization: "Bearer auth-token" } },
    );
  });
});
