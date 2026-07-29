/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { PDFDocument } from "pdf-lib";

import { serverAPIClient } from "@/lib/api/server";
import { GET } from "../route";

jest.mock("@/lib/api/server", () => ({
  serverAPIClient: {
    get: jest.fn(),
  },
}));

const mockServerGet = serverAPIClient.get as jest.Mock;

async function createPdf(pageCount: number): Promise<Uint8Array> {
  const document = await PDFDocument.create();

  for (let index = 0; index < pageCount; index += 1) {
    document.addPage([300, 400]);
  }

  return document.save();
}

function createRequest(url: string): NextRequest {
  return new NextRequest(url, {
    headers: {
      cookie: "auth_token=auth-token",
    },
  });
}

describe("eformsign document download_files route", () => {
  beforeEach(() => {
    mockServerGet.mockReset();
  });

  it("returns only the requested PDF page when page is provided (receipt = page 7)", async () => {
    const sourcePdf = await createPdf(8);
    mockServerGet.mockResolvedValue({
      status: 200,
      headers: { "content-type": "application/pdf" },
      data: sourcePdf,
    });

    const response = await GET(
      createRequest("http://localhost/api/eformsign/documents/doc-1/download_files?fileType=document&page=7"),
      { params: Promise.resolve({ documentId: "doc-1" }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toContain("attachment;");
    expect(response.headers.get("Content-Disposition")).toContain("doc-1-document-page-7.pdf");
    expect(mockServerGet).toHaveBeenCalledWith(
      "/api/documents/doc-1/download_files",
      expect.objectContaining({ params: { fileType: "document" } }),
    );

    const outputPdf = await PDFDocument.load(await response.arrayBuffer());
    expect(outputPdf.getPageCount()).toBe(1);
  });

  it("rejects page requests beyond the PDF page count", async () => {
    const sourcePdf = await createPdf(2);
    mockServerGet.mockResolvedValue({
      status: 200,
      headers: { "content-type": "application/pdf" },
      data: sourcePdf,
    });

    const response = await GET(
      createRequest("http://localhost/api/eformsign/documents/doc-1/download_files?fileType=document&page=7"),
      { params: Promise.resolve({ documentId: "doc-1" }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Requested page 7 but PDF only has 2 pages.",
    });
  });
});
