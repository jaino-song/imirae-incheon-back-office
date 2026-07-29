import { NextRequest, NextResponse } from "next/server";
import { PDFDocument } from "pdf-lib";

import { serverAPIClient } from "@/lib/api/server";
import {
  errorResponse,
  getAuthHeaders,
  getAuthToken,
  unauthorizedResponse,
} from "@/lib/api/route-utils";

type EformsignFileType = "document" | "audit_trail";

function normalizeFileType(value: string | null): EformsignFileType {
  return value === "audit_trail" ? "audit_trail" : "document";
}

function safeFilenamePart(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80) || "document";
}

function parsePageNumber(value: string | null): number | null {
  if (!value) return null;

  const pageNumber = Number(value);
  if (!Number.isInteger(pageNumber) || pageNumber < 1) {
    throw new RangeError("Requested page must be a positive integer.");
  }

  return pageNumber;
}

async function extractSinglePdfPage(sourcePdf: Uint8Array, pageNumber: number): Promise<Uint8Array> {
  const sourceDocument = await PDFDocument.load(sourcePdf);
  const sourcePageCount = sourceDocument.getPageCount();
  const sourcePageIndex = pageNumber - 1;

  if (sourcePageIndex >= sourcePageCount) {
    throw new RangeError(`Requested page ${pageNumber} but PDF only has ${sourcePageCount} pages.`);
  }

  const receiptDocument = await PDFDocument.create();
  const [receiptPage] = await receiptDocument.copyPages(sourceDocument, [sourcePageIndex]);
  receiptDocument.addPage(receiptPage);

  return receiptDocument.save();
}

/**
 * Proxies the eformsign document PDF from the backend. With `?page=N`, extracts that single
 * page (used for the receipt at `page=7`) — mirrors the mobile BFF route. Backend returns the
 * full PDF; page extraction is a BFF concern.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ documentId: string }> },
) {
  const authToken = getAuthToken(request);

  if (!authToken) {
    return unauthorizedResponse("Authentication required. Please log in.");
  }

  const { documentId } = await params;
  const { searchParams } = new URL(request.url);
  const fileType = normalizeFileType(searchParams.get("fileType"));
  const requestedPageParam = searchParams.get("page");

  try {
    const requestedPage = parsePageNumber(requestedPageParam);
    const response = await serverAPIClient.get(
      `/api/documents/${encodeURIComponent(documentId)}/download_files`,
      {
        params: { fileType },
        headers: getAuthHeaders(authToken),
        responseType: "arraybuffer",
      },
    );

    if (response.status >= 400) {
      return NextResponse.json(
        { error: `Failed to fetch eformsign document PDF (${response.status})` },
        { status: response.status },
      );
    }

    const contentType = String(response.headers["content-type"] || "application/pdf");
    const responseBody =
      response.data instanceof ArrayBuffer
        ? new Uint8Array(response.data)
        : new Uint8Array(response.data as ArrayLike<number>);
    const outputBody = requestedPage
      ? await extractSinglePdfPage(responseBody, requestedPage)
      : responseBody;
    const outputArrayBuffer = outputBody.buffer.slice(
      outputBody.byteOffset,
      outputBody.byteOffset + outputBody.byteLength,
    ) as ArrayBuffer;
    const dispositionType = requestedPage ? "attachment" : "inline";
    const filenameSuffix = requestedPage ? `${fileType}-page-${requestedPage}` : fileType;

    return new NextResponse(outputArrayBuffer, {
      status: response.status,
      headers: {
        "Content-Type": requestedPage ? "application/pdf" : contentType,
        "Content-Disposition": `${dispositionType}; filename="${safeFilenamePart(documentId)}-${filenameSuffix}.pdf"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    if (error instanceof RangeError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return errorResponse(error, "fetch eformsign document PDF");
  }
}
