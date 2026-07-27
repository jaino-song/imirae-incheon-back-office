const RECONNECT_DELAY_MS = 2_000;

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
    let closed = false;

    const connect = () => {
        if (closed || source) {
            return;
        }

        const next = new EventSource(url);
        source = next;

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
            reconnectTimer = window.setTimeout(() => {
                reconnectTimer = null;
                connect();
            }, RECONNECT_DELAY_MS);
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
