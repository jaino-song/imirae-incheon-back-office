export interface FatalSignalSource {
    on(
        event: "uncaughtException",
        listener: (error: Error) => void,
    ): FatalSignalSource;
    on(
        event: "unhandledRejection",
        listener: (reason: unknown, promise: Promise<unknown>) => void,
    ): FatalSignalSource;
    off(
        event: "uncaughtException",
        listener: (error: Error) => void,
    ): FatalSignalSource;
    off(
        event: "unhandledRejection",
        listener: (reason: unknown, promise: Promise<unknown>) => void,
    ): FatalSignalSource;
}

export interface FatalProcessLifecycleOptions {
    process?: FatalSignalSource;
    markNotReady: (error: unknown) => void;
    shutdown: () => Promise<void> | void;
    exit: (code: number) => void;
    logger?: (...args: unknown[]) => void;
    shutdownTimeoutMs?: number;
}

export interface FatalProcessLifecycle {
    handleUncaughtException(error: Error): Promise<void>;
    handleUnhandledRejection(reason: unknown, promise: Promise<unknown>): Promise<void>;
    install(): void;
    dispose(): void;
}

export const DEFAULT_FATAL_SHUTDOWN_TIMEOUT_MS = 5_000;

async function shutdownWithinTimeout(
    shutdown: () => Promise<void> | void,
    timeoutMs: number,
): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;

    try {
        await Promise.race([
            Promise.resolve().then(shutdown),
            new Promise<void>((resolve) => {
                timer = setTimeout(resolve, timeoutMs);
            }),
        ]);
    } finally {
        if (timer !== undefined) {
            clearTimeout(timer);
        }
    }
}

export function createFatalProcessLifecycle(
    options: FatalProcessLifecycleOptions,
): FatalProcessLifecycle {
    const source = options.process ?? (process as unknown as FatalSignalSource);
    const logger = options.logger ?? ((...args: unknown[]) => console.error(...args));
    const shutdownTimeoutMs = Math.max(
        0,
        options.shutdownTimeoutMs ?? DEFAULT_FATAL_SHUTDOWN_TIMEOUT_MS,
    );
    let fatalSignalReceived = false;
    let shutdownPromise: Promise<void> | undefined;
    let installed = false;

    const log = (...args: unknown[]): void => {
        try {
            logger(...args);
        } catch {
            // Logging must not prevent the fatal shutdown path from completing.
        }
    };

    const requestFatalShutdown = (error: unknown, ...logArgs: unknown[]): Promise<void> => {
        if (fatalSignalReceived) {
            return shutdownPromise ?? Promise.resolve();
        }

        fatalSignalReceived = true;
        try {
            options.markNotReady(error);
        } catch (markNotReadyError) {
            log("FAILED TO MARK READINESS UNAVAILABLE:", markNotReadyError);
        }
        log(...logArgs);

        shutdownPromise = (async () => {
            try {
                await shutdownWithinTimeout(options.shutdown, shutdownTimeoutMs);
            } catch (shutdownError) {
                log("FATAL SHUTDOWN FAILED:", shutdownError);
            }
            options.exit(1);
        })();

        return shutdownPromise;
    };

    const handleUncaughtException = (error: Error): Promise<void> =>
        requestFatalShutdown(error, "UNCAUGHT EXCEPTION:", error);
    const handleUnhandledRejection = (
        reason: unknown,
        promise: Promise<unknown>,
    ): Promise<void> =>
        requestFatalShutdown(
            reason,
            "UNHANDLED REJECTION at:",
            promise,
            "reason:",
            reason,
        );
    const uncaughtExceptionListener = (error: Error): void => {
        void handleUncaughtException(error);
    };
    const unhandledRejectionListener = (
        reason: unknown,
        promise: Promise<unknown>,
    ): void => {
        void handleUnhandledRejection(reason, promise);
    };

    const install = (): void => {
        if (installed) {
            return;
        }

        installed = true;
        source.on("uncaughtException", uncaughtExceptionListener);
        source.on("unhandledRejection", unhandledRejectionListener);
    };

    const dispose = (): void => {
        if (!installed) {
            return;
        }

        installed = false;
        source.off("uncaughtException", uncaughtExceptionListener);
        source.off("unhandledRejection", unhandledRejectionListener);
    };

    return {
        handleUncaughtException,
        handleUnhandledRejection,
        install,
        dispose,
    };
}
