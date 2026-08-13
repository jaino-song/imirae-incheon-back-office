/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import { POST as createEformsignDoc } from "../route";
import { POST as dispatchHeadless } from "../dispatch-headless/route";
import { POST as adoptDocument } from "../adopt/route";
import { POST as finalizeHeadless } from "../finalize-headless/route";
import { GET as getClientNames } from "../client-names/route";

jest.mock("@/lib/api/server", () => ({
  serverAPIClient: {
    get: jest.fn(),
    post: jest.fn(),
  },
}));

const mockGet = serverAPIClient.get as jest.Mock;
const mockPost = serverAPIClient.post as jest.Mock;

function createRequest(path: string, body: BodyInit): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      cookie: "auth_token=auth-token",
    },
    body,
  });
}

describe("eformsign-docs command API routes", () => {
  beforeEach(() => {
    mockPost.mockReset();
  });

  const validCreateBody = {
    documentId: "doc-1",
    clientId: 7,
    statusType: "on_progress",
    statusDetail: "step_1",
    stepType: "sign",
    stepIndex: "0",
    stepName: "고객 서명",
    stepRecipientType: "outsider",
    stepRecipientName: "홍길동",
    stepRecipientSms: "01000000000",
    expiredDate: "2026-12-31T00:00:00.000Z",
  };

  it("rejects create payloads missing required fields before proxying", async () => {
    const response = await createEformsignDoc(
      createRequest("/api/eformsign-docs", JSON.stringify({ documentId: "doc-1" })),
    );

    expect(response.status).toBe(400);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("rejects create payloads with wrong field types before proxying", async () => {
    const response = await createEformsignDoc(
      createRequest(
        "/api/eformsign-docs",
        JSON.stringify({ ...validCreateBody, clientId: "not-a-number" }),
      ),
    );

    expect(response.status).toBe(400);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("forwards validated create payload and preserves backend status", async () => {
    mockPost.mockResolvedValue({
      status: 202,
      data: { queued: true },
    });

    const response = await createEformsignDoc(
      createRequest("/api/eformsign-docs", JSON.stringify(validCreateBody)),
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ queued: true });
    expect(mockPost).toHaveBeenCalledWith(
      "/eformsign-docs",
      validCreateBody,
      { headers: { Authorization: "Bearer auth-token" } },
    );
  });

  it("rejects dispatch payloads missing contractData before proxying", async () => {
    const response = await dispatchHeadless(
      createRequest("/api/eformsign-docs/dispatch-headless", JSON.stringify({ clientId: 7 })),
    );

    expect(response.status).toBe(400);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("rejects dispatch payloads missing clientId before proxying", async () => {
    const response = await dispatchHeadless(
      createRequest(
        "/api/eformsign-docs/dispatch-headless",
        JSON.stringify({ contractData: { customerName: "홍길동" } }),
      ),
    );

    expect(response.status).toBe(400);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("forwards validated dispatch payload to the backend", async () => {
    mockPost.mockResolvedValue({ status: 200, data: { ok: true } });

    const dispatchBody = {
      contractData: { customerName: "홍길동" },
      clientId: 7,
      progressId: "p-1",
    };

    const response = await dispatchHeadless(
      createRequest("/api/eformsign-docs/dispatch-headless", JSON.stringify(dispatchBody)),
    );

    expect(response.status).toBe(200);
    expect(mockPost).toHaveBeenCalledWith(
      "/eformsign-docs/dispatch-headless",
      dispatchBody,
      expect.objectContaining({ headers: { Authorization: "Bearer auth-token" } }),
    );
  });

  it("forwards force dispatch and adopt compensation payloads", async () => {
    mockPost.mockResolvedValue({ status: 200, data: { ok: true } });
    const forcedBody = { contractData: { customerName: "홍길동" }, clientId: 7, force: true };

    await dispatchHeadless(createRequest("/api/eformsign-docs/dispatch-headless", JSON.stringify(forcedBody)));
    await adoptDocument(createRequest("/api/eformsign-docs/adopt", JSON.stringify({ documentId: "doc-1", clientId: 7 })));

    expect(mockPost).toHaveBeenNthCalledWith(
      1,
      "/eformsign-docs/dispatch-headless",
      forcedBody,
      expect.objectContaining({ headers: { Authorization: "Bearer auth-token" } }),
    );
    expect(mockPost).toHaveBeenNthCalledWith(
      2,
      "/eformsign-docs/adopt",
      { documentId: "doc-1", clientId: 7 },
      { headers: { Authorization: "Bearer auth-token" } },
    );
  });

  it("rejects finalize payloads missing documentId before proxying", async () => {
    const response = await finalizeHeadless(
      createRequest("/api/eformsign-docs/finalize-headless", JSON.stringify({ progressId: "p-1" })),
    );

    expect(response.status).toBe(400);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("forwards validated finalize payload to the backend", async () => {
    mockPost.mockResolvedValue({ status: 200, data: { ok: true } });

    const finalizeBody = { documentId: "doc-1", prefillEndDate: "2026-12-31" };

    const response = await finalizeHeadless(
      createRequest("/api/eformsign-docs/finalize-headless", JSON.stringify(finalizeBody)),
    );

    expect(response.status).toBe(200);
    expect(mockPost).toHaveBeenCalledWith(
      "/eformsign-docs/finalize-headless",
      finalizeBody,
      {
        headers: { Authorization: "Bearer auth-token" },
        timeout: 170_000,
      },
    );
  });

  it("rejects malformed dispatch JSON before proxying", async () => {
    const response = await dispatchHeadless(
      createRequest("/api/eformsign-docs/dispatch-headless", "{bad-json"),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Request body must be valid JSON",
    });
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("preserves backend status and payload when finalizing headless documents", async () => {
    mockPost.mockResolvedValue({
      status: 409,
      data: { error: "already finalized" },
    });

    const response = await finalizeHeadless(
      createRequest("/api/eformsign-docs/finalize-headless", JSON.stringify({ documentId: "doc-1" })),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "already finalized" });
  });

  describe("auth rejection", () => {
    function noAuthRequest(path: string, method = "POST"): NextRequest {
      return new NextRequest(`http://localhost${path}`, { method });
    }

    it("rejects create without auth_token", async () => {
      const response = await createEformsignDoc(noAuthRequest("/api/eformsign-docs"));
      expect(response.status).toBe(401);
      expect(mockPost).not.toHaveBeenCalled();
    });

    it("rejects dispatch without auth_token", async () => {
      const response = await dispatchHeadless(noAuthRequest("/api/eformsign-docs/dispatch-headless"));
      expect(response.status).toBe(401);
      expect(mockPost).not.toHaveBeenCalled();
    });

    it("rejects finalize without auth_token", async () => {
      const response = await finalizeHeadless(noAuthRequest("/api/eformsign-docs/finalize-headless"));
      expect(response.status).toBe(401);
      expect(mockPost).not.toHaveBeenCalled();
    });

    it("rejects client-names without auth_token", async () => {
      const response = await getClientNames(noAuthRequest("/api/eformsign-docs/client-names", "GET"));
      expect(response.status).toBe(401);
      expect(mockGet).not.toHaveBeenCalled();
    });
  });
});
