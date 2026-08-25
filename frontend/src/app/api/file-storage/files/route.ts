import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { serverAPIClient } from "@/lib/api/server";
import {
    backendJsonResponse,
    getAuthHeaders,
    getAuthToken,
    unauthorizedResponse,
} from "@/lib/api/route-utils";
// Deliberately the shared sanitizing errorResponse: the local
// "@/lib/api/route-utils" binds errorResponse to legacy-message mode, which
// forwards upstream error text (e.g. class-validator messages) to the
// browser. File-storage mirrors mobile's sanitized error behaviour.
import { errorResponse } from "@babyjamjam/shared/api";
import { validateDocumentUploadCandidate } from "@babyjamjam/shared/file-storage";

// Identity fields (orgId/uploadedBy) are deliberately NOT part of this
// whitelist: the backend derives branch + uploader from the JWT
// (@CurrentTenant), so client-supplied identity is spoofable noise and is
// never forwarded. Only validated metadata crosses the proxy.
const uploadMetadataSchema = z.object({
    name: z.string().trim().min(1).max(255).optional(),
    description: z.string().max(2000).optional(),
    categoryId: z.string().trim().min(1).max(100).optional(),
    tags: z.string().max(2000).optional(),
    visibilityScope: z.enum(["branch", "all_branches"]).optional(),
});

export async function GET(request: NextRequest) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return unauthorizedResponse("Unauthorized");
        }

        const { searchParams } = new URL(request.url);
        const categoryId = searchParams.get("categoryId");

        const params: Record<string, string> = {};
        if (categoryId) params.categoryId = categoryId;

        const response = await serverAPIClient.get("/documents", {
            params,
            headers: getAuthHeaders(token),
        });
        return backendJsonResponse(response);
    } catch (error) {
        return errorResponse(error, "fetch documents");
    }
}

export async function POST(request: NextRequest) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return unauthorizedResponse("Unauthorized");
        }

        const formData = await request.formData();
        const file = formData.get("file");

        if (!(file instanceof File)) {
            return NextResponse.json(
                { error: "File is required" },
                { status: 400 }
            );
        }

        const fileValidationError = validateDocumentUploadCandidate(file);
        if (fileValidationError) {
            return NextResponse.json({ error: fileValidationError }, { status: 400 });
        }

        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const backendFormData = new FormData();
        const blob = new Blob([buffer], { type: file.type });
        backendFormData.append("file", blob, file.name);

        const metadataResult = uploadMetadataSchema.safeParse({
            name: formData.get("name") ?? undefined,
            description: formData.get("description") ?? undefined,
            categoryId: formData.get("categoryId") ?? undefined,
            tags: formData.get("tags") ?? undefined,
            visibilityScope: formData.get("visibilityScope") ?? undefined,
        });
        if (!metadataResult.success) {
            return NextResponse.json(
                { error: "Invalid upload metadata" },
                { status: 400 }
            );
        }

        const { name, description, categoryId, tags, visibilityScope } = metadataResult.data;
        if (name) backendFormData.append("name", name);
        if (description) backendFormData.append("description", description);
        if (categoryId) backendFormData.append("categoryId", categoryId);
        if (tags) backendFormData.append("tags", tags);
        if (visibilityScope) backendFormData.append("visibilityScope", visibilityScope);

        const response = await serverAPIClient.post("/documents/upload", backendFormData, {
            timeout: 120000,
            headers: {
                "Content-Type": undefined,
                ...getAuthHeaders(token),
            },
        });

        return backendJsonResponse(response);
    } catch (error) {
        return errorResponse(error, "upload document");
    }
}
