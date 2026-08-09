import { NextRequest } from "next/server";
import { z } from "zod";

import { serverAPIClient } from "@/lib/api/server";
import {
    backendJsonResponse,
    getAuthHeaders,
    getAuthToken,
    parseBody,
    unauthorizedResponse,
} from "@/lib/api/route-utils";
// Deliberately the shared sanitizing errorResponse: the local
// "@/lib/api/route-utils" binds errorResponse to legacy-message mode, which
// forwards upstream error text to the browser. File-storage mirrors mobile's
// sanitized error behaviour.
import { errorResponse } from "@babyjamjam/shared/api";
import {
    documentPath,
    invalidFileIdResponse,
    isValidFileId,
} from "../../file-route-utils";

// Mirrors backend UpdateDocumentDto: every field is @IsOptional, so a
// passthrough object that type-checks known fields is sufficient. The
// backend's authoritative ValidationPipe owns the full contract.
const updateDocumentSchema = z
    .object({
        name: z.string().optional(),
        description: z.string().optional(),
        categoryId: z.string().optional(),
        tags: z.array(z.string()).optional(),
    })
    .passthrough();

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ fileId: string }> }
) {
    const token = getAuthToken(request);
    if (!token) {
        return unauthorizedResponse("unauthorized");
    }

    const { fileId } = await params;
    if (!isValidFileId(fileId)) {
        return invalidFileIdResponse();
    }

    try {
        const response = await serverAPIClient.get(documentPath(fileId), {
            headers: getAuthHeaders(token),
        });
        return backendJsonResponse(response);
    } catch (error) {
        return errorResponse(error, "fetch document");
    }
}

export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ fileId: string }> }
) {
    const token = getAuthToken(request);
    if (!token) {
        return unauthorizedResponse("unauthorized");
    }

    const { fileId } = await params;
    if (!isValidFileId(fileId)) {
        return invalidFileIdResponse();
    }

    const { data, response: invalid } = await parseBody(updateDocumentSchema, request);
    if (invalid) {
        return invalid;
    }

    try {
        const response = await serverAPIClient.put(documentPath(fileId), data, {
            headers: getAuthHeaders(token),
        });
        return backendJsonResponse(response);
    } catch (error) {
        return errorResponse(error, "update document");
    }
}

export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ fileId: string }> }
) {
    const token = getAuthToken(request);
    if (!token) {
        return unauthorizedResponse("unauthorized");
    }

    const { fileId } = await params;
    if (!isValidFileId(fileId)) {
        return invalidFileIdResponse();
    }

    try {
        const response = await serverAPIClient.delete(documentPath(fileId), {
            headers: getAuthHeaders(token),
        });
        return backendJsonResponse(response);
    } catch (error) {
        return errorResponse(error, "delete document");
    }
}
