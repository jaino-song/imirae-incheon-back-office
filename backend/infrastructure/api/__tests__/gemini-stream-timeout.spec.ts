import { ConfigService } from "@nestjs/config";
import { streamText } from "ai";
import { GeminiChatGateway, GeminiStreamChunk } from "../gemini-chat.gateway";
import { VercelGeminiGateway } from "../vercel-gemini.gateway";

jest.mock("ai", () => ({
    streamText: jest.fn(),
}));

jest.mock("@ai-sdk/google", () => ({
    createGoogleGenerativeAI: jest.fn(() => jest.fn(() => ({ modelId: "test-model" }))),
}));

const streamTextMock = jest.mocked(streamText);
const TOTAL_TIMEOUT_MS = 1_000;
const STREAM_MESSAGES = [{ role: "user" as const, content: "hello" }];

interface Deferred<T> {
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (reason?: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
    let resolve: (value: T) => void = () => undefined;
    let reject: (reason?: unknown) => void = () => undefined;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

function createConfigService(): ConfigService {
    const values: Record<string, string | number | undefined> = {
        GEMINI_API_KEY: "test-key",
        GEMINI_CHAT_MODEL: "test-model",
        GEMINI_CHAT_TIMEOUT_MS: TOTAL_TIMEOUT_MS,
    };
    return {
        get: jest.fn((key: string) => values[key]),
    } as unknown as ConfigService;
}

async function flushMicrotasks(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
}

async function collect(stream: AsyncGenerator<GeminiStreamChunk>): Promise<GeminiStreamChunk[]> {
    const events: GeminiStreamChunk[] = [];
    for await (const event of stream) {
        events.push(event);
    }
    return events;
}

function textSseChunk(text: string): Uint8Array {
    return new TextEncoder().encode(
        `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] })}\n`,
    );
}

function createControlledReader() {
    type ReadResult = ReadableStreamReadResult<Uint8Array>;
    const pendingReads: Array<(result: ReadResult) => void> = [];
    const reader = {
        read: jest.fn(() => new Promise<ReadResult>((resolve) => pendingReads.push(resolve))),
        cancel: jest.fn(async () => undefined),
        releaseLock: jest.fn(),
    };

    return {
        reader,
        resolveNext(result: ReadResult): void {
            const resolve = pendingReads.shift();
            if (!resolve) {
                throw new Error("No pending body read");
            }
            resolve(result);
        },
    };
}

function createControlledVercelStream() {
    type StreamResult = IteratorResult<unknown>;
    const pendingReads: Array<(result: StreamResult) => void> = [];
    const iterator = {
        next: jest.fn(() => new Promise<StreamResult>((resolve) => pendingReads.push(resolve))),
        return: jest.fn(async () => ({ done: true, value: undefined } as StreamResult)),
        [Symbol.asyncIterator]() {
            return this;
        },
    };

    return {
        fullStream: iterator,
        iterator,
        resolveNext(result: StreamResult): void {
            const resolve = pendingReads.shift();
            if (!resolve) {
                throw new Error("No pending Vercel stream read");
            }
            resolve(result);
        },
    };
}

describe("Gemini streaming timeout contract", () => {
    beforeEach(() => {
        jest.useFakeTimers();
        streamTextMock.mockReset();
    });

    afterEach(() => {
        jest.runOnlyPendingTimers();
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    describe("GeminiChatGateway", () => {
        test("returns a safe headers-timeout error when response headers never arrive", async () => {
            const fetchDeferred = createDeferred<Response>();
            const fetchMock = jest.spyOn(global, "fetch").mockReturnValue(fetchDeferred.promise);
            const gateway = new GeminiChatGateway(createConfigService());

            const eventsPromise = collect(gateway.chatStream(STREAM_MESSAGES));
            await flushMicrotasks();
            jest.advanceTimersByTime(TOTAL_TIMEOUT_MS);

            const events = await eventsPromise;
            expect(events).toEqual([
                { type: "error", error: expect.stringContaining("headers") },
            ]);
            expect(events.some((event) => event.type === "done")).toBe(false);
            const request = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
            expect(request?.signal).toEqual(expect.objectContaining({ aborted: true }));
            expect(jest.getTimerCount()).toBe(0);

            fetchDeferred.resolve({ ok: true } as Response);
        });

        test("cancels a direct body read when the stream stalls after headers", async () => {
            const controlled = createControlledReader();
            jest.spyOn(global, "fetch").mockResolvedValue({
                ok: true,
                body: { getReader: () => controlled.reader },
            } as unknown as Response);
            const gateway = new GeminiChatGateway(createConfigService());

            const eventsPromise = collect(gateway.chatStream(STREAM_MESSAGES));
            await flushMicrotasks();
            jest.advanceTimersByTime(450);

            const events = await eventsPromise;
            expect(events).toEqual([
                { type: "error", error: expect.stringContaining("idle") },
            ]);
            expect(controlled.reader.cancel).toHaveBeenCalledTimes(1);
            expect(controlled.reader.releaseLock).toHaveBeenCalledTimes(1);
            expect(events.some((event) => event.type === "done")).toBe(false);
            expect(jest.getTimerCount()).toBe(0);
        });

        test("keeps a direct stream alive when chunks arrive within the idle window", async () => {
            const controlled = createControlledReader();
            jest.spyOn(global, "fetch").mockResolvedValue({
                ok: true,
                body: { getReader: () => controlled.reader },
            } as unknown as Response);
            const gateway = new GeminiChatGateway(createConfigService());

            const eventsPromise = collect(gateway.chatStream(STREAM_MESSAGES));
            await flushMicrotasks();

            jest.advanceTimersByTime(300);
            controlled.resolveNext({ done: false, value: textSseChunk("hello") });
            await flushMicrotasks();
            jest.advanceTimersByTime(300);
            controlled.resolveNext({ done: true, value: undefined });

            const events = await eventsPromise;
            expect(events).toEqual([
                { type: "text", content: "hello" },
                { type: "done" },
            ]);
            expect(controlled.reader.cancel).not.toHaveBeenCalled();
            expect(controlled.reader.releaseLock).toHaveBeenCalledTimes(1);
            expect(jest.getTimerCount()).toBe(0);
        });

        test("reports the total deadline even while direct chunks remain active", async () => {
            const controlled = createControlledReader();
            jest.spyOn(global, "fetch").mockResolvedValue({
                ok: true,
                body: { getReader: () => controlled.reader },
            } as unknown as Response);
            const gateway = new GeminiChatGateway(createConfigService());

            const eventsPromise = collect(gateway.chatStream(STREAM_MESSAGES));
            await flushMicrotasks();

            for (const text of ["one", "two", "three"]) {
                jest.advanceTimersByTime(300);
                controlled.resolveNext({ done: false, value: textSseChunk(text) });
                await flushMicrotasks();
            }
            jest.advanceTimersByTime(101);

            const events = await eventsPromise;
            expect(events.filter((event) => event.type === "text")).toHaveLength(3);
            expect(events.at(-1)).toEqual({ type: "error", error: expect.stringContaining("total") });
            expect(events.some((event) => event.type === "done")).toBe(false);
            expect(jest.getTimerCount()).toBe(0);
        });

        test("propagates caller cancellation without claiming a completed response", async () => {
            const controlled = createControlledReader();
            jest.spyOn(global, "fetch").mockResolvedValue({
                ok: true,
                body: { getReader: () => controlled.reader },
            } as unknown as Response);
            const gateway = new GeminiChatGateway(createConfigService());
            const caller = new AbortController();

            const eventsPromise = collect(gateway.chatStream(STREAM_MESSAGES, [], caller.signal));
            await flushMicrotasks();
            caller.abort();

            const events = await eventsPromise;
            expect(events).toEqual([
                { type: "error", error: expect.stringContaining("canceled") },
            ]);
            expect(events.some((event) => event.type === "done")).toBe(false);
            expect(controlled.reader.cancel).toHaveBeenCalledTimes(1);
            expect(jest.getTimerCount()).toBe(0);
        });
    });

    describe("VercelGeminiGateway", () => {
        function createGateway(): VercelGeminiGateway {
            return new VercelGeminiGateway(createConfigService());
        }

        test("returns a safe headers-timeout error when no Vercel stream chunk arrives", async () => {
            const controlled = createControlledVercelStream();
            streamTextMock.mockReturnValue({ fullStream: controlled.fullStream } as never);
            const gateway = createGateway();

            const eventsPromise = collect(gateway.chatStream(STREAM_MESSAGES));
            await flushMicrotasks();
            jest.advanceTimersByTime(TOTAL_TIMEOUT_MS);

            const events = await eventsPromise;
            expect(events).toEqual([
                { type: "error", error: expect.stringContaining("headers") },
            ]);
            expect(controlled.iterator.return).toHaveBeenCalledTimes(1);
            expect(events.some((event) => event.type === "done")).toBe(false);
            expect(jest.getTimerCount()).toBe(0);
        });

        test("cancels a Vercel stream when it stalls after its first chunk", async () => {
            const controlled = createControlledVercelStream();
            streamTextMock.mockReturnValue({ fullStream: controlled.fullStream } as never);
            const gateway = createGateway();

            const eventsPromise = collect(gateway.chatStream(STREAM_MESSAGES));
            await flushMicrotasks();
            controlled.resolveNext({ done: false, value: { type: "text-delta", text: "hello" } });
            await flushMicrotasks();
            jest.advanceTimersByTime(450);

            const events = await eventsPromise;
            expect(events).toEqual([
                { type: "text", content: "hello" },
                { type: "error", error: expect.stringContaining("idle") },
            ]);
            expect(controlled.iterator.return).toHaveBeenCalledTimes(1);
            expect(events.some((event) => event.type === "done")).toBe(false);
            expect(jest.getTimerCount()).toBe(0);
        });

        test("keeps a Vercel stream alive when chunks arrive within the idle window", async () => {
            const controlled = createControlledVercelStream();
            streamTextMock.mockReturnValue({ fullStream: controlled.fullStream } as never);
            const gateway = createGateway();

            const eventsPromise = collect(gateway.chatStream(STREAM_MESSAGES));
            await flushMicrotasks();

            jest.advanceTimersByTime(300);
            controlled.resolveNext({ done: false, value: { type: "text-delta", text: "hello" } });
            await flushMicrotasks();
            jest.advanceTimersByTime(300);
            controlled.resolveNext({ done: false, value: { type: "finish" } });

            const events = await eventsPromise;
            expect(events).toEqual([
                { type: "text", content: "hello" },
                { type: "done" },
            ]);
            expect(controlled.iterator.return).toHaveBeenCalledTimes(1);
            expect(jest.getTimerCount()).toBe(0);
        });

        test("reports the total deadline even while Vercel chunks remain active", async () => {
            const controlled = createControlledVercelStream();
            streamTextMock.mockReturnValue({ fullStream: controlled.fullStream } as never);
            const gateway = createGateway();

            const eventsPromise = collect(gateway.chatStream(STREAM_MESSAGES));
            await flushMicrotasks();

            for (const text of ["one", "two", "three"]) {
                jest.advanceTimersByTime(300);
                controlled.resolveNext({ done: false, value: { type: "text-delta", text } });
                await flushMicrotasks();
            }
            jest.advanceTimersByTime(101);

            const events = await eventsPromise;
            expect(events.filter((event) => event.type === "text")).toHaveLength(3);
            expect(events.at(-1)).toEqual({ type: "error", error: expect.stringContaining("total") });
            expect(events.some((event) => event.type === "done")).toBe(false);
            expect(jest.getTimerCount()).toBe(0);
        });

        test("propagates caller cancellation to the Vercel stream", async () => {
            const controlled = createControlledVercelStream();
            streamTextMock.mockReturnValue({ fullStream: controlled.fullStream } as never);
            const gateway = createGateway();
            const caller = new AbortController();

            const eventsPromise = collect(gateway.chatStream(STREAM_MESSAGES, [], caller.signal));
            await flushMicrotasks();
            caller.abort();

            const events = await eventsPromise;
            expect(events).toEqual([
                { type: "error", error: expect.stringContaining("canceled") },
            ]);
            expect(controlled.iterator.return).toHaveBeenCalledTimes(1);
            expect(events.some((event) => event.type === "done")).toBe(false);
            expect(jest.getTimerCount()).toBe(0);
        });
    });
});
