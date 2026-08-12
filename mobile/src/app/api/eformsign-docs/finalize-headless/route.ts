import { NextRequest } from "next/server";
import { z } from "zod";
import { serverAPIClient } from "@/lib/api/server";
import {
    backendJsonResponse,
    errorResponse,
    getAuthHeaders,
    getAuthToken,
    parseBody,
    unauthorizedResponse,
} from "@/lib/api/route-utils";

// Mirrors backend FinalizeHeadlessRequestDto: documentId is @IsString()
// @IsNotEmpty() required; prefillEndDate (YYYY-MM-DD) and progressId are
// optional. Passthrough preserves any forward-compatible fields.
const finalizeHeadlessSchema = z
    .object({
        documentId: z.string().min(1),
        prefillEndDate: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/, "prefillEndDate must match YYYY-MM-DD")
            .optional(),
        progressId: z.string().optional(),
    })
    .passthrough();

export async function POST(request: NextRequest) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return unauthorizedResponse("Unauthorized");
        }

        const { data, response: invalid } = await parseBody(finalizeHeadlessSchema, request);
        if (invalid) return invalid;

        const response = await serverAPIClient.post("/eformsign-docs/finalize-headless", data, {
            headers: getAuthHeaders(token),
            timeout: 170_000,
        });

        return backendJsonResponse(response);
    } catch (error) {
        return errorResponse(error, "headless eformsign finalize");
    }
}
