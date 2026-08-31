import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs/promises';
import { Readable } from 'node:stream';
import path from 'node:path';
import test from 'node:test';

import {
    DNS_ROLES,
    PHASES,
} from '../state-store.mjs';
import {
    verifyBoundedHealth,
} from '../probes.mjs';
import {
    WORKER_REASONS,
} from '../worker.mjs';
import {
    createController,
} from '../main.mjs';

const NOW = Date.parse('2026-08-31T00:00:00.000Z');
const SIGNING_KEY = 'integration-signing-key';
const INSTALLATION_ID = '00000000-0000-4000-8000-000000000010';
const PRIMARY_IP = '8.8.8.8';
const FALLBACK_IP = '1.1.1.1';

const VALID_ENV = Object.freeze({
    FAILOVER_CONTROLLER_ENABLED: 'true',
    FAILOVER_LIVE_SENTRY_PAYLOAD_CONTRACT_VERIFIED: 'true',
    FAILOVER_SENTRY_CLIENT_SECRET: SIGNING_KEY,
    FAILOVER_SENTRY_INSTALLATION_ID: INSTALLATION_ID,
    FAILOVER_SENTRY_ORGANIZATION_ID: '1234',
    FAILOVER_SENTRY_PROJECT_ID: '5678',
    FAILOVER_SENTRY_ALERT_ID: '91011',
    FAILOVER_PRIMARY_HEALTH_URL: 'https://api.babyjamjam.com/health/ready',
    FAILOVER_FALLBACK_HEALTH_URL: 'http://127.0.0.1:3101/health/ready',
    FAILOVER_VERCEL_API_TOKEN: 'integration-vercel-token',
    FAILOVER_VERCEL_TEAM_ID: 'team_test',
    FAILOVER_VERCEL_DNS_RECORD_ID: 'rec_test',
    FAILOVER_PRIMARY_IPV4: PRIMARY_IP,
    FAILOVER_FALLBACK_IPV4: FALLBACK_IP,
    FAILOVER_EXPECTED_IMAGE_TAG: 'a'.repeat(40),
    FAILOVER_EXPECTED_IMAGE_DIGEST: `sha256:${'b'.repeat(64)}`,
});

function eventPayload(eventId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', issueId = '424242') {
    return {
        action: 'triggered',
        actor: { type: 'application', id: 'sentry', name: 'Sentry' },
        data: {
            event: {
                event_id: eventId,
                issue_id: issueId,
                project: 5678,
                timestamp: NOW / 1000,
                datetime: new Date(NOW).toISOString(),
            },
            triggered_rule: 'Fallback Server Uptime outage',
            issue_alert: { id: 91011, title: 'Fallback Server Uptime outage', settings: [] },
        },
        installation: { uuid: INSTALLATION_ID },
    };
}

function signedRequest(payload = eventPayload(), overrides = {}) {
    const body = JSON.stringify(payload);
    const signature = createHmac('sha256', SIGNING_KEY).update(body, 'utf8').digest('hex');
    return {
        body,
        headers: {
            'content-type': 'application/json',
            'request-id': 'provider-request-1',
            'sentry-hook-resource': 'event_alert',
            'sentry-hook-timestamp': String(Math.floor(NOW / 1000)),
            'sentry-hook-signature': signature,
            ...overrides,
        },
    };
}

function mockRequest({ method = 'POST', url = '/sentry/uptime-alert', body = '', headers = {} } = {}) {
    const requestStream = Readable.from(body === '' ? [] : [Buffer.from(body, 'utf8')]);
    requestStream.method = method;
    requestStream.url = url;
    requestStream.headers = headers;
    return requestStream;
}

function mockResponse() {
    return {
        headersSent: false,
        statusCode: 0,
        headers: {},
        setHeader(name, value) {
            this.headers[name.toLowerCase()] = value;
        },
        end(value) {
            this.headersSent = true;
            this.body = value;
        },
    };
}

async function invoke(handler, request) {
    const req = mockRequest({
        body: request.body,
        headers: { ...request.headers, 'content-length': String(Buffer.byteLength(request.body)) },
    });
    const res = mockResponse();
    await handler(req, res);
    return {
        req,
        res,
        json: res.body ? JSON.parse(res.body) : undefined,
    };
}

function listResponse(value) {
    return {
        records: [{
            id: 'rec_test',
            slug: 'team_test',
            name: 'api',
            type: 'A',
            value,
            creator: 'integration',
            created: NOW,
            updated: NOW,
            createdAt: NOW,
            updatedAt: NOW,
            ttl: 60,
            comment: 'integration',
        }],
        pagination: { count: 1, next: null, prev: null },
    };
}

function response(status, body) {
    return {
        status,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => (body === undefined ? '' : JSON.stringify(body)),
    };
}

function healthyFallbackStatus() {
    return {
        environment: 'fallback-server',
        releaseHealthy: true,
        containerHealthy: true,
        restartCount: 0,
        dbReady: true,
        productionDbIdentityCertified: true,
        passiveGatesHealthy: true,
        schedulersEnabled: false,
        documentJobsAccepting: false,
        documentJobsWorker: false,
        publicRoutingManaged: false,
    };
}

function healthVerifier({ fallbackStatus = 'ok' } = {}) {
    const calls = { primary: 0, fallback: 0 };
    const verifyHealth = async () => verifyBoundedHealth({
        probePrimary: async () => {
            calls.primary += 1;
            return { status: 'failed', reason: 'REQUEST_FAILED' };
        },
        probeFallback: async () => {
            calls.fallback += 1;
            return fallbackStatus === 'failed'
                ? { status: 'failed', reason: 'REQUEST_FAILED' }
                : { status: fallbackStatus };
        },
        intervalMs: 0,
        sleep: async () => {},
        clock: () => NOW,
    });
    return { calls, verifyHealth };
}

function makeFakeHttpModule() {
    const state = { server: undefined };
    class FakeServer extends EventEmitter {
        listening = false;

        constructor(receiver) {
            super();
            this.requestHandler = receiver;
        }

        listen(options) {
            this.listenOptions = options;
            queueMicrotask(() => {
                this.listening = true;
                this.emit('listening');
            });
        }

        close(callback) {
            this.listening = false;
            callback();
        }

        address() {
            return { address: '127.0.0.1', family: 'IPv4', port: 3102 };
        }

        closeAllConnections() {}
    }
    return {
        state,
        httpModule: {
            createServer(receiver) {
                state.server = new FakeServer(receiver);
                return state.server;
            },
        },
    };
}

async function makeTempState() {
    const parentDir = await fs.mkdtemp(path.join('/tmp', 'babyjamjam-failover-integration-'));
    return {
        parentDir,
        statePath: path.join(parentDir, 'state.json'),
    };
}

async function cleanupTempState(parentDir) {
    await fs.rm(parentDir, { recursive: true, force: true });
}

function makeControllerOptions(state, overrides = {}) {
    let dnsValue = PRIMARY_IP;
    let patchCalls = 0;
    const dnsRequests = [];
    const releaseExpectations = {};
    const vercelFetch = async (input, init) => {
        const url = new URL(input);
        dnsRequests.push({ url, init });
        if (init.method === 'PATCH') {
            patchCalls += 1;
            assert.equal(init.body, JSON.stringify({ value: FALLBACK_IP }));
            dnsValue = FALLBACK_IP;
            return response(200, {
                id: 'rec_test',
                name: 'api',
                type: 'record',
                value: FALLBACK_IP,
                recordType: 'A',
            });
        }
        return response(200, listResponse(dnsValue));
    };
    const health = healthVerifier(overrides.health ?? {});
    const options = {
        env: VALID_ENV,
        statePath: state.statePath,
        parentDir: state.parentDir,
        productionMode: false,
        clock: () => NOW,
        vercelFetch,
        verifyHealth: health.verifyHealth,
        readFallbackStatus: async ({ expectedImageTag, expectedImageDigest }) => {
            releaseExpectations.expectedImageTag = expectedImageTag;
            releaseExpectations.expectedImageDigest = expectedImageDigest;
            return healthyFallbackStatus();
        },
        sleep: async () => {},
        autoResume: overrides.autoResume ?? true,
        ...overrides,
    };
    delete options.health;
    return {
        options,
        healthCalls: health.calls,
        dnsRequests,
        releaseExpectations,
        get patchCalls() {
            return patchCalls;
        },
    };
}

test('composes signed webhook -> durable state -> 3/3 probes -> one DNS PATCH -> FALLBACK_ACTIVE', async () => {
    const state = await makeTempState();
    const fixture = makeControllerOptions(state);
    const controller = createController(fixture.options);
    try {
        const initial = await controller.stateStore.create({ armed: true, at: NOW });
        assert.equal(initial.phase, PHASES.AWS_ACTIVE);
        assert.equal(initial.armed, true);

        const received = await invoke(controller.server.listeners('request')[0], signedRequest());
        assert.equal(received.res.statusCode, 202);
        assert.deepEqual(received.json, { accepted: true, duplicate: false });

        await controller.waitForIdle();
        const finalState = await controller.stateStore.read();
        assert.equal(finalState.phase, PHASES.FALLBACK_ACTIVE);
        assert.equal(finalState.currentDnsRole, DNS_ROLES.FALLBACK);
        assert.equal(fixture.healthCalls.primary, 3);
        assert.equal(fixture.healthCalls.fallback, 3);
        assert.equal(fixture.releaseExpectations.expectedImageTag, VALID_ENV.FAILOVER_EXPECTED_IMAGE_TAG);
        assert.equal(fixture.releaseExpectations.expectedImageDigest, VALID_ENV.FAILOVER_EXPECTED_IMAGE_DIGEST);
        assert.equal(fixture.patchCalls, 1);
        assert.equal(fixture.dnsRequests.filter(({ init }) => init.method === 'PATCH').length, 1);
    } finally {
        await controller.stop();
        await cleanupTempState(state.parentDir);
    }
});

test('duplicate signed webhook is durably ignored without a second DNS PATCH', async () => {
    const state = await makeTempState();
    const fixture = makeControllerOptions(state);
    const controller = createController(fixture.options);
    try {
        await controller.stateStore.create({ armed: true, at: NOW });
        const request = signedRequest();
        await invoke(controller.server.listeners('request')[0], request);
        await controller.waitForIdle();
        const duplicate = await invoke(controller.server.listeners('request')[0], request);
        assert.equal(duplicate.res.statusCode, 202);
        assert.deepEqual(duplicate.json, { accepted: true, duplicate: true });
        assert.equal(fixture.patchCalls, 1);
    } finally {
        await controller.stop();
        await cleanupTempState(state.parentDir);
    }
});

test('disarmed controller durably claims but does not verify or mutate DNS', async () => {
    const state = await makeTempState();
    const fixture = makeControllerOptions(state);
    const controller = createController(fixture.options);
    try {
        const initial = await controller.stateStore.create({ armed: false, at: NOW });
        const received = await invoke(controller.server.listeners('request')[0], signedRequest());
        assert.equal(received.res.statusCode, 202);
        await controller.waitForIdle();
        const finalState = await controller.stateStore.read();
        assert.equal(finalState.phase, PHASES.AWS_ACTIVE);
        assert.equal(finalState.armed, false);
        assert.equal(fixture.patchCalls, 0);
        assert.match(finalState.lastEventFingerprint, /^[0-9a-f]{64}$/);
        assert.equal(finalState.generation, initial.generation + 1);
    } finally {
        await controller.stop();
        await cleanupTempState(state.parentDir);
    }
});

test('both origins down blocks and leaves DNS unchanged', async () => {
    const state = await makeTempState();
    const fixture = makeControllerOptions(state, { health: { fallbackStatus: 'failed' } });
    const controller = createController(fixture.options);
    try {
        await controller.stateStore.create({ armed: true, at: NOW });
        await invoke(controller.server.listeners('request')[0], signedRequest());
        await controller.waitForIdle();
        const finalState = await controller.stateStore.read();
        assert.equal(finalState.phase, PHASES.BLOCKED);
        assert.equal(finalState.currentDnsRole, DNS_ROLES.AWS);
        assert.equal(finalState.terminalReason, WORKER_REASONS.BOTH_ORIGINS_DOWN);
        assert.equal(fixture.patchCalls, 0);
    } finally {
        await controller.stop();
        await cleanupTempState(state.parentDir);
    }
});

test('ambiguous DNS response reconciles once and blocks as manual check when fallback is absent', async () => {
    const state = await makeTempState();
    const fixture = makeControllerOptions(state);
    const originalFetch = fixture.options.vercelFetch;
    fixture.options.vercelFetch = async (input, init) => {
        const url = new URL(input);
        fixture.dnsRequests.push({ url, init });
        if (init.method === 'PATCH') {
            return response(503, { error: { message: 'provider unavailable' } });
        }
        return response(200, listResponse(PRIMARY_IP));
    };
    const controller = createController(fixture.options);
    try {
        await controller.stateStore.create({ armed: true, at: NOW });
        await invoke(controller.server.listeners('request')[0], signedRequest());
        await controller.waitForIdle();
        const finalState = await controller.stateStore.read();
        assert.equal(finalState.phase, PHASES.BLOCKED);
        assert.equal(finalState.terminalReason, WORKER_REASONS.DNS_AMBIGUOUS);
        assert.equal(fixture.dnsRequests.filter(({ init }) => init.method === 'PATCH').length, 1);
        assert.notEqual(originalFetch, fixture.options.vercelFetch);
    } finally {
        await controller.stop();
        await cleanupTempState(state.parentDir);
    }
});

test('startup resumes only a persisted VERIFYING incident and completes promotion', async () => {
    const state = await makeTempState();
    const firstFixture = makeControllerOptions(state, { autoResume: false });
    const first = createController(firstFixture.options);
    let second;
    try {
        await first.stateStore.create({ armed: true, at: NOW });
        const received = await invoke(first.server.listeners('request')[0], signedRequest());
        assert.equal(received.res.statusCode, 202);
        const verifying = await first.stateStore.read();
        assert.equal(verifying.phase, PHASES.VERIFYING);
        assert.ok(verifying.pendingIncident);
        await first.stop();

        const secondFixture = makeControllerOptions(state, { autoResume: false });
        const fake = makeFakeHttpModule();
        secondFixture.options.httpModule = fake.httpModule;
        second = createController(secondFixture.options);
        await second.start();
        await second.waitForIdle();
        const finalState = await second.stateStore.read();
        assert.equal(finalState.phase, PHASES.FALLBACK_ACTIVE);
        assert.equal(finalState.currentDnsRole, DNS_ROLES.FALLBACK);
        assert.equal(secondFixture.patchCalls, 1);
        assert.deepEqual(fake.state.server.listenOptions, { host: '127.0.0.1', port: 3102 });
    } finally {
        await first.stop();
        if (second) await second.stop();
        await cleanupTempState(state.parentDir);
    }
});

test('invalid signature is rejected before durable claim', async () => {
    const state = await makeTempState();
    const fixture = makeControllerOptions(state);
    const controller = createController(fixture.options);
    try {
        await controller.stateStore.create({ armed: true, at: NOW });
        const request = signedRequest(eventPayload(), { 'sentry-hook-signature': '0'.repeat(64) });
        const received = await invoke(controller.server.listeners('request')[0], request);
        assert.equal(received.res.statusCode, 401);
        assert.deepEqual(received.json, { accepted: false, statusCode: 401 });
        const finalState = await controller.stateStore.read();
        assert.equal(finalState.phase, PHASES.AWS_ACTIVE);
        assert.equal(finalState.replayFingerprints.length, 0);
        assert.equal(fixture.patchCalls, 0);
    } finally {
        await controller.stop();
        await cleanupTempState(state.parentDir);
    }
});

test('disabled-by-default controller never creates state or promotes a route', async () => {
    const state = await makeTempState();
    const controller = createController({
        env: {},
        statePath: state.statePath,
        parentDir: state.parentDir,
        productionMode: false,
    });
    try {
        const healthReq = mockRequest({ method: 'GET', url: '/health' });
        const healthRes = mockResponse();
        await controller.server.listeners('request')[0](healthReq, healthRes);
        assert.equal(healthRes.statusCode, 200);
        assert.deepEqual(JSON.parse(healthRes.body), { status: 'disabled' });
        assert.equal(await fs.stat(state.statePath).catch(() => undefined), undefined);
    } finally {
        await controller.stop();
        await cleanupTempState(state.parentDir);
    }
});

test('disabled health and POST responses stay generic, and live-contract gate blocks arming', async () => {
    const state = await makeTempState();
    const disabled = createController({
        env: {},
        statePath: state.statePath,
        parentDir: state.parentDir,
        productionMode: false,
    });
    try {
        const healthReq = mockRequest({ method: 'GET', url: '/health' });
        const healthRes = mockResponse();
        await disabled.server.listeners('request')[0](healthReq, healthRes);
        assert.equal(healthRes.statusCode, 200);
        assert.deepEqual(JSON.parse(healthRes.body), { status: 'disabled' });

        const postReq = mockRequest({ method: 'POST', url: '/sentry/uptime-alert', body: '{}', headers: { 'content-type': 'application/json', 'content-length': '2' } });
        const postRes = mockResponse();
        await disabled.server.listeners('request')[0](postReq, postRes);
        assert.equal(postRes.statusCode, 503);
        assert.deepEqual(JSON.parse(postRes.body), { accepted: false, statusCode: 503 });
    } finally {
        await disabled.stop();
        await cleanupTempState(state.parentDir);
    }
    assert.throws(
        () => createController({
            env: { ...VALID_ENV, FAILOVER_LIVE_SENTRY_PAYLOAD_CONTRACT_VERIFIED: 'false' },
            statePath: state.statePath,
            parentDir: state.parentDir,
            productionMode: false,
        }),
        (error) => error.code === 'CONFIG_PAYLOAD_CONTRACT_REQUIRED',
    );
});

test('clean shutdown is bounded and fixed loopback binding is preserved', async () => {
    const state = await makeTempState();
    const fake = makeFakeHttpModule();
    const controller = createController({
        env: {},
        statePath: state.statePath,
        parentDir: state.parentDir,
        productionMode: false,
        httpModule: fake.httpModule,
    });
    try {
        await controller.start();
        assert.deepEqual(controller.address(), { address: '127.0.0.1', family: 'IPv4', port: 3102 });
        await controller.stop();
        await controller.stop();
        assert.equal(fake.state.server.listening, false);
    } finally {
        await controller.stop();
        await cleanupTempState(state.parentDir);
    }
});
