import { createReconnectingEventSource } from "../reconnecting-event-source";

type SseListener = (event: Event) => void;

class MockEventSource {
    static instances: MockEventSource[] = [];

    readonly url: string;
    closed = false;
    private readonly listeners = new Map<string, Set<SseListener>>();

    constructor(url: string) {
        this.url = url;
        MockEventSource.instances.push(this);
    }

    addEventListener(type: string, listener: SseListener): void {
        if (!this.listeners.has(type)) {
            this.listeners.set(type, new Set());
        }
        this.listeners.get(type)?.add(listener);
    }

    close(): void {
        this.closed = true;
    }

    emit(type: string, event: Event = new Event(type)): void {
        this.listeners.get(type)?.forEach((listener) => listener(event));
    }
}

describe("createReconnectingEventSource", () => {
    beforeEach(() => {
        jest.useFakeTimers();
        MockEventSource.instances = [];
        (globalThis as unknown as { EventSource: unknown }).EventSource =
            MockEventSource;
    });

    afterEach(() => {
        jest.clearAllTimers();
        jest.useRealTimers();
        delete (globalThis as unknown as { EventSource?: unknown }).EventSource;
    });

    it("should reconnect with exponential backoff capped at thirty seconds", () => {
        const onProgress = jest.fn();
        const connection = createReconnectingEventSource({
            eventName: "progress",
            onEvent: onProgress,
            url: "/api/eformsign-docs/dispatch-headless/progress?progressId=progress-1",
        });
        const first = MockEventSource.instances[0];

        first.emit(
            "progress",
            new MessageEvent("progress", { data: '{"step":"creating"}' }),
        );
        first.emit("error");
        first.emit("error");

        expect(onProgress).toHaveBeenCalledTimes(1);
        expect(first.closed).toBe(true);
        expect(MockEventSource.instances).toHaveLength(1);

        jest.advanceTimersByTime(1_999);
        expect(MockEventSource.instances).toHaveLength(1);

        jest.advanceTimersByTime(1);
        expect(MockEventSource.instances).toHaveLength(2);

        MockEventSource.instances[1].emit("error");
        jest.advanceTimersByTime(3_999);
        expect(MockEventSource.instances).toHaveLength(2);
        jest.advanceTimersByTime(1);
        expect(MockEventSource.instances).toHaveLength(3);

        for (const expectedDelay of [8_000, 16_000, 30_000, 30_000]) {
            MockEventSource.instances.at(-1)?.emit("error");
            jest.advanceTimersByTime(expectedDelay - 1);
            const countBeforeReconnect = MockEventSource.instances.length;
            jest.advanceTimersByTime(1);
            expect(MockEventSource.instances).toHaveLength(countBeforeReconnect + 1);
        }

        connection.close();
        expect(MockEventSource.instances.at(-1)?.closed).toBe(true);
    });

    it("should reset the backoff after a connection opens", () => {
        const connection = createReconnectingEventSource({
            eventName: "progress",
            onEvent: jest.fn(),
            url: "/api/eformsign-docs/dispatch-headless/progress?progressId=progress-1",
        });

        MockEventSource.instances[0].emit("error");
        jest.advanceTimersByTime(2_000);
        MockEventSource.instances[1].emit("error");
        jest.advanceTimersByTime(4_000);
        MockEventSource.instances[2].emit("open");
        MockEventSource.instances[2].emit("error");

        jest.advanceTimersByTime(1_999);
        expect(MockEventSource.instances).toHaveLength(3);
        jest.advanceTimersByTime(1);
        expect(MockEventSource.instances).toHaveLength(4);

        connection.close();
    });

    it("should cancel a pending reconnect when the owner closes", () => {
        const connection = createReconnectingEventSource({
            eventName: "progress",
            onEvent: jest.fn(),
            url: "/api/eformsign-docs/dispatch-headless/progress?progressId=progress-1",
        });

        MockEventSource.instances[0].emit("error");
        connection.close();
        jest.advanceTimersByTime(10_000);

        expect(MockEventSource.instances).toHaveLength(1);
    });
});
