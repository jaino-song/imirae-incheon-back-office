import assert from "node:assert/strict";
import { test } from "node:test";

import {
    ErrorCode,
    ManualCheckError,
    VercelDnsClient,
    VercelDnsClientError,
} from "../vercel-dns-client.mjs";

const PRIMARY_IP = "11.22.33.44";
const FALLBACK_IP = "55.66.77.88";
const TOKEN = "server-only-token";

function makeConfig(overrides = {}) {
    return {
        token: TOKEN,
        teamId: "team_test",
        recordId: "rec_test",
        primaryIpv4: PRIMARY_IP,
        fallbackIpv4: FALLBACK_IP,
        timeoutMs: 100,
        clock: () => 1_700_000_000_000,
        ...overrides,
    };
}

function makeRecord(value = PRIMARY_IP, overrides = {}) {
    return {
        id: "rec_test",
        slug: "team_test",
        name: "api",
        type: "A",
        value,
        ttl: 60,
        ...overrides,
    };
}

function makeList(records, next = null) {
    return {
        records,
        pagination: {
            count: records.length,
            next,
            prev: null,
        },
    };
}

function makeResponse(status, body, headers = {}) {
    const serialized = body === undefined ? "" : JSON.stringify(body);
    return {
        status,
        headers: new Headers({
            "content-type": "application/json",
            ...headers,
        }),
        text: async () => serialized,
    };
}

function makeRawResponse(status, body, headers = {}) {
    return {
        status,
        headers: new Headers({
            "content-type": "application/json",
            ...headers,
        }),
        text: async () => body,
    };
}

function makeFetch(sequence) {
    const pending = [...sequence];
    const calls = [];
    const fetchImpl = async (input, init) => {
        calls.push({ input: new URL(input), init });
        const next = pending[0];
        if (next instanceof Error) {
            pending.shift();
            throw next;
        }
        if (typeof next === "function") {
            return next({ input, init, calls });
        }
        pending.shift();
        if (next === undefined) {
            throw new Error("unexpected fetch call");
        }
        return next;
    };
    return { calls, fetchImpl };
}

function assertCode(error, code) {
    assert.ok(error instanceof VercelDnsClientError);
    assert.equal(error.code, code);
}

test("reads the team-scoped v5 endpoint with bearer authentication", async () => {
    const mock = makeFetch([makeResponse(200, makeList([makeRecord()]))]);
    const client = new VercelDnsClient(makeConfig({ fetch: mock.fetchImpl }));

    const record = await client.getCurrentRecord();

    assert.equal(record.value, PRIMARY_IP);
    assert.equal(mock.calls.length, 1);
    assert.equal(
        mock.calls[0].input.toString(),
        "https://api.vercel.com/v5/domains/babyjamjam.com/records?teamId=team_test&limit=100",
    );
    assert.equal(mock.calls[0].init.method, "GET");
    assert.equal(mock.calls[0].init.headers.get("authorization"), `Bearer ${TOKEN}`);
    assert.equal(mock.calls[0].init.headers.get("accept"), "application/json");
});

test("follows bounded pagination and finds the configured record", async () => {
    const mock = makeFetch([
        makeResponse(200, makeList([{ id: "rec_other", name: "www", type: "A", value: PRIMARY_IP, ttl: 60 }], 123)),
        makeResponse(200, makeList([makeRecord()])),
    ]);
    const client = new VercelDnsClient(makeConfig({ fetch: mock.fetchImpl }));

    await assert.doesNotReject(client.getCurrentRecord());
    assert.equal(mock.calls.length, 2);
    assert.equal(
        mock.calls[1].input.toString(),
        "https://api.vercel.com/v5/domains/babyjamjam.com/records?teamId=team_test&limit=100&since=123",
    );
});

test("rejects duplicate configured records across pages", async () => {
    const mock = makeFetch([
        makeResponse(200, makeList([makeRecord()], 123)),
        makeResponse(200, makeList([makeRecord()])),
    ]);
    const client = new VercelDnsClient(makeConfig({ fetch: mock.fetchImpl }));

    await assert.rejects(client.getCurrentRecord(), (error) => {
        assertCode(error, ErrorCode.RECORD_AMBIGUOUS);
        return true;
    });
});

test("rejects duplicate api A records with different IDs", async () => {
    const duplicate = makeRecord(PRIMARY_IP, { id: "rec_other" });
    const mock = makeFetch([makeResponse(200, makeList([makeRecord(), duplicate]))]);
    const client = new VercelDnsClient(makeConfig({ fetch: mock.fetchImpl }));

    await assert.rejects(client.getCurrentRecord(), (error) => {
        assertCode(error, ErrorCode.RECORD_AMBIGUOUS);
        return true;
    });
});

test("fails closed on a missing record or identity drift", async (t) => {
    await t.test("missing configured record", async () => {
        const mock = makeFetch([makeResponse(200, makeList([{ id: "rec_other", name: "www", type: "A", value: PRIMARY_IP, ttl: 60 }]))]);
        const client = new VercelDnsClient(makeConfig({ fetch: mock.fetchImpl }));
        await assert.rejects(client.getCurrentRecord(), (error) => {
            assertCode(error, ErrorCode.RECORD_NOT_FOUND);
            return true;
        });
    });
    await t.test("wrong name", async () => {
        const mock = makeFetch([makeResponse(200, makeList([makeRecord(PRIMARY_IP, { name: "www" })]))]);
        const client = new VercelDnsClient(makeConfig({ fetch: mock.fetchImpl }));
        await assert.rejects(client.getCurrentRecord(), (error) => {
            assertCode(error, ErrorCode.RECORD_AMBIGUOUS);
            return true;
        });
    });
    await t.test("wrong type", async () => {
        const mock = makeFetch([makeResponse(200, makeList([makeRecord(PRIMARY_IP, { type: "CNAME" })]))]);
        const client = new VercelDnsClient(makeConfig({ fetch: mock.fetchImpl }));
        await assert.rejects(client.getCurrentRecord(), (error) => {
            assertCode(error, ErrorCode.RECORD_AMBIGUOUS);
            return true;
        });
    });
    await t.test("wrong TTL", async () => {
        const mock = makeFetch([makeResponse(200, makeList([makeRecord(PRIMARY_IP, { ttl: 300 })]))]);
        const client = new VercelDnsClient(makeConfig({ fetch: mock.fetchImpl }));
        await assert.rejects(client.getCurrentRecord(), (error) => {
            assertCode(error, ErrorCode.DNS_DRIFT);
            return true;
        });
    });
    await t.test("unexpected current value", async () => {
        const mock = makeFetch([makeResponse(200, makeList([makeRecord("8.8.8.8")]))]);
        const client = new VercelDnsClient(makeConfig({ fetch: mock.fetchImpl }));
        await assert.rejects(client.getCurrentRecord(), (error) => {
            assertCode(error, ErrorCode.DNS_DRIFT);
            return true;
        });
    });
});

test("rejects private, reserved, malformed, and equal IPv4 configuration", async (t) => {
    for (const value of [
        "0.0.0.0",
        "10.0.0.1",
        "100.64.0.1",
        "127.0.0.1",
        "169.254.1.1",
        "172.16.0.1",
        "192.0.2.1",
        "192.168.1.1",
        "198.18.0.1",
        "198.51.100.1",
        "203.0.113.1",
        "224.0.0.1",
    ]) {
        await t.test(`rejects ${value}`, () => {
            assert.throws(
                () => new VercelDnsClient(makeConfig({ primaryIpv4: value })),
                (error) => {
                    assertCode(error, ErrorCode.IP_NOT_PUBLIC);
                    return true;
                },
            );
        });
    }
    await t.test("rejects malformed IPv4", () => {
        assert.throws(
            () => new VercelDnsClient(makeConfig({ primaryIpv4: "999.1.1.1" })),
            (error) => {
                assertCode(error, ErrorCode.IP_INVALID);
                return true;
            },
        );
    });
    await t.test("rejects leading zero octets", () => {
        assert.throws(
            () => new VercelDnsClient(makeConfig({ primaryIpv4: "011.22.33.44" })),
            (error) => {
                assertCode(error, ErrorCode.IP_INVALID);
                return true;
            },
        );
    });
    await t.test("rejects equal origins", () => {
        assert.throws(
            () => new VercelDnsClient(makeConfig({ fallbackIpv4: PRIMARY_IP })),
            (error) => {
                assertCode(error, ErrorCode.CONFIG_INVALID);
                return true;
            },
        );
    });
});

test("accepts only the fixed HTTPS api.vercel.com URL and rejects URL credentials", async (t) => {
    for (const baseUrl of [
        "http://api.vercel.com",
        "https://evil.example.com",
        "https://user:password@api.vercel.com",
        "https://api.vercel.com:443",
        "https://api.vercel.com/path",
    ]) {
        await t.test(`rejects ${baseUrl.replace(/password|user/gu, "redacted")}`, () => {
            assert.throws(
                () => new VercelDnsClient(makeConfig({ baseUrl })),
                (error) => {
                    assertCode(error, ErrorCode.CONFIG_INVALID);
                    assert.doesNotMatch(String(error), /password|user/iu);
                    return true;
                },
            );
        });
    }
});

test("updates only primary to fallback and verifies the read-after-write", async () => {
    const mock = makeFetch([
        makeResponse(200, makeList([makeRecord(PRIMARY_IP)])),
        makeResponse(200, { id: "rec_test", name: "api", type: "record", value: FALLBACK_IP, recordType: "A" }),
        makeResponse(200, makeList([makeRecord(FALLBACK_IP)])),
    ]);
    const client = new VercelDnsClient(makeConfig({ fetch: mock.fetchImpl }));

    const result = await client.switchToFallback();

    assert.equal(result.changed, true);
    assert.equal(result.reconciled, undefined);
    assert.equal(mock.calls.length, 3);
    assert.equal(mock.calls[1].init.method, "PATCH");
    assert.equal(mock.calls[1].input.toString(), "https://api.vercel.com/v1/domains/records/rec_test?teamId=team_test");
    assert.equal(mock.calls[1].init.body, JSON.stringify({ value: FALLBACK_IP }));
    assert.equal(mock.calls[1].init.headers.get("authorization"), `Bearer ${TOKEN}`);
    assert.equal(mock.calls[2].init.method, "GET");
});

test("does not issue a PATCH when the route is already fallback", async () => {
    const mock = makeFetch([makeResponse(200, makeList([makeRecord(FALLBACK_IP)]))]);
    const client = new VercelDnsClient(makeConfig({ fetch: mock.fetchImpl }));

    const result = await client.switchToFallback();

    assert.equal(result.changed, false);
    assert.equal(result.route, "FALLBACK_ACTIVE");
    assert.equal(mock.calls.length, 1);
});

test("has no automatic fallback-to-primary method", () => {
    const mock = makeFetch([]);
    const client = new VercelDnsClient(makeConfig({ fetch: mock.fetchImpl }));
    assert.equal("switchToPrimary" in client, false);
    assert.equal("failbackToPrimary" in client, false);
});

test("fails closed when current value is neither origin", async () => {
    const mock = makeFetch([makeResponse(200, makeList([makeRecord("8.8.8.8")]))]);
    const client = new VercelDnsClient(makeConfig({ fetch: mock.fetchImpl }));

    await assert.rejects(client.switchToFallback(), (error) => {
        assertCode(error, ErrorCode.DNS_DRIFT);
        return true;
    });
    assert.equal(mock.calls.length, 1);
});

test("handles GET 4xx without attempting a mutation", async () => {
    const mock = makeFetch([makeResponse(403, { error: { message: TOKEN } })]);
    const client = new VercelDnsClient(makeConfig({ fetch: mock.fetchImpl }));

    await assert.rejects(client.getCurrentRecord(), (error) => {
        assertCode(error, ErrorCode.HTTP_ERROR);
        assert.equal(error.status, 403);
        assert.doesNotMatch(String(error), new RegExp(TOKEN, "u"));
        return true;
    });
    assert.equal(mock.calls.length, 1);
});

test("treats a PATCH 4xx rejection as certain and does not reconcile", async () => {
    const mock = makeFetch([
        makeResponse(200, makeList([makeRecord(PRIMARY_IP)])),
        makeResponse(400, { error: { message: TOKEN } }),
    ]);
    const client = new VercelDnsClient(makeConfig({ fetch: mock.fetchImpl }));

    await assert.rejects(client.switchToFallback(), (error) => {
        assertCode(error, ErrorCode.HTTP_ERROR);
        assert.equal(error.status, 400);
        assert.doesNotMatch(String(error), new RegExp(TOKEN, "u"));
        return true;
    });
    assert.equal(mock.calls.filter((call) => call.init.method === "PATCH").length, 1);
    assert.equal(mock.calls.length, 2);
});

test("reconciles a 429 and succeeds only when fallback is observed", async () => {
    const mock = makeFetch([
        makeResponse(200, makeList([makeRecord(PRIMARY_IP)])),
        makeResponse(429, { error: { message: "rate limited" } }),
        makeResponse(200, makeList([makeRecord(FALLBACK_IP)])),
    ]);
    const client = new VercelDnsClient(makeConfig({ fetch: mock.fetchImpl }));

    const result = await client.switchToFallback();

    assert.equal(result.reconciled, true);
    assert.equal(mock.calls.filter((call) => call.init.method === "PATCH").length, 1);
    assert.equal(mock.calls.length, 3);
});

test("reconciles a 5xx and returns MANUAL_CHECK when fallback is not observed", async () => {
    const mock = makeFetch([
        makeResponse(200, makeList([makeRecord(PRIMARY_IP)])),
        makeResponse(503, { error: { message: "upstream" } }),
        makeResponse(200, makeList([makeRecord(PRIMARY_IP)])),
    ]);
    const client = new VercelDnsClient(makeConfig({ fetch: mock.fetchImpl }));

    await assert.rejects(client.switchToFallback(), (error) => {
        assert.ok(error instanceof ManualCheckError);
        assertCode(error, ErrorCode.MANUAL_CHECK);
        assert.equal(error.blocked, true);
        assert.doesNotMatch(String(error), /upstream/iu);
        return true;
    });
    assert.equal(mock.calls.filter((call) => call.init.method === "PATCH").length, 1);
    assert.equal(mock.calls.length, 3);
});

test("reconciles a timeout and succeeds when the accepted update is visible", async () => {
    let patchTimedOut = false;
    const mock = makeFetch([
        makeResponse(200, makeList([makeRecord(PRIMARY_IP)])),
        ({ calls }) => {
            if (!patchTimedOut && calls.length === 2) {
                patchTimedOut = true;
                return new Promise(() => {});
            }
            return makeResponse(200, makeList([makeRecord(FALLBACK_IP)]));
        },
    ]);
    const client = new VercelDnsClient(makeConfig({ fetch: mock.fetchImpl, timeoutMs: 10 }));

    const result = await client.switchToFallback();

    assert.equal(result.reconciled, true);
    assert.equal(mock.calls.filter((call) => call.init.method === "PATCH").length, 1);
    assert.equal(mock.calls.length, 3);
});

test("reconciles a network timeout and returns MANUAL_CHECK when fallback is absent", async () => {
    let patchTimedOut = false;
    const mock = makeFetch([
        makeResponse(200, makeList([makeRecord(PRIMARY_IP)])),
        ({ calls }) => {
            if (!patchTimedOut && calls.length === 2) {
                patchTimedOut = true;
                return new Promise(() => {});
            }
            return makeResponse(200, makeList([makeRecord(PRIMARY_IP)]));
        },
    ]);
    const client = new VercelDnsClient(makeConfig({ fetch: mock.fetchImpl, timeoutMs: 10 }));

    await assert.rejects(client.switchToFallback(), (error) => {
        assert.ok(error instanceof ManualCheckError);
        assertCode(error, ErrorCode.MANUAL_CHECK);
        return true;
    });
    assert.equal(mock.calls.filter((call) => call.init.method === "PATCH").length, 1);
    assert.equal(mock.calls.length, 3);
});

test("reconciles an accepted-but-invalid PATCH response without a second PATCH", async () => {
    const mock = makeFetch([
        makeResponse(200, makeList([makeRecord(PRIMARY_IP)])),
        makeRawResponse(200, "not-json"),
        makeResponse(200, makeList([makeRecord(FALLBACK_IP)])),
    ]);
    const client = new VercelDnsClient(makeConfig({ fetch: mock.fetchImpl }));

    const result = await client.switchToFallback();

    assert.equal(result.reconciled, true);
    assert.equal(mock.calls.filter((call) => call.init.method === "PATCH").length, 1);
    assert.equal(mock.calls.length, 3);
});

test("fails closed on read-after-write drift and never retries PATCH", async () => {
    const mock = makeFetch([
        makeResponse(200, makeList([makeRecord(PRIMARY_IP)])),
        makeResponse(200, { id: "rec_test", name: "api", type: "record", value: FALLBACK_IP, recordType: "A" }),
        makeResponse(200, makeList([makeRecord(PRIMARY_IP)])),
    ]);
    const client = new VercelDnsClient(makeConfig({ fetch: mock.fetchImpl }));

    await assert.rejects(client.switchToFallback(), (error) => {
        assertCode(error, ErrorCode.DNS_DRIFT);
        return true;
    });
    assert.equal(mock.calls.filter((call) => call.init.method === "PATCH").length, 1);
    assert.equal(mock.calls.length, 3);
});

test("reconciles an update timeout even when the provider reports 5xx", async () => {
    const mock = makeFetch([
        makeResponse(200, makeList([makeRecord(PRIMARY_IP)])),
        makeResponse(500, { error: { message: "provider failure" } }),
        makeResponse(200, makeList([makeRecord(FALLBACK_IP)])),
    ]);
    const client = new VercelDnsClient(makeConfig({ fetch: mock.fetchImpl }));

    const result = await client.switchToFallback();

    assert.equal(result.reconciled, true);
    assert.equal(mock.calls.filter((call) => call.init.method === "PATCH").length, 1);
});

test("bounds response size and does not leak response content", async () => {
    const oversized = "x".repeat(64 * 1024 + 1);
    const mock = makeFetch([makeResponse(200, oversized)]);
    const client = new VercelDnsClient(makeConfig({ fetch: mock.fetchImpl }));

    await assert.rejects(client.getCurrentRecord(), (error) => {
        assertCode(error, ErrorCode.RESPONSE_TOO_LARGE);
        assert.doesNotMatch(String(error), /x{20}/u);
        return true;
    });
});
