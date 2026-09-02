import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "infrastructure/database/prisma.service";
import {
    ISchedulerLeaseRepository,
    SchedulerLeaseAcquireOptions,
    SchedulerLeaseAcquireResult,
    SchedulerLeaseIdentity,
    SchedulerLeaseRecord,
} from "domain/repositories/scheduler-lease.repository.interface";

type SchedulerLeaseAcquireRow = {
    expires_at: Date;
    db_now: Date;
};

type SchedulerLeaseReadRow = {
    name: string;
    holder_id: string;
    instance_id: string;
    acquired_at: Date;
    renewed_at: Date;
    expires_at: Date;
    db_now: Date;
};

@Injectable()
export class SbSchedulerLeaseRepository implements ISchedulerLeaseRepository {
    constructor(private readonly prisma: PrismaService) {}

    async acquireOrRenew(options: SchedulerLeaseAcquireOptions): Promise<SchedulerLeaseAcquireResult> {
        const rows = await this.prisma.$queryRaw<SchedulerLeaseAcquireRow[]>(Prisma.sql`
            INSERT INTO "scheduler_lease" ("name", "holder_id", "instance_id", "acquired_at", "renewed_at", "expires_at")
            VALUES (${options.name}, ${options.holderId}, ${options.instanceId}, now(), now(),
                    now() + make_interval(secs => ${options.ttlSeconds}::double precision))
            ON CONFLICT ("name") DO UPDATE
            SET "holder_id" = EXCLUDED."holder_id",
                "instance_id" = EXCLUDED."instance_id",
                "acquired_at" = CASE
                    WHEN "scheduler_lease"."holder_id" = EXCLUDED."holder_id"
                     AND "scheduler_lease"."instance_id" = EXCLUDED."instance_id"
                    THEN "scheduler_lease"."acquired_at"
                    ELSE now()
                END,
                "renewed_at" = now(),
                "expires_at" = EXCLUDED."expires_at"
            WHERE "scheduler_lease"."expires_at" <= now()
               OR ("scheduler_lease"."holder_id" = EXCLUDED."holder_id"
                   AND ("scheduler_lease"."instance_id" = EXCLUDED."instance_id"
                        OR "scheduler_lease"."renewed_at" < now() - make_interval(secs => ${options.takeoverAfterSeconds}::double precision)))
            RETURNING "expires_at", now() AS db_now
        `);
        const row = rows[0];
        return row
            ? { acquired: true, expiresAt: row.expires_at, dbNow: row.db_now }
            : { acquired: false, expiresAt: null, dbNow: null };
    }

    async release(name: string, identity: SchedulerLeaseIdentity): Promise<boolean> {
        const count = await this.prisma.$executeRaw(Prisma.sql`
            UPDATE "scheduler_lease"
            SET "expires_at" = now()
            WHERE "name" = ${name}
              AND "holder_id" = ${identity.holderId}
              AND "instance_id" = ${identity.instanceId}
        `);
        return count > 0;
    }

    async read(name: string): Promise<SchedulerLeaseRecord | null> {
        const rows = await this.prisma.$queryRaw<SchedulerLeaseReadRow[]>(Prisma.sql`
            SELECT "name", "holder_id", "instance_id", "acquired_at", "renewed_at", "expires_at", now() AS db_now
            FROM "scheduler_lease"
            WHERE "name" = ${name}
        `);
        const row = rows[0];
        if (!row) {
            return null;
        }
        return {
            name: row.name,
            holderId: row.holder_id,
            instanceId: row.instance_id,
            acquiredAt: row.acquired_at,
            renewedAt: row.renewed_at,
            expiresAt: row.expires_at,
            dbNow: row.db_now,
        };
    }
}
