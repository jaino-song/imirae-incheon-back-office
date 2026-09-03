import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { proxyDeleteRequest, proxyLocalGetRequest } from "@/lib/api/route-utils";
import type { GetAllDocumentsParams } from "@/services/api";

// Mirrors backend DeleteDocumentsRequestDto (eformsign.dto.ts):
// document_ids is @IsArray() @ArrayNotEmpty() @IsString({ each: true }).
// Passthrough preserves forward-compatible fields (e.g. is_permanent), while
// the shared proxy strips provider credential-shaped fields before forwarding.
const deleteDocumentsSchema = z
    .object({
        document_ids: z.array(z.string()).nonempty(),
    })
    .passthrough();

type IntegerParamOptions = {
    defaultValue: number;
    min: number;
    max?: number;
};

function parseIntegerParam(
    searchParams: URLSearchParams,
    name: string,
    { defaultValue, min, max }: IntegerParamOptions
): { value: number } | { error: string } {
    const rawValue = searchParams.get(name);
    if (rawValue === null) {
        return { value: defaultValue };
    }

    if (!/^-?\d+$/.test(rawValue)) {
        return { error: `${name} must be an integer` };
    }

    const value = Number(rawValue);
    if (!Number.isSafeInteger(value)) {
        return { error: `${name} must be an integer` };
    }

    if (value < min) {
        return { error: `${name} must be greater than or equal to ${min}` };
    }

    if (max !== undefined && value > max) {
        return { error: `${name} must be between ${min} and ${max}` };
    }

    return { value };
}

// Filter params forwarded verbatim to the backend, which owns their validation
// (parseStatusCategory / parseTemplateMatch / parseSection / parseDisplayStatus
// throw BadRequest on bad input). Blank values are dropped so the backend keeps
// its own defaults.
//
// Anything the client sends that is missing here is dropped SILENTLY — there is no
// auto-forward fallback, because getLocalProxyGetParams returns {} once the route
// pre-encodes its own query. displayStatus was missing for a month and 서명 완료 /
// 검토 필요 returned the identical list the whole time.
const PASSTHROUGH_FILTER_PARAMS = [
    "templateId",
    "templateMatch",
    "section",
    "statusCategory",
    "displayStatus",
    "search",
] as const;

/**
 * Compile-time completeness check between the client's param interface and the
 * allowlist above. A new filter on GetAllDocumentsParams is a type error here until
 * it is forwarded — which is the check that did not exist when displayStatus was
 * added. limit/skip/excludeDeleted are handled explicitly by the handler, so they
 * are excluded; extras in the allowlist (templateId/templateMatch, for direct
 * callers) are fine, only omissions are errors.
 */
type ClientFilterParam = Exclude<keyof GetAllDocumentsParams, "limit" | "skip" | "excludeDeleted">;
type UnforwardedClientParam = Exclude<ClientFilterParam, (typeof PASSTHROUGH_FILTER_PARAMS)[number]>;
type AssertNever<T extends never> = T;
export type _EveryClientFilterIsForwarded = AssertNever<UnforwardedClientParam>;

/**
 * GET /api/eformsign/documents
 * Unified endpoint to fetch all eformsign documents (in-progress, completed, rejected)
 *
 * Query params:
 * - limit: number of documents to fetch (default: 100)
 * - skip: number of documents to skip for pagination (default: 0)
 * - section: maternity | service-records — backend resolves the template filter
 *   itself from its own registries; overrides templateId/templateMatch
 * - templateId / templateMatch: template include/exclude filter
 * - statusCategory: drafting | in-progress | completed | expired | unknown
 * - displayStatus: signed | review — splits the shared provider-review scope that
 *   statusCategory=in-progress covers; the two filter pills differ only by this
 * - search: chosung-aware name/title search
 * - excludeDeleted: "true" removes deleted (047/049) documents
 *
 * All filters are applied by the backend BEFORE the limit/skip slice, so they
 * must be forwarded for server-side pagination to return correct pages.
 */
export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const limitResult = parseIntegerParam(searchParams, "limit", {
        defaultValue: 100,
        min: 1,
        max: 100,
    });
    if ("error" in limitResult) {
        return NextResponse.json({ error: limitResult.error }, { status: 400 });
    }

    const skipResult = parseIntegerParam(searchParams, "skip", {
        defaultValue: 0,
        min: 0,
    });
    if ("error" in skipResult) {
        return NextResponse.json({ error: skipResult.error }, { status: 400 });
    }

    const backendParams = new URLSearchParams({
        limit: String(limitResult.value),
        skip: String(skipResult.value),
    });

    for (const name of PASSTHROUGH_FILTER_PARAMS) {
        const value = searchParams.get(name)?.trim();
        if (value) {
            backendParams.set(name, value);
        }
    }

    if (searchParams.get("excludeDeleted") === "true") {
        backendParams.set("excludeDeleted", "true");
    }

    return proxyLocalGetRequest(
        request,
        `/api/documents?${backendParams.toString()}`,
        "fetch all eformsign documents"
    );
}

/**
 * DELETE /api/eformsign/documents
 * Delete one or more eformsign documents
 */
export async function DELETE(request: NextRequest) {
    return proxyDeleteRequest(request, "/api/documents", "delete eformsign documents", {
        bodySchema: deleteDocumentsSchema,
    });
}
