/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import { POST as sendSms } from "../sms/route";

jest.mock("@/lib/api/server", () => ({
  serverAPIClient: {
    post: jest.fn(),
  },
}));

const mockPost = serverAPIClient.post as jest.Mock;

function createRequest(body: BodyInit): NextRequest {
  return new NextRequest("http://localhost/api/message-deliveries/sms", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      cookie: "auth_token=auth-token",
    },
    body,
  });
}

describe("SMS delivery API route", () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    mockPost.mockReset();
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  const validSmsPayload = {
    receiver: "010-1234-5678",
    message: "hello",
  };

  it("rejects an SMS request without an auth cookie before proxying", async () => {
    const request = new NextRequest("http://localhost/api/message-deliveries/sms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validSmsPayload),
    });

    const response = await sendSms(request);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON before proxying", async () => {
    const response = await sendSms(createRequest("{bad-json"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Request body must be valid JSON",
    });
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("rejects an SMS body missing the required receiver before proxying", async () => {
    const response = await sendSms(createRequest(JSON.stringify({ message: "hello" })));

    expect(response.status).toBe(400);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("forwards the validated payload to the backend", async () => {
    mockPost.mockResolvedValue({
      status: 202,
      data: { queued: true },
    });

    const response = await sendSms(createRequest(JSON.stringify(validSmsPayload)));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ queued: true });
    expect(mockPost).toHaveBeenCalledWith(
      "/message-deliveries/sms",
      validSmsPayload,
      expect.anything(),
    );
  });

  it("forwards an explicit null clientId without converting it to a lookup value", async () => {
    mockPost.mockResolvedValue({
      status: 202,
      data: { queued: true },
    });
    const payload = {
      ...validSmsPayload,
      clientId: null,
    };

    const response = await sendSms(createRequest(JSON.stringify(payload)));

    expect(response.status).toBe(202);
    expect(mockPost).toHaveBeenCalledWith(
      "/message-deliveries/sms",
      payload,
      expect.anything(),
    );
  });

  it("does not return or log raw upstream SMS error payloads", async () => {
    mockPost.mockRejectedValue({
      response: {
        status: 502,
        data: {
          error: "provider trace /tmp/sms-worker",
          code: "SMS_PROVIDER_ERROR",
          diagnostics: { host: "sms.internal" },
        },
      },
      code: "ERR_BAD_RESPONSE",
      name: "AxiosError",
    });

    const response = await sendSms(createRequest(JSON.stringify(validSmsPayload)));

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "Failed to send SMS",
      code: "SMS_PROVIDER_ERROR",
    });

    const logged = consoleErrorSpy.mock.calls
      .flat()
      .map((entry) => (typeof entry === "string" ? entry : JSON.stringify(entry)))
      .join(" ");
    expect(logged).not.toContain("/tmp/sms-worker");
    expect(logged).not.toContain("sms.internal");
  });
});
