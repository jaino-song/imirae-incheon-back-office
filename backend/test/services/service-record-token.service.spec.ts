import {
    SERVICE_RECORD_PHONE_CHALLENGE_WINDOW_MS,
    ServiceRecordTokenService,
} from "../../application/services/service-record-token.service";

/** Minimal in-memory fake of the prisma service_record_token delegate. */
function makePrismaMock() {
    const rows: any[] = [];
    let seq = 0;
    const prisma = {
        __rows: rows,
        service_record_token: {
            create: jest.fn(async ({ data }: any) => {
                const row = {
                    id: `id${++seq}`,
                    active: true,
                    revokedAt: null,
                    verifiedAt: null,
                    failedAttempts: 0,
                    challengeWindowStartedAt: null,
                    lockedAt: null,
                    accessTokenHash: null,
                    ...data,
                };
                rows.push(row);
                return row;
            }),
            findUnique: jest.fn(async ({ where }: any) => {
                if (where.linkTokenHash) return rows.find((r) => r.linkTokenHash === where.linkTokenHash) ?? null;
                if (where.accessTokenHash) return rows.find((r) => r.accessTokenHash === where.accessTokenHash) ?? null;
                if (where.id) return rows.find((r) => r.id === where.id) ?? null;
                return null;
            }),
            findFirst: jest.fn(async ({ where }: any) => {
                return [...rows].reverse().find((r) => (
                    (where.branchId === undefined || r.branchId === where.branchId)
                    && (where.scheduleId === undefined || r.scheduleId === where.scheduleId)
                    && (where.employeeId === undefined || r.employeeId === where.employeeId)
                    && (where.expectedPhoneHash === undefined || r.expectedPhoneHash === where.expectedPhoneHash)
                    && (where.active === undefined || r.active === where.active)
                    && (where.revokedAt === undefined || r.revokedAt === where.revokedAt)
                    && (
                        where.lockedAt === undefined
                        || (where.lockedAt && typeof where.lockedAt === "object" && "not" in where.lockedAt
                            ? (where.lockedAt.not === null ? r.lockedAt !== null : r.lockedAt !== where.lockedAt.not)
                            : r.lockedAt === where.lockedAt)
                    )
                    && (!where.OR || where.OR.some((clause: any) => (
                        (clause.scheduleId !== undefined && r.scheduleId === clause.scheduleId)
                        || (clause.serviceRecordCaseId !== undefined && r.serviceRecordCaseId === clause.serviceRecordCaseId)
                    )))
                )) ?? null;
            }),
            update: jest.fn(async ({ where, data }: any) => {
                const row = rows.find((r) => r.id === where.id);
                for (const k of Object.keys(data)) {
                    const v = data[k];
                    if (v && typeof v === "object" && "increment" in v) row[k] = (row[k] ?? 0) + v.increment;
                    else row[k] = v;
                }
                return row;
            }),
            updateMany: jest.fn(async ({ where, data }: any) => {
                let count = 0;
                for (const r of rows) {
                    const idMatches = where.id === undefined || r.id === where.id;
                    const branchMatches = where.branchId === undefined || r.branchId === where.branchId;
                    const scheduleMatches = where.scheduleId === undefined || r.scheduleId === where.scheduleId;
                    const employeeMatches = where.employeeId === undefined || r.employeeId === where.employeeId;
                    const phoneMatches = where.expectedPhoneHash === undefined || r.expectedPhoneHash === where.expectedPhoneHash;
                    const revokedMatches = where.revokedAt === undefined || r.revokedAt === where.revokedAt;
                    const lockedAtMatches = where.lockedAt === undefined
                        ? true
                        : where.lockedAt && typeof where.lockedAt === "object" && "not" in where.lockedAt
                            ? (where.lockedAt.not === null ? r.lockedAt !== null : r.lockedAt !== where.lockedAt.not)
                            : r.lockedAt === where.lockedAt;
                    const orMatches = !where.OR || where.OR.some((clause: any) => (
                        (clause.scheduleId !== undefined && r.scheduleId === clause.scheduleId)
                        || (clause.serviceRecordCaseId !== undefined && r.serviceRecordCaseId === clause.serviceRecordCaseId)
                    ));
                    if (
                        idMatches
                        && branchMatches
                        && scheduleMatches
                        && employeeMatches
                        && phoneMatches
                        && revokedMatches
                        && lockedAtMatches
                        && orMatches
                        && (where.active === undefined || r.active === where.active)
                    ) {
                        Object.assign(r, data);
                        count++;
                    }
                }
                return { count };
            }),
        },
        employee: {
            // Live employee lookup used by the stale-snapshot fallback; tests override per case.
            findFirst: jest.fn<Promise<{ phone: string } | null>, [any]>(async () => null),
        },
    };
    return Object.assign(prisma, {
        $transaction: jest.fn(async (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma)),
    });
}

const future = () => new Date(Date.now() + 15 * 24 * 60 * 60 * 1000);

describe("ServiceRecordTokenService", () => {
    function setup() {
        const prisma = makePrismaMock();
        const svc = new ServiceRecordTokenService(prisma as any);
        return { prisma, svc };
    }

    it("issues a link, then a correct phone number mints an access token that resolves to the assignment context", async () => {
        const { prisma, svc } = setup();
        const { linkToken } = await svc.issueLink({
            branchId: "b1", scheduleId: 10, employeeId: 7, expectedPhone: "010-1111-2222", expiresAt: future(),
        });

        expect(prisma.__rows[0].linkTokenHash).toBe(linkToken);

        // normalized phone compare: "01011112222" must match "010-1111-2222"
        const result = await svc.verifyPhoneAndMintAccess(linkToken, "01011112222");
        expect(result.ok).toBe(true);

        const accessToken = (result as { ok: true; accessToken: string }).accessToken;
        const ctx = await svc.resolveAccess(accessToken);
        expect(ctx).toEqual({ tokenId: expect.any(String), branchId: "b1", scheduleId: 10, employeeId: 7 });
    });

    it("allows the correct phone on the final allowed attempt and clears transient failures", async () => {
        const { prisma, svc } = setup();
        const { linkToken } = await svc.issueLink({
            branchId: "b1", scheduleId: 10, employeeId: 7, expectedPhone: "010-1111-2222", expiresAt: future(),
        });

        for (let i = 0; i < 4; i++) {
            await svc.verifyPhoneAndMintAccess(linkToken, "01000000000");
        }

        const result = await svc.verifyPhoneAndMintAccess(linkToken, "01011112222");

        expect(result).toMatchObject({ ok: true, accessToken: expect.any(String) });
        expect(prisma.__rows[0]).toMatchObject({
            failedAttempts: 0,
            challengeWindowStartedAt: null,
            lockedAt: null,
        });
    });

    it("locks after five failed guesses and does not mint access after lockout", async () => {
        const { prisma, svc } = setup();
        const { linkToken } = await svc.issueLink({
            branchId: "b1", scheduleId: 10, employeeId: 7, expectedPhone: "010-1111-2222", expiresAt: future(),
        });

        for (let i = 0; i < 4; i++) {
            expect(await svc.verifyPhoneAndMintAccess(linkToken, "01000000000")).toEqual({
                ok: false,
                reason: "verification_failed",
            });
        }
        expect(prisma.__rows[0].failedAttempts).toBe(4);
        expect(prisma.__rows[0].lockedAt).toBeNull();

        // The fifth failed guess is the final allowed attempt and locks the link.
        expect(await svc.verifyPhoneAndMintAccess(linkToken, "01000000000")).toEqual({
            ok: false,
            reason: "verification_failed",
        });
        expect(prisma.__rows[0].failedAttempts).toBe(5);
        expect(prisma.__rows[0].lockedAt).toEqual(expect.any(Date));

        // Wrong and correct guesses remain generic and cannot mint after lockout.
        expect(await svc.verifyPhoneAndMintAccess(linkToken, "01000000000")).toEqual({
            ok: false,
            reason: "verification_failed",
        });
        expect(await svc.verifyPhoneAndMintAccess(linkToken, "010-1111-2222")).toEqual({
            ok: false,
            reason: "verification_failed",
        });
    });

    it("fails closed for legacy rows that already exhausted the budget before the lock marker existed", async () => {
        const { prisma, svc } = setup();
        const { linkToken } = await svc.issueLink({
            branchId: "b1", scheduleId: 10, employeeId: 7, expectedPhone: "010-1111-2222", expiresAt: future(),
        });
        prisma.__rows[0].failedAttempts = 5;
        prisma.__rows[0].challengeWindowStartedAt = new Date(Date.now() - SERVICE_RECORD_PHONE_CHALLENGE_WINDOW_MS - 1);

        expect(await svc.resolveLink(linkToken)).toBeNull();
        await expect(svc.verifyPhoneAndMintAccess(linkToken, "010-1111-2222")).resolves.toEqual({
            ok: false,
            reason: "verification_failed",
        });
        expect(prisma.__rows[0].lockedAt).toEqual(expect.any(Date));
    });

    it("accepts the employee's corrected live phone when the issuance snapshot is stale, and heals the snapshot", async () => {
        const { prisma, svc } = setup();
        // Link issued while the employee record still held a wrong number.
        const { linkToken } = await svc.issueLink({
            branchId: "b1", scheduleId: 10, employeeId: 7, expectedPhone: "010-1111-2222", expiresAt: future(),
        });
        const staleHash = prisma.__rows[0].expectedPhoneHash;
        // Admin has since corrected the employee's phone.
        prisma.employee.findFirst.mockResolvedValue({ phone: "010-9999-8888" });

        const result = await svc.verifyPhoneAndMintAccess(linkToken, "010-9999-8888");
        expect(result).toMatchObject({ ok: true });

        // Only non-deleted employees back the fallback.
        expect(prisma.employee.findFirst).toHaveBeenCalledWith(
            expect.objectContaining({ where: expect.objectContaining({ id: 7, deletedAt: null }) }),
        );

        // The snapshot is healed to the corrected phone…
        expect(prisma.__rows[0].expectedPhoneHash).not.toBe(staleHash);
        // …so the old (wrong) number no longer verifies.
        expect(await svc.verifyPhoneAndMintAccess(linkToken, "010-1111-2222")).toEqual({
            ok: false,
            reason: "verification_failed",
        });
        // And the corrected number keeps matching via the snapshot alone.
        prisma.employee.findFirst.mockResolvedValue(null);
        expect(await svc.verifyPhoneAndMintAccess(linkToken, "01099998888")).toMatchObject({ ok: true });

        const accessToken = (result as { ok: true; accessToken: string }).accessToken;
        expect(await svc.resolveAccess(accessToken)).toBeNull(); // superseded by the later mint
    });

    it("rejects a phone matching neither the snapshot nor the live employee record", async () => {
        const { prisma, svc } = setup();
        const { linkToken } = await svc.issueLink({
            branchId: "b1", scheduleId: 10, employeeId: 7, expectedPhone: "010-1111-2222", expiresAt: future(),
        });
        prisma.employee.findFirst.mockResolvedValue({ phone: "010-9999-8888" });

        expect(await svc.verifyPhoneAndMintAccess(linkToken, "010-0000-0000")).toEqual({
            ok: false,
            reason: "verification_failed",
        });
        expect(prisma.__rows[0].failedAttempts).toBe(1);
        expect(prisma.__rows[0].expectedPhoneHash).toBeDefined();
    });

    it("starts a fresh challenge window after the prior transient window expires", async () => {
        const { prisma, svc } = setup();
        const { linkToken } = await svc.issueLink({
            branchId: "b1", scheduleId: 10, employeeId: 7, expectedPhone: "010-1111-2222", expiresAt: future(),
        });
        prisma.__rows[0].failedAttempts = 4;
        prisma.__rows[0].challengeWindowStartedAt = new Date(
            Date.now() - SERVICE_RECORD_PHONE_CHALLENGE_WINDOW_MS - 1,
        );

        await expect(svc.verifyPhoneAndMintAccess(linkToken, "01000000000")).resolves.toEqual({
            ok: false,
            reason: "verification_failed",
        });

        expect(prisma.__rows[0]).toMatchObject({
            failedAttempts: 1,
            lockedAt: null,
            challengeWindowStartedAt: expect.any(Date),
        });
    });

    it("serializes concurrent wrong guesses so the attempt budget cannot be bypassed", async () => {
        const { prisma, svc } = setup();
        const { linkToken } = await svc.issueLink({
            branchId: "b1", scheduleId: 10, employeeId: 7, expectedPhone: "010-1111-2222", expiresAt: future(),
        });
        let transactionTail = Promise.resolve();
        prisma.$transaction.mockImplementation((callback: (tx: typeof prisma) => Promise<unknown>) => {
            const run = transactionTail.then(() => callback(prisma));
            transactionTail = run.then(() => undefined, () => undefined);
            return run;
        });

        const results = await Promise.all(
            Array.from({ length: 20 }, () => svc.verifyPhoneAndMintAccess(linkToken, "01000000000")),
        );

        expect(results.every((result) => result.ok === false)).toBe(true);
        expect(prisma.__rows[0].failedAttempts).toBe(5);
        expect(prisma.__rows[0].lockedAt).toEqual(expect.any(Date));
    });

    it("does not mint through the fallback when the live employee phone is empty", async () => {
        const { prisma, svc } = setup();
        const { linkToken } = await svc.issueLink({
            branchId: "b1", scheduleId: 10, employeeId: 7, expectedPhone: "010-1111-2222", expiresAt: future(),
        });
        prisma.employee.findFirst.mockResolvedValue({ phone: "" });

        expect(await svc.verifyPhoneAndMintAccess(linkToken, "")).toEqual({
            ok: false,
            reason: "verification_failed",
        });
    });

    it("treats an expired token as unusable for both link resolution and access", async () => {
        const { prisma, svc } = setup();
        const { linkToken } = await svc.issueLink({
            branchId: "b1", scheduleId: 10, employeeId: 7, expectedPhone: "010-1111-2222", expiresAt: future(),
        });
        const verify = await svc.verifyPhoneAndMintAccess(linkToken, "01011112222");
        const accessToken = (verify as { ok: true; accessToken: string }).accessToken;

        // force expiry
        prisma.__rows[0].expiresAt = new Date(Date.now() - 1000);

        expect(await svc.resolveLink(linkToken)).toBeNull();
        expect(await svc.resolveAccess(accessToken)).toBeNull();
    });

    it("returns the same generic verification result for invalid, expired, and locked links", async () => {
        const { prisma, svc } = setup();
        const { linkToken } = await svc.issueLink({
            branchId: "b1", scheduleId: 10, employeeId: 7, expectedPhone: "010-1111-2222", expiresAt: future(),
        });
        const wrong = await svc.verifyPhoneAndMintAccess(linkToken, "01000000000");
        prisma.__rows[0].expiresAt = new Date(Date.now() - 1);
        const expired = await svc.verifyPhoneAndMintAccess(linkToken, "01000000000");
        prisma.__rows[0].expiresAt = future();
        prisma.__rows[0].lockedAt = new Date();
        const locked = await svc.verifyPhoneAndMintAccess(linkToken, "01011112222");

        expect(wrong).toEqual({ ok: false, reason: "verification_failed" });
        expect(expired).toEqual(wrong);
        expect(locked).toEqual(wrong);
    });

    it("revokes an access token when its challenge is locked", async () => {
        const { prisma, svc } = setup();
        const { linkToken } = await svc.issueLink({
            branchId: "b1", scheduleId: 10, employeeId: 7, expectedPhone: "010-1111-2222", expiresAt: future(),
        });
        const result = await svc.verifyPhoneAndMintAccess(linkToken, "01011112222");
        const accessToken = (result as { ok: true; accessToken: string }).accessToken;

        prisma.__rows[0].lockedAt = new Date();

        await expect(svc.resolveAccess(accessToken)).resolves.toBeNull();
    });

    it("revokes by schedule (replacement/termination) so the old access stops working", async () => {
        const { svc } = setup();
        const { linkToken } = await svc.issueLink({
            branchId: "b1", scheduleId: 10, employeeId: 7, expectedPhone: "010-1111-2222", expiresAt: future(),
        });
        const accessToken = (
            (await svc.verifyPhoneAndMintAccess(linkToken, "01011112222")) as { ok: true; accessToken: string }
        ).accessToken;

        await svc.revokeForSchedule(10);

        expect(await svc.resolveAccess(accessToken)).toBeNull();
        expect(await svc.resolveLink(linkToken)).toBeNull();
    });

    it("re-issuing a link for the same schedule revokes the prior link", async () => {
        const { svc } = setup();
        const first = await svc.issueLink({
            branchId: "b1", scheduleId: 10, employeeId: 7, expectedPhone: "010-1111-2222", expiresAt: future(),
        });
        await svc.issueLink({
            branchId: "b1", scheduleId: 10, employeeId: 8, expectedPhone: "010-3333-4444", expiresAt: future(),
        });

        // the first (now-replaced) provider's link is dead
        expect(await svc.resolveLink(first.linkToken)).toBeNull();
    });

    it("reuses the active link for the same provider and extends its expiry without clearing verification", async () => {
        const { prisma, svc } = setup();
        const firstExpiry = future();
        const { linkToken } = await svc.issueLink({
            branchId: "b1",
            scheduleId: 10,
            employeeId: 7,
            expectedPhone: "010-1111-2222",
            expiresAt: firstExpiry,
        });
        await svc.verifyPhoneAndMintAccess(linkToken, "01011112222");
        const verifiedAt = prisma.__rows[0].verifiedAt;
        const accessTokenHash = prisma.__rows[0].accessTokenHash;
        prisma.__rows[0].expiresAt = new Date(Date.now() - 1000);
        const extendedExpiry = new Date(firstExpiry.getTime() + 24 * 60 * 60 * 1000);

        await expect(svc.reuseActiveLink({
            branchId: "b1",
            scheduleId: 10,
            employeeId: 7,
            expectedPhone: "01011112222",
            expiresAt: extendedExpiry,
        })).resolves.toEqual({ linkToken });

        expect(prisma.__rows).toHaveLength(1);
        expect(prisma.__rows[0]).toMatchObject({
            linkTokenHash: linkToken,
            active: true,
            revokedAt: null,
            verifiedAt,
            accessTokenHash,
            expiresAt: extendedExpiry,
        });
    });

    it("does not reuse a link after the provider identity changes or the token is revoked", async () => {
        const { svc } = setup();
        await svc.issueLink({
            branchId: "b1",
            scheduleId: 10,
            employeeId: 7,
            expectedPhone: "010-1111-2222",
            expiresAt: future(),
        });

        await expect(svc.reuseActiveLink({
            branchId: "b1",
            scheduleId: 10,
            employeeId: 8,
            expectedPhone: "010-1111-2222",
            expiresAt: future(),
        })).resolves.toBeNull();
        await expect(svc.reuseActiveLink({
            branchId: "b1",
            scheduleId: 10,
            employeeId: 7,
            expectedPhone: "010-9999-9999",
            expiresAt: future(),
        })).resolves.toBeNull();

        await svc.revokeForSchedule(10);

        await expect(svc.reuseActiveLink({
            branchId: "b1",
            scheduleId: 10,
            employeeId: 7,
            expectedPhone: "010-1111-2222",
            expiresAt: future(),
        })).resolves.toBeNull();
    });

    it("does not return a link when it is revoked between lookup and expiry extension", async () => {
        const { prisma, svc } = setup();
        await svc.issueLink({
            branchId: "b1",
            scheduleId: 10,
            employeeId: 7,
            expectedPhone: "010-1111-2222",
            expiresAt: future(),
        });
        prisma.service_record_token.updateMany.mockResolvedValueOnce({ count: 0 });

        await expect(svc.reuseActiveLink({
            branchId: "b1",
            scheduleId: 10,
            employeeId: 7,
            expectedPhone: "010-1111-2222",
            expiresAt: future(),
        })).resolves.toBeNull();
    });

    it("prepares an inactive link that cannot be used before an admin sends it", async () => {
        const { prisma, svc } = setup();
        const prepared = await svc.prepareLink({
            branchId: "b1", scheduleId: 10, employeeId: 7, expectedPhone: "010-1111-2222", expiresAt: future(),
        });

        expect(prisma.__rows[0]).toMatchObject({
            branchId: "b1",
            scheduleId: 10,
            employeeId: 7,
            active: false,
            revokedAt: null,
        });
        expect(await svc.resolveLink(prepared.linkToken)).toBeNull();
    });

    it("activates the exact prepared link and revokes the previously active link", async () => {
        const { svc } = setup();
        const previous = await svc.issueLink({
            branchId: "b1", scheduleId: 10, employeeId: 7, expectedPhone: "010-1111-2222", expiresAt: future(),
        });
        const prepared = await svc.prepareLink({
            branchId: "b1", scheduleId: 10, employeeId: 7, expectedPhone: "010-1111-2222", expiresAt: future(),
        });
        const activatedExpiry = future();

        await expect(svc.activatePreparedLink({
            linkToken: prepared.linkToken,
            branchId: "b1",
            scheduleId: 10,
            employeeId: 7,
            expectedPhone: "01011112222",
            expiresAt: activatedExpiry,
        })).resolves.toBe(true);

        expect(await svc.resolveLink(previous.linkToken)).toBeNull();
        expect(await svc.resolveLink(prepared.linkToken)).toMatchObject({
            branchId: "b1",
            scheduleId: 10,
            employeeId: 7,
            active: true,
            expiresAt: activatedExpiry,
        });
    });

    it("does not activate a prepared link for a different assignment or phone", async () => {
        const { svc } = setup();
        const prepared = await svc.prepareLink({
            branchId: "b1", scheduleId: 10, employeeId: 7, expectedPhone: "010-1111-2222", expiresAt: future(),
        });

        await expect(svc.activatePreparedLink({
            linkToken: prepared.linkToken,
            branchId: "b1",
            scheduleId: 11,
            employeeId: 7,
            expectedPhone: "010-1111-2222",
            expiresAt: future(),
        })).resolves.toBe(false);
        await expect(svc.activatePreparedLink({
            linkToken: prepared.linkToken,
            branchId: "b1",
            scheduleId: 10,
            employeeId: 7,
            expectedPhone: "010-9999-9999",
            expiresAt: future(),
        })).resolves.toBe(false);
        expect(await svc.resolveLink(prepared.linkToken)).toBeNull();
    });

    it("does not activate a token prepared before lockout after the active challenge is locked", async () => {
        const { prisma, svc } = setup();
        const previous = await svc.issueLink({
            branchId: "b1", scheduleId: 10, employeeId: 7, expectedPhone: "010-1111-2222", expiresAt: future(),
        });
        const prepared = await svc.prepareLink({
            branchId: "b1", scheduleId: 10, employeeId: 7, expectedPhone: "010-1111-2222", expiresAt: future(),
        });

        for (let i = 0; i < 5; i++) {
            await svc.verifyPhoneAndMintAccess(previous.linkToken, "01000000000");
        }

        expect(prisma.__rows[0]).toMatchObject({ active: true, lockedAt: expect.any(Date) });
        await expect(svc.activatePreparedLink({
            linkToken: prepared.linkToken,
            branchId: "b1",
            scheduleId: 10,
            employeeId: 7,
            expectedPhone: "01011112222",
            expiresAt: future(),
        })).resolves.toBe(false);

        expect(prisma.__rows[0]).toMatchObject({ active: true, lockedAt: expect.any(Date) });
        expect(prisma.__rows[1]).toMatchObject({ active: false, lockedAt: null });
        expect(await svc.resolveLink(prepared.linkToken)).toBeNull();
    });

    it("locks active assignment rows before prepared-link revocation and activation", async () => {
        const { prisma, svc } = setup();
        const previous = await svc.issueLink({
            branchId: "b1", scheduleId: 10, employeeId: 7, expectedPhone: "010-1111-2222", expiresAt: future(),
        });
        const prepared = await svc.prepareLink({
            branchId: "b1", scheduleId: 10, employeeId: 7, expectedPhone: "010-1111-2222", expiresAt: future(),
        });
        const order: string[] = [];
        const queryRaw = jest.fn(async (query: { sql?: string }) => {
            order.push(query.sql ?? "");
            return [{ lockedAt: null }];
        });
        (prisma as any).$queryRaw = queryRaw;
        const revoke = prisma.service_record_token.updateMany;
        prisma.service_record_token.updateMany = jest.fn(async (args: any) => {
            order.push("revoke");
            return revoke(args);
        });

        await expect(svc.activatePreparedLink({
            linkToken: prepared.linkToken,
            branchId: "b1",
            scheduleId: 10,
            employeeId: 7,
            expectedPhone: "01011112222",
            expiresAt: future(),
        })).resolves.toBe(true);

        expect(queryRaw).toHaveBeenCalledTimes(1);
        expect(order[0]).toContain("FOR UPDATE");
        expect(order[1]).toBe("revoke");
        expect(await svc.resolveLink(previous.linkToken)).toBeNull();
        expect(await svc.resolveLink(prepared.linkToken)).toMatchObject({ active: true });
    });
});
