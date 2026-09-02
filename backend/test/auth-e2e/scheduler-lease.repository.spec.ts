import { randomUUID } from "node:crypto";

import { PrismaService } from "infrastructure/database/prisma.service";
import { SbSchedulerLeaseRepository } from "infrastructure/database/repositories/sb.scheduler-lease.repository";

/**
 * Real-Postgres proof that the single-statement lease (INSERT ... ON CONFLICT
 * DO UPDATE ... WHERE ... RETURNING in SbSchedulerLeaseRepository) behaves as
 * designed when two independent repository instances ("hosts") compete for
 * the same lease row. The unit spec for this repository only asserts the SQL
 * text; this is the only test that exercises the statement against a real
 * database clock and real row-level contention.
 */

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const A = { holderId: "host-a", instanceId: "a-1" };
const A2 = { holderId: "host-a", instanceId: "a-2" };
const B = { holderId: "host-b", instanceId: "b-1" };

const TTL_SECONDS = 2;
const TAKEOVER_AFTER_SECONDS = 1;

describe("SbSchedulerLeaseRepository (real Postgres, two competing hosts)", () => {
    const prisma = new PrismaService();
    const hostA = new SbSchedulerLeaseRepository(prisma);
    // Same connection is fine — the lease is decided by the row (via
    // ON CONFLICT ... WHERE), not by which client issued the statement.
    const hostB = new SbSchedulerLeaseRepository(prisma);

    const leaseName = `lease-test-${randomUUID()}`;

    afterAll(async () => {
        await prisma.scheduler_lease.deleteMany({ where: { name: leaseName } });
        await prisma.$disconnect();
    });

    it("proves migrations were applied: the background-owner seed row exists", async () => {
        const seeded = await hostA.read("background-owner");
        expect(seeded).not.toBeNull();
    });

    it("returns null for a lease name that has never been acquired", async () => {
        const result = await hostA.read(`no-such-lease-${randomUUID()}`);
        expect(result).toBeNull();
    });

    it("step 1: A acquires a fresh lease", async () => {
        const result = await hostA.acquireOrRenew({
            name: leaseName,
            ...A,
            ttlSeconds: TTL_SECONDS,
            takeoverAfterSeconds: TAKEOVER_AFTER_SECONDS,
        });

        expect(result.acquired).toBe(true);
        expect(result.dbNow).not.toBeNull();
        expect(result.expiresAt).not.toBeNull();
        const deltaMs = result.expiresAt!.getTime() - result.dbNow!.getTime();
        expect(deltaMs).toBeGreaterThanOrEqual(TTL_SECONDS * 1000 - 500);
        expect(deltaMs).toBeLessThanOrEqual(TTL_SECONDS * 1000 + 500);

        const record = await hostA.read(leaseName);
        expect(record?.holderId).toBe(A.holderId);
        expect(record?.instanceId).toBe(A.instanceId);
    });

    it("step 2: B cannot acquire while A's lease is live", async () => {
        // Renew A right here so the assertion does not depend on how long ago step 1 ran.
        const renewed = await hostA.acquireOrRenew({
            name: leaseName,
            ...A,
            ttlSeconds: TTL_SECONDS,
            takeoverAfterSeconds: TAKEOVER_AFTER_SECONDS,
        });
        expect(renewed.acquired).toBe(true);

        const result = await hostB.acquireOrRenew({
            name: leaseName,
            ...B,
            ttlSeconds: TTL_SECONDS,
            takeoverAfterSeconds: TAKEOVER_AFTER_SECONDS,
        });

        expect(result).toEqual({ acquired: false, expiresAt: null, dbNow: null });

        const record = await hostA.read(leaseName);
        expect(record?.holderId).toBe(A.holderId);
        expect(record?.instanceId).toBe(A.instanceId);
    });

    it("step 3: A renews its own lease; acquiredAt is unchanged, renewedAt advances", async () => {
        const before = await hostA.read(leaseName);
        expect(before).not.toBeNull();

        const result = await hostA.acquireOrRenew({
            name: leaseName,
            ...A,
            ttlSeconds: TTL_SECONDS,
            takeoverAfterSeconds: TAKEOVER_AFTER_SECONDS,
        });
        expect(result.acquired).toBe(true);

        const after = await hostA.read(leaseName);
        expect(after?.acquiredAt.getTime()).toBe(before!.acquiredAt.getTime());
        expect(after!.renewedAt.getTime()).toBeGreaterThanOrEqual(before!.renewedAt.getTime());
    });

    it("step 4: A2 (same holder, other instance) cannot take over immediately", async () => {
        // Renew A right here: the takeover window is only 1 s, so relying on step 3's
        // timestamp would make this assertion depend on scheduling between it() blocks.
        const renewed = await hostA.acquireOrRenew({
            name: leaseName,
            ...A,
            ttlSeconds: TTL_SECONDS,
            takeoverAfterSeconds: TAKEOVER_AFTER_SECONDS,
        });
        expect(renewed.acquired).toBe(true);

        const result = await hostB.acquireOrRenew({
            name: leaseName,
            ...A2,
            ttlSeconds: TTL_SECONDS,
            takeoverAfterSeconds: TAKEOVER_AFTER_SECONDS,
        });

        expect(result.acquired).toBe(false);
    });

    it("step 5: after the takeover window elapses, A2 takes over and gets a fresh acquiredAt", async () => {
        // Re-renew A first so the TTL clock is fresh before sleeping past the
        // (much shorter) takeover window.
        const renewed = await hostA.acquireOrRenew({
            name: leaseName,
            ...A,
            ttlSeconds: TTL_SECONDS,
            takeoverAfterSeconds: TAKEOVER_AFTER_SECONDS,
        });
        expect(renewed.acquired).toBe(true);

        await sleep(1200);

        const result = await hostB.acquireOrRenew({
            name: leaseName,
            ...A2,
            ttlSeconds: TTL_SECONDS,
            takeoverAfterSeconds: TAKEOVER_AFTER_SECONDS,
        });
        expect(result.acquired).toBe(true);

        const record = await hostA.read(leaseName);
        expect(record).not.toBeNull();
        expect(record?.instanceId).toBe(A2.instanceId);
        // "acquiredAt reset" = the acquisition just happened, i.e. acquiredAt
        // is close to the DB clock at read time — not the acquiredAt carried
        // over from A's original acquisition (which by now is well over 1.2s
        // old). Compare against dbNow from the same read rather than the
        // earlier acquireOrRenew's expiresAt, to avoid relying on exact
        // millisecond equality across two independently-serialized timestamps.
        const acquiredAgeMs = record!.dbNow.getTime() - record!.acquiredAt.getTime();
        expect(acquiredAgeMs).toBeGreaterThanOrEqual(0);
        expect(acquiredAgeMs).toBeLessThan(1000);
    });

    it("step 6: the old instance (A) is now locked out — taken over by its own successor", async () => {
        // A2 renews right here so A's same-holder takeover window is provably not open.
        const renewed = await hostB.acquireOrRenew({
            name: leaseName,
            ...A2,
            ttlSeconds: TTL_SECONDS,
            takeoverAfterSeconds: TAKEOVER_AFTER_SECONDS,
        });
        expect(renewed.acquired).toBe(true);

        const result = await hostA.acquireOrRenew({
            name: leaseName,
            ...A,
            ttlSeconds: TTL_SECONDS,
            takeoverAfterSeconds: TAKEOVER_AFTER_SECONDS,
        });

        expect(result.acquired).toBe(false);
    });

    it("step 7: A2 releases; B can then acquire the now-expired lease", async () => {
        const released = await hostA.release(leaseName, A2);
        expect(released).toBe(true);

        const record = await hostA.read(leaseName);
        expect(record?.expiresAt.getTime()).toBeLessThanOrEqual(record!.dbNow.getTime());

        const result = await hostB.acquireOrRenew({
            name: leaseName,
            ...B,
            ttlSeconds: TTL_SECONDS,
            takeoverAfterSeconds: TAKEOVER_AFTER_SECONDS,
        });
        expect(result.acquired).toBe(true);
    });

    it("step 8: release with the wrong identity is a no-op", async () => {
        const released = await hostA.release(leaseName, A);
        expect(released).toBe(false);

        const record = await hostA.read(leaseName);
        expect(record?.holderId).toBe(B.holderId);
    });

    it("step 9: once B's TTL lapses without renewal, A can acquire the expired lease", async () => {
        await sleep(2300);

        const result = await hostA.acquireOrRenew({
            name: leaseName,
            ...A,
            ttlSeconds: TTL_SECONDS,
            takeoverAfterSeconds: TAKEOVER_AFTER_SECONDS,
        });

        expect(result.acquired).toBe(true);
    });
});
