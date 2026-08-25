/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import { GET as getCapabilities } from "../capabilities/route";
import { GET as downloadFile, HEAD as headFile } from "../files/[fileId]/download/route";
import {
  DELETE as deleteFile,
  GET as getFile,
  PUT as updateFile,
} from "../files/[fileId]/route";
import { GET as listFiles, POST as uploadFile } from "../files/route";

jest.mock("@/lib/api/server", () => ({
  serverAPIClient: {
    delete: jest.fn(),
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
  },
}));

const mockDelete = serverAPIClient.delete as jest.Mock;
const mockGet = serverAPIClient.get as jest.Mock;
const mockPost = serverAPIClient.post as jest.Mock;
const mockPut = serverAPIClient.put as jest.Mock;

function createJsonRequest(path: string, method: string, body: BodyInit): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      cookie: "auth_token=auth-token",
    },
    body,
  });
}

function createGetRequest(path: string): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    headers: { cookie: "auth_token=auth-token" },
  });
}

function createUploadRequest(extraFields: Record<string, string | File> = {}): NextRequest {
  const formData = new FormData();
  formData.append("file", new File(["contents"], "document.txt", { type: "text/plain" }));
  formData.append("name", "Document");
  for (const [key, value] of Object.entries(extraFields)) {
    formData.set(key, value);
  }

  return new NextRequest("http://localhost/api/file-storage/files", {
    method: "POST",
    headers: { cookie: "auth_token=auth-token" },
    body: formData,
  });
}

describe("file-storage API routes", () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    mockDelete.mockReset();
    mockGet.mockReset();
    mockPost.mockReset();
    mockPut.mockReset();
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("preserves backend error status and sanitizes payload when listing files", async () => {
    mockGet.mockRejectedValue({
      response: {
        status: 403,
        data: { error: "document access denied" },
      },
    });

    const response = await listFiles(createGetRequest("/api/file-storage/files"));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Failed to fetch documents" });
  });

  it("proxies the authenticated storage capability contract", async () => {
    mockGet.mockResolvedValue({
      status: 200,
      data: { maxFileSizeBytes: 25 * 1024 * 1024, multiple: false },
    });

    const response = await getCapabilities(createGetRequest("/api/file-storage/capabilities"));

    expect(response.status).toBe(200);
    expect(mockGet).toHaveBeenCalledWith("/documents/capabilities", expect.objectContaining({
      headers: expect.objectContaining({ Authorization: "Bearer auth-token" }),
    }));
  });

  it("preserves backend status and payload when uploading files", async () => {
    mockPost.mockResolvedValue({
      status: 202,
      data: { queued: true },
    });

    const response = await uploadFile(createUploadRequest());

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ queued: true });
  });

  it("never forwards client-supplied identity fields on upload", async () => {
    mockPost.mockResolvedValue({ status: 201, data: { id: "doc-1" } });

    const response = await uploadFile(
      createUploadRequest({ orgId: "another-tenant", uploadedBy: "attacker" }),
    );

    expect(response.status).toBe(201);
    const forwardedFormData = mockPost.mock.calls[0][1] as FormData;
    expect(forwardedFormData.has("orgId")).toBe(false);
    expect(forwardedFormData.has("uploadedBy")).toBe(false);
    expect(forwardedFormData.get("name")).toBe("Document");
  });

  it("forwards a validated upload visibility scope to the backend", async () => {
    mockPost.mockResolvedValue({ status: 201, data: { id: "doc-1" } });

    const response = await uploadFile(
      createUploadRequest({ visibilityScope: "branch" }),
    );

    expect(response.status).toBe(201);
    const forwardedFormData = mockPost.mock.calls[0][1] as FormData;
    expect(forwardedFormData.get("visibilityScope")).toBe("branch");
  });

  it("rejects an invalid upload visibility scope before proxying", async () => {
    const response = await uploadFile(
      createUploadRequest({ visibilityScope: "everywhere" }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid upload metadata" });
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("sanitizes an upstream validation error body instead of passing it through", async () => {
    mockPost.mockRejectedValue({
      response: {
        status: 400,
        data: {
          statusCode: 400,
          message: ["property orgId should not exist"],
          error: "Bad Request",
        },
      },
    });

    const response = await uploadFile(createUploadRequest());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Failed to upload document" });
  });

  it("rejects non-string upload metadata before proxying", async () => {
    const response = await uploadFile(
      createUploadRequest({
        categoryId: new File(["x"], "sneaky.txt", { type: "text/plain" }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid upload metadata" });
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("rejects unsupported files before buffering or proxying", async () => {
    const response = await uploadFile(createUploadRequest({
      file: new File(["<html></html>"], "payload.html", { type: "text/html" }),
    }));

    expect(response.status).toBe(400);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("rejects a non-file form value without raising an internal error", async () => {
    const response = await uploadFile(createUploadRequest({ file: "not-a-file" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "File is required" });
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("rejects unsafe file detail IDs before proxying", async () => {
    const response = await getFile(
      createGetRequest("/api/file-storage/files/bad%2Fid"),
      { params: Promise.resolve({ fileId: "bad%2Fid" }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid file id" });
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("rejects unsafe update IDs before proxying", async () => {
    const response = await updateFile(
      createJsonRequest(
        "/api/file-storage/files/bad%2Fid",
        "PUT",
        JSON.stringify({ name: "Renamed" }),
      ),
      { params: Promise.resolve({ fileId: "bad%2Fid" }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid file id" });
    expect(mockPut).not.toHaveBeenCalled();
  });

  it("rejects unsafe delete IDs before proxying", async () => {
    const response = await deleteFile(
      createGetRequest("/api/file-storage/files/bad%2Fid"),
      { params: Promise.resolve({ fileId: "bad%2Fid" }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid file id" });
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("forwards a validated document update to the backend path", async () => {
    mockPut.mockResolvedValue({
      status: 200,
      data: { id: "file_123", name: "Renamed" },
    });

    const response = await updateFile(
      createJsonRequest(
        "/api/file-storage/files/file_123",
        "PUT",
        JSON.stringify({ name: "Renamed" }),
      ),
      { params: Promise.resolve({ fileId: "file_123" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ id: "file_123", name: "Renamed" });
    expect(mockPut).toHaveBeenCalledWith(
      "/documents/file_123",
      { name: "Renamed" },
      { headers: { Authorization: "Bearer auth-token" } },
    );
  });

  it("rejects an update body with a mistyped field before proxying", async () => {
    const response = await updateFile(
      createJsonRequest(
        "/api/file-storage/files/file_123",
        "PUT",
        JSON.stringify({ name: 123 }),
      ),
      { params: Promise.resolve({ fileId: "file_123" }) },
    );

    expect(response.status).toBe(400);
    expect(mockPut).not.toHaveBeenCalled();
  });

  it("rejects malformed update JSON before proxying", async () => {
    const response = await updateFile(
      createJsonRequest("/api/file-storage/files/file_123", "PUT", "{bad-json"),
      { params: Promise.resolve({ fileId: "file_123" }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Request body must be valid JSON",
    });
    expect(mockPut).not.toHaveBeenCalled();
  });

  it("preserves backend delete error status and sanitizes payload", async () => {
    mockDelete.mockRejectedValue({
      response: {
        status: 409,
        data: { error: "document is locked" },
      },
    });

    const response = await deleteFile(
      createGetRequest("/api/file-storage/files/file_123"),
      { params: Promise.resolve({ fileId: "file_123" }) },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "Failed to delete document" });
  });

  describe("download", () => {
    it("rejects unsafe download IDs before proxying", async () => {
      const response = await downloadFile(
        createGetRequest("/api/file-storage/files/bad%2Fid/download"),
        { params: Promise.resolve({ fileId: "bad%2Fid" }) },
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({ error: "Invalid file id" });
      expect(mockGet).not.toHaveBeenCalled();
    });

    it("passes upstream download headers through, including x-content-type-options", async () => {
      const body = new TextEncoder().encode("PDF!").buffer;
      mockGet.mockResolvedValue({
        status: 200,
        data: body,
        headers: {
          "content-type": "application/pdf",
          "content-disposition": 'attachment; filename="a.pdf"',
          "x-content-type-options": "nosniff",
          // Deliberately wrong: the proxy must size the body it actually
          // sends, not echo a stale upstream transfer header.
          "content-length": "999",
        },
      });

      const response = await downloadFile(
        createGetRequest("/api/file-storage/files/file_123/download"),
        { params: Promise.resolve({ fileId: "file_123" }) },
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("application/pdf");
      expect(response.headers.get("content-disposition")).toBe('attachment; filename="a.pdf"');
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("content-length")).toBe("4");
      expect(mockGet).toHaveBeenCalledWith("/documents/file_123/download", {
        headers: { Authorization: "Bearer auth-token" },
        responseType: "arraybuffer",
      });
      await expect(response.arrayBuffer()).resolves.toEqual(body);
    });

    it("propagates attachment=true to the upstream download URL", async () => {
      mockGet.mockResolvedValue({
        status: 200,
        data: new ArrayBuffer(1),
        headers: {},
      });

      await downloadFile(
        createGetRequest("/api/file-storage/files/file_123/download?attachment=true"),
        { params: Promise.resolve({ fileId: "file_123" }) },
      );

      expect(mockGet).toHaveBeenCalledWith(
        "/documents/file_123/download?attachment=true",
        expect.anything(),
      );
    });

    it("preserves non-404 upstream download error status and sanitizes the payload", async () => {
      mockGet.mockRejectedValue({
        response: {
          status: 403,
          data: { error: "branch mismatch for tenant t_999" },
        },
      });

      const response = await downloadFile(
        createGetRequest("/api/file-storage/files/file_123/download"),
        { params: Promise.resolve({ fileId: "file_123" }) },
      );

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({ error: "Failed to download document" });
    });

    it("sanitizes upstream download errors while keeping the 404 mapping", async () => {
      mockGet.mockRejectedValue({
        response: {
          status: 404,
          data: { message: "Document not found in bucket s3://internal" },
        },
      });

      const response = await downloadFile(
        createGetRequest("/api/file-storage/files/file_123/download"),
        { params: Promise.resolve({ fileId: "file_123" }) },
      );

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({ error: "Document not found" });
    });
  });

  describe("HEAD download preflight", () => {
    it("keeps the HEAD metadata preflight working without fetching the body", async () => {
      mockGet.mockResolvedValue({
        status: 200,
        data: { mimeType: "application/pdf", fileSize: 123 },
        headers: {},
      });

      const response = await headFile(
        createGetRequest("/api/file-storage/files/file_123/download"),
        { params: Promise.resolve({ fileId: "file_123" }) },
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("application/pdf");
      expect(response.headers.get("content-disposition")).toBe("inline");
      expect(response.headers.get("content-length")).toBe("123");
      expect(response.body).toBeNull();
      // Metadata endpoint, not the download endpoint: HEAD must never
      // transfer the file body upstream just to answer a preflight.
      expect(mockGet).toHaveBeenCalledWith("/documents/file_123", {
        headers: { Authorization: "Bearer auth-token" },
      });
    });

    it("passes x-content-type-options through on HEAD when upstream provides it", async () => {
      mockGet.mockResolvedValue({
        status: 200,
        data: { mimeType: "application/pdf", fileSize: 123 },
        headers: { "x-content-type-options": "nosniff" },
      });

      const response = await headFile(
        createGetRequest("/api/file-storage/files/file_123/download"),
        { params: Promise.resolve({ fileId: "file_123" }) },
      );

      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    });

    it("rejects unsafe HEAD IDs before proxying, without a body", async () => {
      const response = await headFile(
        createGetRequest("/api/file-storage/files/bad%2Fid/download"),
        { params: Promise.resolve({ fileId: "bad%2Fid" }) },
      );

      expect(response.status).toBe(400);
      expect(response.body).toBeNull();
      expect(mockGet).not.toHaveBeenCalled();
    });
  });

  describe("auth rejection", () => {
    function noAuthRequest(path: string, method = "GET"): NextRequest {
      return new NextRequest(`http://localhost${path}`, { method });
    }

    it("rejects file listing without auth_token", async () => {
      const response = await listFiles(noAuthRequest("/api/file-storage/files"));
      expect(response.status).toBe(401);
      expect(mockGet).not.toHaveBeenCalled();
    });

    it("rejects file upload without auth_token", async () => {
      const response = await uploadFile(noAuthRequest("/api/file-storage/files", "POST"));
      expect(response.status).toBe(401);
      expect(mockPost).not.toHaveBeenCalled();
    });

    it("rejects file detail GET without auth_token", async () => {
      const response = await getFile(noAuthRequest("/api/file-storage/files/file_123"), {
        params: Promise.resolve({ fileId: "file_123" }),
      });
      expect(response.status).toBe(401);
      expect(mockGet).not.toHaveBeenCalled();
    });

    it("rejects file update without auth_token", async () => {
      const response = await updateFile(noAuthRequest("/api/file-storage/files/file_123", "PUT"), {
        params: Promise.resolve({ fileId: "file_123" }),
      });
      expect(response.status).toBe(401);
      expect(mockPut).not.toHaveBeenCalled();
    });

    it("rejects file delete without auth_token", async () => {
      const response = await deleteFile(noAuthRequest("/api/file-storage/files/file_123", "DELETE"), {
        params: Promise.resolve({ fileId: "file_123" }),
      });
      expect(response.status).toBe(401);
      expect(mockDelete).not.toHaveBeenCalled();
    });

    it("rejects file download without auth_token", async () => {
      const response = await downloadFile(
        noAuthRequest("/api/file-storage/files/file_123/download"),
        { params: Promise.resolve({ fileId: "file_123" }) },
      );
      expect(response.status).toBe(401);
      expect(mockGet).not.toHaveBeenCalled();
    });

    it("rejects HEAD download without auth_token, without a body", async () => {
      const response = await headFile(
        noAuthRequest("/api/file-storage/files/file_123/download", "HEAD"),
        { params: Promise.resolve({ fileId: "file_123" }) },
      );
      expect(response.status).toBe(401);
      expect(response.body).toBeNull();
      expect(mockGet).not.toHaveBeenCalled();
    });
  });
});
