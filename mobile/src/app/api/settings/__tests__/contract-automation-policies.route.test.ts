/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import { GET as getContractAutomationPolicies } from "../contract-automation-policies/route";
import { PUT as updateContractAutoFinalizeConfig } from "../contract-automation-policies/auto-finalize/route";

jest.mock("@/lib/api/server", () => ({
  serverAPIClient: {
    get: jest.fn(),
    put: jest.fn(),
  },
}));

const mockGet = serverAPIClient.get as jest.Mock;
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

function noCookieRequest(path: string, method = "GET"): NextRequest {
  return new NextRequest(`http://localhost${path}`, { method });
}

describe("contract automation policies API routes", () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    mockGet.mockReset();
    mockPut.mockReset();
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("requires auth before fetching contract automation policies", async () => {
    const response = await getContractAutomationPolicies(noCookieRequest("/api/settings/contract-automation-policies"));
    expect(response.status).toBe(401);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("proxies contract automation policies to the backend", async () => {
    const payload = { autoFinalize: { enabled: true, graceDays: 0, maxAttempts: 3 } };
    mockGet.mockResolvedValue({ status: 200, data: payload });

    const response = await getContractAutomationPolicies(createRequest("/api/settings/contract-automation-policies"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(payload);
    expect(mockGet).toHaveBeenCalledWith(
      "/settings/contract-automation-policies",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer auth-token" }) }),
    );
  });

  it("requires auth before updating the auto-finalize config", async () => {
    const response = await updateContractAutoFinalizeConfig(
      noCookieRequest("/api/settings/contract-automation-policies/auto-finalize", "PUT"),
    );
    expect(response.status).toBe(401);
    expect(mockPut).not.toHaveBeenCalled();
  });

  it("rejects an out-of-range auto-finalize config before proxying", async () => {
    const response = await updateContractAutoFinalizeConfig(
      createRequest("/api/settings/contract-automation-policies/auto-finalize", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: true, graceDays: 31, maxAttempts: 3 }),
      }),
    );

    expect(response.status).toBe(400);
    expect(mockPut).not.toHaveBeenCalled();
  });

  it("proxies a valid auto-finalize config update to the backend", async () => {
    const config = { enabled: false, graceDays: 7, maxAttempts: 5 };
    mockPut.mockResolvedValue({ status: 200, data: config });

    const response = await updateContractAutoFinalizeConfig(
      createRequest("/api/settings/contract-automation-policies/auto-finalize", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(config);
    expect(mockPut).toHaveBeenCalledWith(
      "/settings/contract-automation-policies/auto-finalize",
      config,
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer auth-token" }) }),
    );
  });
});
