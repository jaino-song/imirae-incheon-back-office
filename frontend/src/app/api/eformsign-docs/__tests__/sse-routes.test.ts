/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import {
    GET as getDispatchProgress,
    maxDuration as dispatchProgressMaxDuration,
} from "../dispatch-headless/progress/route";
import {
    GET as getDocumentEvents,
    maxDuration as documentEventsMaxDuration,
} from "../events/route";

interface RouteCase {
    label: string;
    maxDuration: number;
    requestUrl: string;
    run: (request: NextRequest) => Promise<Response>;
}

const routeCases: RouteCase[] = [
    {
        label: "document events",
        maxDuration: documentEventsMaxDuration,
        requestUrl: "http://localhost/api/eformsign-docs/events",
        run: getDocumentEvents,
    },
    {
        label: "dispatch progress",
        maxDuration: dispatchProgressMaxDuration,
        requestUrl:
            "http://localhost/api/eformsign-docs/dispatch-headless/progress?progressId=progress-1",
        run: getDispatchProgress,
    },
];

describe.each(routeCases)("$label SSE proxy", ({ maxDuration, requestUrl, run }) => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        jest.clearAllTimers();
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    it("should abort upstream and cleanly close before the Vercel limit", async () => {
        const cancelUpstream = jest.fn();
        const upstreamBody = new ReadableStream<Uint8Array>({
            cancel: cancelUpstream,
        });
        let upstreamSignal: AbortSignal | undefined;
        globalThis.fetch = jest.fn((_input, init) => {
            upstreamSignal = init?.signal ?? undefined;
            return Promise.resolve(
                new Response(upstreamBody, {
                    status: 200,
                    headers: { "Content-Type": "text/event-stream" },
                }),
            );
        }) as typeof fetch;

        const response = await run(
            new NextRequest(requestUrl, {
                headers: { cookie: "auth_token=auth-token" },
            }),
        );
        const reader = response.body?.getReader();
        const completedRead = reader?.read();

        expect(maxDuration).toBe(60);
        expect(response.status).toBe(200);
        expect(response.headers.get("Content-Type")).toBe(
            "text/event-stream; charset=utf-8",
        );
        expect(upstreamSignal?.aborted).toBe(false);

        await jest.advanceTimersByTimeAsync(49_999);
        expect(upstreamSignal?.aborted).toBe(false);

        await jest.advanceTimersByTimeAsync(1);

        expect(upstreamSignal?.aborted).toBe(true);
        await expect(completedRead).resolves.toEqual({
            done: true,
            value: undefined,
        });
        expect(cancelUpstream).toHaveBeenCalledTimes(1);
    });

    it("should abort upstream and cleanly close when the client leaves", async () => {
        const cancelUpstream = jest.fn();
        const upstreamBody = new ReadableStream<Uint8Array>({
            cancel: cancelUpstream,
        });
        let upstreamSignal: AbortSignal | undefined;
        globalThis.fetch = jest.fn((_input, init) => {
            upstreamSignal = init?.signal ?? undefined;
            return Promise.resolve(new Response(upstreamBody, { status: 200 }));
        }) as typeof fetch;
        const requestController = new AbortController();
        const response = await run(
            new NextRequest(requestUrl, {
                headers: { cookie: "auth_token=auth-token" },
                signal: requestController.signal,
            }),
        );
        const completedRead = response.body?.getReader().read();

        requestController.abort();
        await jest.advanceTimersByTimeAsync(0);

        expect(upstreamSignal?.aborted).toBe(true);
        await expect(completedRead).resolves.toEqual({
            done: true,
            value: undefined,
        });
        expect(cancelUpstream).toHaveBeenCalledTimes(1);
    });

    it("should forward Last-Event-ID to the upstream request", async () => {
        let upstreamHeaders: Headers | undefined;
        globalThis.fetch = jest.fn((_input, init) => {
            upstreamHeaders = new Headers(init?.headers);
            return Promise.resolve(new Response(null, { status: 204 }));
        }) as typeof fetch;

        await run(
            new NextRequest(requestUrl, {
                headers: {
                    cookie: "auth_token=auth-token",
                    "Last-Event-ID": "event-42",
                },
            }),
        );

        expect(upstreamHeaders?.get("Last-Event-ID")).toBe("event-42");
    });
});
