import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const COOKIE_NAMES = {
    ACCESS_TOKEN: "eformsign_access_token",
    REFRESH_TOKEN: "eformsign_refresh_token",
} as const;

export const NO_STORE_CACHE_CONTROL = "no-store, max-age=0";

class InvalidJsonBodyError extends Error {
    constructor() {
        super("Request body must be valid JSON");
        this.name = "InvalidJsonBodyError";
    }
}

interface UpstreamErrorPayload {
    error?: string;
    message?: string;
}

interface UpstreamResponseLike {
    data?: unknown;
    status?: number;
}

interface UpstreamErrorLike {
    code?: unknown;
    response?: UpstreamResponseLike;
}

interface ServerApiClientLike {
    delete(
        url: string,
        config?: unknown,
    ): Promise<UpstreamResponseLike>;
    get(
        url: string,
        config?: unknown,
    ): Promise<UpstreamResponseLike>;
    post(
        url: string,
        data?: unknown,
        config?: unknown,
    ): Promise<UpstreamResponseLike>;
}

export interface RouteUtilsConfig {
    errorResponseMode?: "legacy-message" | "sanitized-fallback";
    secureCookies: boolean;
    serverAPIClient: ServerApiClientLike;
}

export type ParsedBody<T> =
    | { data: T; response: null }
    | { data: null; response: NextResponse };

export interface ProxyBodyOptions {
    additionalBody?: Record<string, unknown>;
    bodySchema?: z.ZodType<unknown>;
}

export async function readJsonObjectBody(request: NextRequest): Promise<Record<string, unknown>> {
    const text = await request.text();

    if (!text.trim()) {
        return {};
    }

    try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            return parsed as Record<string, unknown>;
        }
    } catch {
        throw new InvalidJsonBodyError();
    }

    throw new InvalidJsonBodyError();
}

export function invalidJsonResponse(error: unknown): NextResponse | null {
    if (error instanceof InvalidJsonBodyError) {
        return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return null;
}

export async function parseBody<T>(
    schema: z.ZodType<T>,
    request: NextRequest,
): Promise<ParsedBody<T>> {
    let body: Record<string, unknown>;
    try {
        body = await readJsonObjectBody(request);
    } catch (error) {
        const invalidJson = invalidJsonResponse(error);
        return {
            data: null,
            response:
                invalidJson ??
                NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 }),
        };
    }

    const validation = validateBodyWithSchema(schema, body);
    if (validation.response) {
        return { data: null, response: validation.response };
    }

    return { data: validation.data as T, response: null };
}

function validateBodyWithSchema<T>(
    schema: z.ZodType<T>,
    body: Record<string, unknown>,
): { data: T; response: null } | { data: null; response: NextResponse } {
    const result = schema.safeParse(body);
    if (!result.success) {
        const issues = result.error.issues
            .slice(0, 5)
            .map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`);
        return {
            data: null,
            response: NextResponse.json(
                { error: "Invalid request body", issues },
                { status: 400 },
            ),
        };
    }

    return { data: result.data, response: null };
}

export function getAccessToken(request: NextRequest): string | null {
    return request.cookies.get(COOKIE_NAMES.ACCESS_TOKEN)?.value || null;
}

export function getRefreshToken(request: NextRequest): string | null {
    return request.cookies.get(COOKIE_NAMES.REFRESH_TOKEN)?.value || null;
}

export function getAuthToken(request: NextRequest): string | null {
    return request.cookies.get("auth_token")?.value || null;
}

export function getAuthHeaders(token: string | null): Record<string, string> {
    return token ? { Authorization: `Bearer ${token}` } : {};
}

function getProxyGetParams(
    request: NextRequest,
    accessToken: string,
    backendPathHasQuery: boolean,
): Record<string, string> {
    const params: Record<string, string> = { accessToken };

    // When the route handler pre-encoded its own query string into backendPath,
    // forwarding the incoming request's params again would duplicate keys —
    // the upstream then parses them as arrays and rejects them (e.g.
    // "limit must be an integer").
    if (backendPathHasQuery) {
        return params;
    }

    const { searchParams } = new URL(request.url);
    for (const [key, value] of searchParams.entries()) {
        if (key === "accessToken") {
            continue;
        }
        params[key] = value;
    }

    return params;
}

export function backendJsonResponse(response: UpstreamResponseLike): NextResponse {
    const status = response.status ?? 200;

    if (status === 204) {
        return new NextResponse(null, { status });
    }

    return NextResponse.json(response.data ?? {}, { status });
}

export function withNoStore(response: NextResponse): NextResponse {
    response.headers.set("Cache-Control", NO_STORE_CACHE_CONTROL);
    return response;
}

export function getUpstreamErrorStatus(error: unknown, fallbackStatus = 500): number {
    if (error && typeof error === "object" && "response" in error) {
        const status = (error as UpstreamErrorLike).response?.status;
        if (typeof status === "number" && status >= 400 && status <= 599) {
            return status;
        }
    }

    return fallbackStatus;
}

function getUpstreamErrorData(error: unknown): unknown {
    if (error && typeof error === "object" && "response" in error) {
        return (error as UpstreamErrorLike).response?.data;
    }

    return undefined;
}

function safeErrorCode(value: unknown): string | undefined {
    if (typeof value !== "string") {
        return undefined;
    }

    return /^[A-Z][A-Z0-9_:-]{0,63}$/.test(value) ? value : undefined;
}

export function sanitizeUpstreamClientError(
    upstreamData: unknown,
    fallbackMessage: string,
): { error: string; code?: string; hasKakaoAccount?: boolean } {
    const payload: { error: string; code?: string; hasKakaoAccount?: boolean } = {
        error: fallbackMessage,
    };

    if (upstreamData && typeof upstreamData === "object") {
        const data = upstreamData as { code?: unknown; hasKakaoAccount?: unknown };
        const code = safeErrorCode(data.code);
        if (code) {
            payload.code = code;
        }
        if (typeof data.hasKakaoAccount === "boolean") {
            payload.hasKakaoAccount = data.hasKakaoAccount;
        }
    }

    return payload;
}

export function logUpstreamError(context: string, error: unknown): void {
    const data = getUpstreamErrorData(error);
    const upstreamCode = data && typeof data === "object"
        ? safeErrorCode((data as { code?: unknown }).code)
        : undefined;
    const transportCode = error && typeof error === "object"
        ? safeErrorCode((error as UpstreamErrorLike).code)
        : undefined;
    const errorName = error instanceof Error ? error.name : undefined;

    console.error(`[${context}] Error:`, {
        status: getUpstreamErrorStatus(error),
        code: upstreamCode ?? transportCode,
        name: errorName,
    });
}

export function upstreamJsonErrorResponse(
    status = 502,
    fallbackMessage = "Backend request failed",
): NextResponse {
    return NextResponse.json(
        { error: fallbackMessage, code: "UPSTREAM_ERROR" },
        { status },
    );
}

export function upstreamSseErrorResponse(
    status = 502,
    fallbackMessage = "Streaming unavailable",
): Response {
    return new Response(
        `event: error\ndata: ${JSON.stringify({ type: "error", error: fallbackMessage })}\n\n`,
        {
            status,
            headers: {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                Connection: "keep-alive",
            },
        },
    );
}

export async function upstreamStreamErrorResponse(
    upstream: Response,
    fallbackMessage = "Upstream stream request failed",
): Promise<Response> {
    const status = upstream.ok ? 502 : upstream.status;
    await upstream.text().catch(() => "");

    return upstreamJsonErrorResponse(status, fallbackMessage);
}

export function upstreamStreamTransportErrorResponse(
    error: unknown,
    fallbackMessage = "Upstream stream request failed",
): Response {
    void error;

    return upstreamJsonErrorResponse(502, fallbackMessage);
}

export function unauthorizedResponse(
    message = "Access token is required. Please authenticate first.",
): NextResponse {
    return NextResponse.json({ error: message }, { status: 401 });
}

export function errorResponse(error: unknown, context: string): NextResponse {
    const upstreamData = (error as UpstreamErrorLike).response?.data as UpstreamErrorPayload | undefined;
    const status = (error as UpstreamErrorLike).response?.status || 500;

    logUpstreamError(context, error);
    return NextResponse.json(
        sanitizeUpstreamClientError(upstreamData, `Failed to ${context}`),
        { status },
    );
}

function createLegacyErrorResponse(error: unknown, context: string): NextResponse {
    const upstreamData = (error as UpstreamErrorLike).response?.data as UpstreamErrorPayload | undefined;
    const status = (error as UpstreamErrorLike).response?.status || 500;
    const message = upstreamData?.error
        || upstreamData?.message
        || (error instanceof Error ? error.message : `Failed to ${context}`);

    console.error(`[${context}] Error:`, message);
    return NextResponse.json({ error: message }, { status });
}

export function createRouteUtils({
    errorResponseMode = "sanitized-fallback",
    secureCookies,
    serverAPIClient,
}: RouteUtilsConfig) {
    const cookieOptions = {
        httpOnly: true,
        secure: secureCookies,
        sameSite: "lax" as const,
        path: "/",
    };
    const boundErrorResponse = errorResponseMode === "legacy-message"
        ? createLegacyErrorResponse
        : errorResponse;

    function setAuthCookies(
        response: NextResponse,
        accessToken: string,
        refreshToken: string,
    ): NextResponse {
        response.cookies.set(COOKIE_NAMES.ACCESS_TOKEN, accessToken, {
            ...cookieOptions,
            maxAge: 60 * 60,
        });
        response.cookies.set(COOKIE_NAMES.REFRESH_TOKEN, refreshToken, {
            ...cookieOptions,
            maxAge: 60 * 60 * 24 * 7,
        });
        return response;
    }

    async function proxyGetRequest(
        request: NextRequest,
        backendPath: string,
        context: string,
    ): Promise<NextResponse> {
        const authToken = getAuthToken(request);
        const accessToken = getAccessToken(request);

        if (!authToken) {
            return unauthorizedResponse("Authentication required. Please log in.");
        }

        if (!accessToken) {
            return unauthorizedResponse("eFormsign access token required. Please authenticate with eFormsign first.");
        }

        try {
            const response = await serverAPIClient.get(backendPath, {
                params: getProxyGetParams(request, accessToken, backendPath.includes("?")),
                headers: getAuthHeaders(authToken),
            });

            if ((response.status ?? 200) >= 400) {
                return NextResponse.json(
                    sanitizeUpstreamClientError(response.data, `Failed to ${context}`),
                    { status: response.status },
                );
            }

            return NextResponse.json(response.data);
        } catch (error) {
            return boundErrorResponse(error, context);
        }
    }

    async function proxyPostRequest(
        request: NextRequest,
        backendPath: string,
        context: string,
        options?: ProxyBodyOptions,
    ): Promise<NextResponse> {
        const { additionalBody, bodySchema } = options ?? {};
        const authToken = getAuthToken(request);
        const accessToken = getAccessToken(request);

        if (!authToken) {
            return unauthorizedResponse("Authentication required. Please log in.");
        }

        if (!accessToken) {
            return unauthorizedResponse("eFormsign access token required. Please authenticate with eFormsign first.");
        }

        try {
            const body = await readJsonObjectBody(request);

            if (bodySchema) {
                const validation = validateBodyWithSchema(bodySchema, body);
                if (validation.response) {
                    return validation.response;
                }
            }

            const response = await serverAPIClient.post(
                backendPath,
                {
                    ...body,
                    ...additionalBody,
                    accessToken,
                },
                {
                    headers: getAuthHeaders(authToken),
                },
            );

            if ((response.status ?? 200) >= 400) {
                return NextResponse.json(
                    sanitizeUpstreamClientError(response.data, `Failed to ${context}`),
                    { status: response.status },
                );
            }

            return NextResponse.json(response.data);
        } catch (error) {
            const invalidJson = invalidJsonResponse(error);
            if (invalidJson) {
                return invalidJson;
            }

            return boundErrorResponse(error, context);
        }
    }

    async function proxyDeleteRequest(
        request: NextRequest,
        backendPath: string,
        context: string,
        options?: ProxyBodyOptions,
    ): Promise<NextResponse> {
        const { additionalBody, bodySchema } = options ?? {};
        const authToken = getAuthToken(request);
        const accessToken = getAccessToken(request);

        if (!authToken) {
            return unauthorizedResponse("Authentication required. Please log in.");
        }

        if (!accessToken) {
            return unauthorizedResponse("eFormsign access token required. Please authenticate with eFormsign first.");
        }

        try {
            const body = await readJsonObjectBody(request);

            if (bodySchema) {
                const validation = validateBodyWithSchema(bodySchema, body);
                if (validation.response) {
                    return validation.response;
                }
            }

            const { searchParams } = new URL(request.url);

            const params: Record<string, string> = { accessToken };
            for (const [key, value] of searchParams.entries()) {
                if (key !== "accessToken") {
                    params[key] = value;
                }
            }

            const response = await serverAPIClient.delete(backendPath, {
                params,
                data: {
                    ...body,
                    ...additionalBody,
                },
                headers: getAuthHeaders(authToken),
            });

            if ((response.status ?? 200) >= 400) {
                return NextResponse.json(
                    sanitizeUpstreamClientError(response.data, `Failed to ${context}`),
                    { status: response.status },
                );
            }

            return NextResponse.json(response.data);
        } catch (error) {
            const invalidJson = invalidJsonResponse(error);
            if (invalidJson) {
                return invalidJson;
            }

            return boundErrorResponse(error, context);
        }
    }

    return {
        errorResponse: boundErrorResponse,
        proxyDeleteRequest,
        proxyGetRequest,
        proxyPostRequest,
        setAuthCookies,
    };
}
