import type { ConfigService } from "@nestjs/config";

/**
 * The existing GEMINI_CHAT_TIMEOUT_MS setting is the total request budget.
 * Header and idle budgets intentionally stay in code: keeping them below the
 * total budget bounds stalled streams without adding another environment key.
 */
export const DEFAULT_GEMINI_STREAM_TOTAL_TIMEOUT_MS = 25_000;
export const DEFAULT_GEMINI_STREAM_PHASE_TIMEOUT_MS = 10_000;
const STREAM_PHASE_TIMEOUT_FRACTION = 0.4;

export type GeminiStreamTimeoutPhase = "headers" | "idle" | "total";

export interface GeminiStreamTimeouts {
    totalMs: number;
    headersMs: number;
    idleMs: number;
}

export class GeminiStreamTimeoutError extends Error {
    readonly name = "GeminiStreamTimeoutError";

    constructor(
        public readonly phase: GeminiStreamTimeoutPhase,
        public readonly timeoutMs: number,
    ) {
        super(`Gemini streaming ${phase} timeout after ${timeoutMs}ms`);
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

export class GeminiStreamCanceledError extends Error {
    readonly name = "GeminiStreamCanceledError";

    constructor() {
        super("Gemini streaming request canceled");
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

function getNumberConfig(
    configService: Pick<ConfigService, "get">,
    key: string,
    fallback: number,
    min: number,
): number {
    const rawValue = configService.get<string | number>(key);
    if (rawValue === undefined || rawValue === null || rawValue === "") {
        return fallback;
    }

    const parsedValue = Number(rawValue);
    return Number.isFinite(parsedValue) && parsedValue >= min ? parsedValue : fallback;
}

export function getGeminiStreamTimeouts(
    configService: Pick<ConfigService, "get">,
): GeminiStreamTimeouts {
    const totalMs = getNumberConfig(
        configService,
        "GEMINI_CHAT_TIMEOUT_MS",
        DEFAULT_GEMINI_STREAM_TOTAL_TIMEOUT_MS,
        1,
    );
    // Scale the phase budget down for intentionally short test/local budgets,
    // while retaining a conservative ten-second cap at the production default.
    const phaseMs = Math.max(
        1,
        Math.min(
            DEFAULT_GEMINI_STREAM_PHASE_TIMEOUT_MS,
            Math.floor(totalMs * STREAM_PHASE_TIMEOUT_FRACTION),
        ),
    );

    return {
        totalMs,
        headersMs: phaseMs,
        idleMs: phaseMs,
    };
}

export interface GeminiStreamDeadline {
    readonly signal: AbortSignal;
    readonly timeouts: GeminiStreamTimeouts;
    getReason(): Error;
    markHeadersReceived(): void;
    markChunkReceived(): void;
    cleanup(): void;
}

export function createGeminiStreamDeadline(
    timeouts: GeminiStreamTimeouts,
    callerSignal?: AbortSignal,
): GeminiStreamDeadline {
    const controller = new AbortController();
    let phaseTimer: ReturnType<typeof setTimeout> | undefined;
    let totalTimer: ReturnType<typeof setTimeout> | undefined;
    let terminationReason: Error | undefined;
    let bodyStarted = false;

    const abort = (reason: Error): void => {
        if (controller.signal.aborted) {
            return;
        }
        terminationReason = reason;
        controller.abort(reason);
    };

    const schedulePhaseTimeout = (
        phase: Exclude<GeminiStreamTimeoutPhase, "total">,
        timeoutMs: number,
    ): void => {
        if (phaseTimer) {
            clearTimeout(phaseTimer);
        }
        phaseTimer = setTimeout(() => {
            abort(new GeminiStreamTimeoutError(phase, timeoutMs));
        }, timeoutMs);
    };

    totalTimer = setTimeout(() => {
        abort(new GeminiStreamTimeoutError("total", timeouts.totalMs));
    }, timeouts.totalMs);
    schedulePhaseTimeout("headers", timeouts.headersMs);

    const onCallerAbort = (): void => {
        abort(new GeminiStreamCanceledError());
    };

    if (callerSignal) {
        if (callerSignal.aborted) {
            onCallerAbort();
        } else {
            callerSignal.addEventListener("abort", onCallerAbort, { once: true });
        }
    }

    return {
        signal: controller.signal,
        timeouts,
        getReason(): Error {
            return terminationReason ?? new GeminiStreamCanceledError();
        },
        markHeadersReceived(): void {
            if (bodyStarted) {
                return;
            }
            bodyStarted = true;
            schedulePhaseTimeout("idle", timeouts.idleMs);
        },
        markChunkReceived(): void {
            if (!bodyStarted) {
                bodyStarted = true;
            }
            schedulePhaseTimeout("idle", timeouts.idleMs);
        },
        cleanup(): void {
            if (phaseTimer) {
                clearTimeout(phaseTimer);
                phaseTimer = undefined;
            }
            if (totalTimer) {
                clearTimeout(totalTimer);
                totalTimer = undefined;
            }
            callerSignal?.removeEventListener("abort", onCallerAbort);
        },
    };
}

export function waitForGeminiStreamOperation<T>(
    operation: PromiseLike<T>,
    deadline: GeminiStreamDeadline,
): Promise<T> {
    if (deadline.signal.aborted) {
        return Promise.reject(deadline.getReason());
    }

    return new Promise<T>((resolve, reject) => {
        let settled = false;
        const onAbort = (): void => {
            if (settled) {
                return;
            }
            settled = true;
            reject(deadline.getReason());
        };

        deadline.signal.addEventListener("abort", onAbort, { once: true });
        Promise.resolve(operation).then(
            (value) => {
                if (settled) {
                    return;
                }
                settled = true;
                deadline.signal.removeEventListener("abort", onAbort);
                resolve(value);
            },
            (error: unknown) => {
                if (settled) {
                    return;
                }
                settled = true;
                deadline.signal.removeEventListener("abort", onAbort);
                reject(error);
            },
        );
    });
}

export function getGeminiStreamTermination(
    error: unknown,
    deadline: GeminiStreamDeadline,
): Error | undefined {
    if (error instanceof GeminiStreamTimeoutError || error instanceof GeminiStreamCanceledError) {
        return error;
    }
    return deadline.signal.aborted ? deadline.getReason() : undefined;
}

export function getSafeGeminiStreamError(
    error: unknown,
    deadline: GeminiStreamDeadline,
): string {
    return getGeminiStreamTermination(error, deadline)?.message
        ?? "Gemini streaming request failed";
}
