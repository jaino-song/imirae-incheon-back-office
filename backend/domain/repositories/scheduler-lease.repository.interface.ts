export const SCHEDULER_LEASE_REPOSITORY = "SCHEDULER_LEASE_REPOSITORY";

export interface SchedulerLeaseIdentity {
    /** Stable per host, e.g. "lightnode" / "lightsail". */
    holderId: string;
    /** Random per process; lets a restarted host take over its own stale lease. */
    instanceId: string;
}

export interface SchedulerLeaseAcquireOptions extends SchedulerLeaseIdentity {
    name: string;
    /** Lease lifetime granted by this acquire/renew, in seconds. */
    ttlSeconds: number;
    /** Same holder, different instance may take over once renewed_at is older than this, in seconds. */
    takeoverAfterSeconds: number;
}

export interface SchedulerLeaseAcquireResult {
    acquired: boolean;
    /** DB-clock expiry of the row after this statement; null when not acquired. */
    expiresAt: Date | null;
    /** DB clock at statement time; null when not acquired (no row returned). */
    dbNow: Date | null;
}

export interface SchedulerLeaseRecord {
    name: string;
    holderId: string;
    instanceId: string;
    acquiredAt: Date;
    renewedAt: Date;
    expiresAt: Date;
    dbNow: Date;
}

export interface ISchedulerLeaseRepository {
    /** Acquire or renew in one atomic statement. `acquired: false` means another holder owns a live lease. */
    acquireOrRenew(options: SchedulerLeaseAcquireOptions): Promise<SchedulerLeaseAcquireResult>;
    /** Expire the lease immediately if (and only if) this exact holder+instance owns it. Returns true when a row was released. */
    release(name: string, identity: SchedulerLeaseIdentity): Promise<boolean>;
    /** Current row, or null if none exists. */
    read(name: string): Promise<SchedulerLeaseRecord | null>;
}
