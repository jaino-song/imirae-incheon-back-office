const SSE_PROXY_TIMEOUT_MS = 50_000;

const SSE_RESPONSE_HEADERS = {
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "Content-Type": "text/event-stream; charset=utf-8",
    "X-Accel-Buffering": "no",
} as const;

type AbortCause = "request" | "timeout" | null;

interface ProxySseStreamOptions {
    headers: HeadersInit;
    lastEventId?: string | null;
    requestSignal: AbortSignal;
    upstreamUrl: string;
}

function createSseResponse(body: BodyInit | null): Response {
    return new Response(body, {
        status: 200,
        headers: SSE_RESPONSE_HEADERS,
    });
}

async function settleWritable(
    writable: WritableStream<Uint8Array>,
    error?: unknown,
): Promise<void> {
    let writer: WritableStreamDefaultWriter<Uint8Array> | null = null;

    try {
        writer = writable.getWriter();

        if (error === undefined) {
            await writer.close();
            return;
        }

        await writer.abort(error);
    } catch {
        // The upstream can finish concurrently with the timeout/client abort.
    } finally {
        writer?.releaseLock();
    }
}

export async function proxySseStream({
    headers,
    lastEventId,
    requestSignal,
    upstreamUrl,
}: ProxySseStreamOptions): Promise<Response> {
    const upstreamController = new AbortController();
    let abortCause: AbortCause = null;
    let cleanedUp = false;

    const abortUpstream = (cause: Exclude<AbortCause, null>, reason?: unknown) => {
        if (upstreamController.signal.aborted) {
            return;
        }

        abortCause = cause;
        upstreamController.abort(reason);
    };
    const handleRequestAbort = () => {
        abortUpstream("request", requestSignal.reason);
    };
    const timeoutId = setTimeout(() => {
        abortUpstream(
            "timeout",
            new DOMException("SSE proxy deadline reached", "TimeoutError"),
        );
    }, SSE_PROXY_TIMEOUT_MS);
    const cleanup = () => {
        if (cleanedUp) {
            return;
        }

        cleanedUp = true;
        clearTimeout(timeoutId);
        requestSignal.removeEventListener("abort", handleRequestAbort);
    };

    if (requestSignal.aborted) {
        handleRequestAbort();
    } else {
        requestSignal.addEventListener("abort", handleRequestAbort, {
            once: true,
        });
    }

    try {
        const upstreamHeaders = new Headers(headers);
        // Backend replay is not supported yet; preserve the resume cursor for future support.
        if (lastEventId) {
            upstreamHeaders.set("Last-Event-ID", lastEventId);
        }
        const upstream = await fetch(upstreamUrl, {
            method: "GET",
            headers: upstreamHeaders,
            signal: upstreamController.signal,
            cache: "no-store",
        });

        if (!upstream.ok || !upstream.body) {
            // Release the upstream connection: cleanup() removes the abort
            // handle, so an unread body would otherwise linger in the pool.
            await upstream.body?.cancel().catch(() => undefined);
            cleanup();
            return new Response(null, { status: upstream.status });
        }

        const transform = new TransformStream<Uint8Array, Uint8Array>();

        void upstream.body
            .pipeTo(transform.writable, {
                signal: upstreamController.signal,
                preventAbort: true,
            })
            .catch(async (error: unknown) => {
                if (abortCause !== null) {
                    await settleWritable(transform.writable);
                    return;
                }

                await settleWritable(transform.writable, error);
            })
            .finally(cleanup);

        return createSseResponse(transform.readable);
    } catch (error) {
        cleanup();

        if (abortCause !== null) {
            return createSseResponse(null);
        }

        throw error;
    }
}
