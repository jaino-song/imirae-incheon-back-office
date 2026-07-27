const INITIAL_RECONNECT_DELAY_MS = 2_000;
const MAX_RECONNECT_DELAY_MS = 30_000;

interface ReconnectingEventSourceOptions {
    eventName: string;
    onEvent: (event: MessageEvent<string>) => void;
    url: string;
}

export interface ReconnectingEventSource {
    close: () => void;
}

export function createReconnectingEventSource({
    eventName,
    onEvent,
    url,
}: ReconnectingEventSourceOptions): ReconnectingEventSource {
    let source: EventSource | null = null;
    let reconnectTimer: number | null = null;
    let reconnectDelayMs = INITIAL_RECONNECT_DELAY_MS;
    let closed = false;

    const connect = () => {
        if (closed || source) {
            return;
        }

        const next = new EventSource(url);
        source = next;

        next.addEventListener("open", () => {
            if (source === next) {
                reconnectDelayMs = INITIAL_RECONNECT_DELAY_MS;
            }
        });
        next.addEventListener(eventName, (event) => {
            if (source !== next) {
                return;
            }

            onEvent(event as MessageEvent<string>);
        });
        next.addEventListener("error", () => {
            if (closed || source !== next || reconnectTimer !== null) {
                return;
            }

            next.close();
            source = null;
            const currentDelayMs = reconnectDelayMs;
            reconnectDelayMs = Math.min(
                reconnectDelayMs * 2,
                MAX_RECONNECT_DELAY_MS,
            );
            reconnectTimer = window.setTimeout(() => {
                reconnectTimer = null;
                connect();
            }, currentDelayMs);
        });
    };

    connect();

    return {
        close: () => {
            closed = true;

            if (reconnectTimer !== null) {
                window.clearTimeout(reconnectTimer);
                reconnectTimer = null;
            }

            source?.close();
            source = null;
        },
    };
}
