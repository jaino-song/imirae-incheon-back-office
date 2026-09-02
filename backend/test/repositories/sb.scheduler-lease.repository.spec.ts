import { Prisma } from "@prisma/client";
import { PrismaService } from "infrastructure/database/prisma.service";
import { SbSchedulerLeaseRepository } from "infrastructure/database/repositories/sb.scheduler-lease.repository";

describe("SbSchedulerLeaseRepository", () => {
    const getSqlText = (value: unknown): string => {
        if (typeof value === "object" && value !== null && "strings" in value) {
            const strings = (value as { strings?: unknown }).strings;
            if (Array.isArray(strings)) {
                return strings.join("");
            }
        }

        return String(value);
    };

    let queryRaw: jest.Mock;
    let executeRaw: jest.Mock;
    let transaction: jest.Mock;
    let prisma: PrismaService;
    let repository: SbSchedulerLeaseRepository;

    beforeEach(() => {
        queryRaw = jest.fn();
        executeRaw = jest.fn();
        transaction = jest.fn();
        prisma = {
            $queryRaw: queryRaw,
            $executeRaw: executeRaw,
            $transaction: transaction,
        } as unknown as PrismaService;
        repository = new SbSchedulerLeaseRepository(prisma);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe("acquireOrRenew", () => {
        const options = {
            name: "background-owner",
            holderId: "lightnode",
            instanceId: "instance-1",
            ttlSeconds: 90,
            takeoverAfterSeconds: 45,
        };

        it("returns acquired: true with expiresAt/dbNow when a row comes back", async () => {
            const expiresAt = new Date("2026-09-02T12:01:30.000Z");
            const dbNow = new Date("2026-09-02T12:00:00.000Z");
            queryRaw.mockResolvedValueOnce([{ expires_at: expiresAt, db_now: dbNow }]);

            const result = await repository.acquireOrRenew(options);

            expect(result).toEqual({ acquired: true, expiresAt, dbNow });
            expect(queryRaw).toHaveBeenCalledTimes(1);
        });

        it("returns acquired: false with null fields when zero rows come back", async () => {
            queryRaw.mockResolvedValueOnce([]);

            const result = await repository.acquireOrRenew(options);

            expect(result).toEqual({ acquired: false, expiresAt: null, dbNow: null });
        });

        it("sends the atomic INSERT ... ON CONFLICT ... RETURNING statement with the takeover predicates", async () => {
            queryRaw.mockResolvedValueOnce([]);

            await repository.acquireOrRenew(options);

            const sqlArg = queryRaw.mock.calls[0][0] as Prisma.Sql;
            const sqlText = getSqlText(sqlArg).replace(/\s+/g, " ");

            expect(sqlText).toContain('ON CONFLICT ("name") DO UPDATE');
            expect(sqlText).toContain('"scheduler_lease"."expires_at" <= now()');
            expect(sqlText).toContain(
                '"scheduler_lease"."holder_id" = EXCLUDED."holder_id" AND ("scheduler_lease"."instance_id" = EXCLUDED."instance_id"',
            );
            expect(sqlText).toContain(
                '"scheduler_lease"."renewed_at" < now() - make_interval(secs =>',
            );
            expect(sqlText).toContain('RETURNING "expires_at", now() AS db_now');

            expect(sqlArg.values).toEqual([
                options.name,
                options.holderId,
                options.instanceId,
                options.ttlSeconds,
                options.takeoverAfterSeconds,
            ]);
        });
    });

    describe("release", () => {
        it("returns true when $executeRaw reports a row was affected", async () => {
            executeRaw.mockResolvedValueOnce(1);

            await expect(
                repository.release("background-owner", { holderId: "lightnode", instanceId: "instance-1" }),
            ).resolves.toBe(true);
        });

        it("returns false when $executeRaw reports no row was affected", async () => {
            executeRaw.mockResolvedValueOnce(0);

            await expect(
                repository.release("background-owner", { holderId: "lightnode", instanceId: "instance-1" }),
            ).resolves.toBe(false);
        });

        it("scopes the UPDATE to name, holder_id, and instance_id", async () => {
            executeRaw.mockResolvedValueOnce(1);

            await repository.release("background-owner", { holderId: "lightnode", instanceId: "instance-1" });

            const sqlArg = executeRaw.mock.calls[0][0] as Prisma.Sql;
            const sqlText = getSqlText(sqlArg).replace(/\s+/g, " ");

            expect(sqlText).toContain('UPDATE "scheduler_lease"');
            expect(sqlText).toContain('SET "expires_at" = now()');
            expect(sqlText).toContain('WHERE "name" =');
            expect(sqlText).toContain('AND "holder_id" =');
            expect(sqlText).toContain('AND "instance_id" =');
            expect(sqlArg.values).toEqual(["background-owner", "lightnode", "instance-1"]);
        });
    });

    describe("read", () => {
        it("maps snake_case columns to the camelCase record", async () => {
            const acquiredAt = new Date("2026-09-02T11:58:00.000Z");
            const renewedAt = new Date("2026-09-02T12:00:00.000Z");
            const expiresAt = new Date("2026-09-02T12:01:30.000Z");
            const dbNow = new Date("2026-09-02T12:00:05.000Z");
            queryRaw.mockResolvedValueOnce([
                {
                    name: "background-owner",
                    holder_id: "lightnode",
                    instance_id: "instance-1",
                    acquired_at: acquiredAt,
                    renewed_at: renewedAt,
                    expires_at: expiresAt,
                    db_now: dbNow,
                },
            ]);

            await expect(repository.read("background-owner")).resolves.toEqual({
                name: "background-owner",
                holderId: "lightnode",
                instanceId: "instance-1",
                acquiredAt,
                renewedAt,
                expiresAt,
                dbNow,
            });
        });

        it("returns null when there is no row", async () => {
            queryRaw.mockResolvedValueOnce([]);

            await expect(repository.read("background-owner")).resolves.toBeNull();
        });
    });

    it("never opens a $transaction", async () => {
        queryRaw.mockResolvedValue([]);
        executeRaw.mockResolvedValue(0);

        await repository.acquireOrRenew({
            name: "background-owner",
            holderId: "lightnode",
            instanceId: "instance-1",
            ttlSeconds: 90,
            takeoverAfterSeconds: 45,
        });
        await repository.release("background-owner", { holderId: "lightnode", instanceId: "instance-1" });
        await repository.read("background-owner");

        expect(transaction).not.toHaveBeenCalled();
    });
});
