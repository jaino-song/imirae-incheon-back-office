import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { parseControllerConfig } from './config.mjs';
import { getFallbackStatus } from './fallback-status.mjs';
import { evaluateFailoverPolicy } from './policy.mjs';
import { verifyBoundedHealth } from './probes.mjs';
import { createControllerServer } from './server.mjs';
import { createStateStore } from './state-store.mjs';
import { createFailoverWorker } from './worker.mjs';
import { VercelDnsClient } from './vercel-dns-client.mjs';

const SHUTDOWN_TIMEOUT_MS = 5_000;

function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertFunction(value, name) {
    if (typeof value !== 'function') {
        throw new TypeError(`${name} must be a function`);
    }
}

function withTimeout(promise, timeoutMs) {
    let timer;
    const timeout = new Promise((resolve) => {
        timer = setTimeout(() => resolve(undefined), timeoutMs);
    });
    return Promise.race([promise, timeout]).finally(() => {
        if (timer !== undefined) clearTimeout(timer);
    });
}

function resolveProductionMode(options) {
    if (options.productionMode !== undefined) {
        if (typeof options.productionMode !== 'boolean') {
            throw new TypeError('productionMode must be a boolean');
        }
        return options.productionMode;
    }
    const hasTestInjection = options.statePath !== undefined
        || options.parentDir !== undefined
        || options.fsModule !== undefined
        || options.stateStore !== undefined
        || options.testMode === true;
    return !hasTestInjection;
}

function resolveStateStore(config, options, productionMode, clock) {
    if (productionMode && options.stateStore !== undefined) {
        throw new TypeError('stateStore injection is test-only');
    }
    if (productionMode && options.fsModule !== undefined) {
        throw new TypeError('fsModule injection is test-only');
    }
    if (productionMode && options.statePath !== undefined && options.statePath !== config.statePath) {
        throw new TypeError('production state path is fixed');
    }
    if (productionMode && options.parentDir !== undefined && options.parentDir !== path.dirname(config.statePath)) {
        throw new TypeError('production state parent is fixed');
    }
    if (productionMode && options.requireRootOwnership === false) {
        throw new TypeError('production state ownership checks are required');
    }
    if (options.stateStore !== undefined) {
        if (!isRecord(options.stateStore)) throw new TypeError('stateStore must be an object');
        return options.stateStore;
    }
    const statePath = options.statePath ?? config.statePath;
    const parentDir = options.parentDir;
    return createStateStore({
        statePath,
        parentDir,
        productionMode,
        requireRootOwnership: productionMode ? true : options.requireRootOwnership ?? false,
        fsModule: options.fsModule,
        now: clock,
        lockTimeoutMs: options.lockTimeoutMs,
    });
}

function resolveDnsClient(config, options, clock) {
    if (options.dnsClient !== undefined) {
        if (!isRecord(options.dnsClient)) throw new TypeError('dnsClient must be an object');
        return options.dnsClient;
    }
    if (!config.enabled) return undefined;
    return new VercelDnsClient({
        vercelToken: config.vercelApiToken,
        teamId: config.vercelTeamId,
        recordId: config.vercelDnsRecordId,
        primaryIpv4: config.primaryIpv4,
        fallbackIpv4: config.fallbackIpv4,
        fetch: options.vercelFetch,
        clock,
    });
}

function resolveWorker(config, options, stateStore, dnsClient, clock) {
    if (!config.enabled) return undefined;
    return createFailoverWorker({
        stateStore,
        dnsClient,
        verifyHealth: options.verifyHealth ?? options.healthVerifier ?? verifyBoundedHealth,
        readFallbackStatus: options.readFallbackStatus ?? options.fallbackStatus ?? getFallbackStatus,
        evaluatePolicy: options.evaluatePolicy ?? options.policy ?? evaluateFailoverPolicy,
        fallbackStatusRunner: options.fallbackStatusRunner,
        expectedImageTag: options.expectedImageTag,
        expectedImageDigest: options.expectedImageDigest,
        primaryIpv4: config.primaryIpv4,
        fallbackIpv4: config.fallbackIpv4,
        healthConfig: options.healthConfig ?? {
            primaryReadinessUrl: config.primaryHealthUrl,
            fallbackReadinessUrl: config.fallbackHealthUrl,
        },
        fetch: options.fetch,
        sleep: options.sleep,
        clock,
        autoResume: options.autoResume ?? true,
        dnsTargetResolver: options.dnsTargetResolver,
    });
}

function installSignalHandlers(controller, processModule) {
    if (!processModule || typeof processModule.on !== 'function') return () => {};
    let stopping;
    const onSignal = () => {
        if (!stopping) {
            stopping = controller.stop().catch(() => undefined);
        }
    };
    processModule.on('SIGINT', onSignal);
    processModule.on('SIGTERM', onSignal);
    return () => {
        processModule.off?.('SIGINT', onSignal);
        processModule.off?.('SIGTERM', onSignal);
    };
}

/**
 * Compose the disabled-by-default controller. Construction never starts a
 * listener, arms state, resumes a route, or performs a DNS operation.
 */
export function createController(options = {}) {
    if (!isRecord(options)) throw new TypeError('options must be an object');
    const config = options.config ?? parseControllerConfig(options.env);
    if (!isRecord(config)) throw new TypeError('config must be an object');
    const clock = options.clock ?? (() => Date.now());
    assertFunction(clock, 'clock');

    const productionMode = resolveProductionMode(options);
    const stateStore = config.enabled
        ? resolveStateStore(config, options, productionMode, clock)
        : options.stateStore;
    const dnsClient = resolveDnsClient(config, options, clock);
    const worker = config.enabled
        ? resolveWorker(config, options, stateStore, dnsClient, clock)
        : undefined;
    if (config.enabled && !worker) throw new TypeError('enabled controller worker is required');

    const resumePending = worker
        ? () => worker.resumePending()
        : async () => undefined;
    const acceptAuthenticatedEvent = worker
        ? (event) => worker.acceptAuthenticatedEvent(event)
        : undefined;
    const serverController = createControllerServer({
        config,
        acceptAuthenticatedEvent,
        resumePending,
        now: clock,
        httpModule: options.httpModule,
        serverFactory: options.serverFactory,
    });

    let stopped = false;
    let stopping;
    async function stop() {
        if (stopping) return stopping;
        stopping = (async () => {
            await serverController.stop();
            if (worker) await withTimeout(worker.waitForIdle(), SHUTDOWN_TIMEOUT_MS);
            stopped = true;
        })();
        return stopping;
    }

    async function start() {
        if (stopped) throw new Error('controller has been stopped');
        if (worker) {
            await stateStore.create({ armed: false, at: clock() });
        }
        await serverController.start();
        return controller;
    }

    const controller = Object.freeze({
        config,
        stateStore,
        dnsClient,
        worker,
        server: serverController.server,
        start,
        stop,
        address: serverController.address,
        waitForIdle: () => worker?.waitForIdle(),
        installSignalHandlers: (processModule = process) => installSignalHandlers(controller, processModule),
    });
    return controller;
}

export const createFailoverController = createController;

export async function startController(options = {}) {
    const controller = createController(options);
    await controller.start();
    return controller;
}

export const startFailoverController = startController;

function isDirectExecution() {
    if (!process.argv[1]) return false;
    return import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isDirectExecution()) {
    const runningController = createController();
    runningController.installSignalHandlers(process);
    runningController.start().catch(() => {
        process.exitCode = 1;
    });
}
