import { EventEmitter } from "node:events";

import {
    createFatalProcessLifecycle,
    type FatalSignalSource,
} from "./fatal-process-lifecycle";
import { ReadinessService } from "../health/readiness.service";

describe("fatal process lifecycle", () => {
    it("fails readiness before one bounded shutdown and exit for duplicate fatal signals", async () => {
        const events: string[] = [];
        const readiness = new ReadinessService();
        const markNotReady = jest.fn(() => {
            readiness.markNotReady();
            events.push("not-ready");
        });
        const shutdown = jest.fn(async () => {
            events.push(readiness.isReady() ? "ready-at-shutdown" : "not-ready-at-shutdown");
        });
        const exit = jest.fn((code: number) => {
            events.push(`exit:${code}`);
        });
        const lifecycle = createFatalProcessLifecycle({
            markNotReady,
            shutdown,
            exit,
            logger: jest.fn(),
            shutdownTimeoutMs: 25,
        });

        await Promise.all([
            lifecycle.handleUncaughtException(new Error("uncaught")),
            lifecycle.handleUnhandledRejection("rejected", Promise.resolve()),
        ]);

        expect(markNotReady).toHaveBeenCalledTimes(1);
        expect(readiness.isReady()).toBe(false);
        expect(shutdown).toHaveBeenCalledTimes(1);
        expect(exit).toHaveBeenCalledTimes(1);
        expect(events).toEqual(["not-ready", "not-ready-at-shutdown", "exit:1"]);
    });

    it("exits after the shutdown timeout when application close never settles", async () => {
        const shutdown = jest.fn(() => new Promise<void>(() => undefined));
        const exit = jest.fn();
        const lifecycle = createFatalProcessLifecycle({
            markNotReady: jest.fn(),
            shutdown,
            exit,
            logger: jest.fn(),
            shutdownTimeoutMs: 1,
        });

        await lifecycle.handleUncaughtException(new Error("uncaught"));

        expect(shutdown).toHaveBeenCalledTimes(1);
        expect(exit).toHaveBeenCalledTimes(1);
        expect(exit).toHaveBeenCalledWith(1);
    });

    it("still requests exit when application shutdown rejects", async () => {
        const shutdown = jest.fn().mockRejectedValue(new Error("close failed"));
        const exit = jest.fn();
        const lifecycle = createFatalProcessLifecycle({
            markNotReady: jest.fn(),
            shutdown,
            exit,
            logger: jest.fn(),
        });

        await lifecycle.handleUnhandledRejection(
            new Error("rejected"),
            Promise.resolve(),
        );

        expect(shutdown).toHaveBeenCalledTimes(1);
        expect(exit).toHaveBeenCalledTimes(1);
        expect(exit).toHaveBeenCalledWith(1);
    });

    it("installs only the two fatal listeners and does not react to ordinary handled errors", async () => {
        const source = new EventEmitter() as unknown as FatalSignalSource;
        const markNotReady = jest.fn();
        const shutdown = jest.fn(async () => undefined);
        const exit = jest.fn();
        const lifecycle = createFatalProcessLifecycle({
            process: source,
            markNotReady,
            shutdown,
            exit,
        });

        lifecycle.install();
        lifecycle.install();
        (source as unknown as EventEmitter).emit("requestHandledError", new Error("handled"));

        expect((source as unknown as EventEmitter).listenerCount("uncaughtException")).toBe(1);
        expect((source as unknown as EventEmitter).listenerCount("unhandledRejection")).toBe(1);
        expect((source as unknown as EventEmitter).listenerCount("error")).toBe(0);
        expect(markNotReady).not.toHaveBeenCalled();
        expect(shutdown).not.toHaveBeenCalled();
        expect(exit).not.toHaveBeenCalled();

        lifecycle.dispose();
        expect((source as unknown as EventEmitter).listenerCount("uncaughtException")).toBe(0);
        expect((source as unknown as EventEmitter).listenerCount("unhandledRejection")).toBe(0);

        await lifecycle.handleUncaughtException(new Error("after dispose"));
        expect(markNotReady).toHaveBeenCalledTimes(1);
        expect(shutdown).toHaveBeenCalledTimes(1);
        expect(exit).toHaveBeenCalledTimes(1);
    });

    it("routes emitted fatal signals through the installed listeners", async () => {
        const source = new EventEmitter() as unknown as FatalSignalSource;
        const markNotReady = jest.fn();
        const shutdown = jest.fn(async () => undefined);
        const exit = jest.fn();
        const lifecycle = createFatalProcessLifecycle({
            process: source,
            markNotReady,
            shutdown,
            exit,
            logger: jest.fn(),
        });

        lifecycle.install();
        (source as unknown as EventEmitter).emit(
            "unhandledRejection",
            new Error("rejected"),
            Promise.resolve(),
        );
        await new Promise<void>((resolve) => setImmediate(resolve));

        expect(markNotReady).toHaveBeenCalledTimes(1);
        expect(shutdown).toHaveBeenCalledTimes(1);
        expect(exit).toHaveBeenCalledTimes(1);
        lifecycle.dispose();
    });
});
