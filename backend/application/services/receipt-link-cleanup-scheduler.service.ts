import { Inject, Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { FILE_STORAGE_PORT, FileStoragePort } from "domain/ports/file-storage.port";
import { ReceiptLinkTokenService } from "./receipt-link-token.service";
import { SchedulerLeaseService } from "./scheduler-lease.service";

const EXPIRED_GRACE_MS = 24 * 60 * 60 * 1000;

/** Nightly: drop receipt images and token rows that expired more than a day ago. */
@Injectable()
export class ReceiptLinkCleanupSchedulerService {
    private readonly logger = new Logger(ReceiptLinkCleanupSchedulerService.name);

    constructor(
        private readonly tokenService: ReceiptLinkTokenService,
        @Inject(FILE_STORAGE_PORT) private readonly storage: FileStoragePort,
        private readonly schedulerLease: SchedulerLeaseService,
    ) {}

    @Cron("30 4 * * *", { timeZone: "Asia/Seoul" })
    async cleanupExpiredLinks(now: Date = new Date()): Promise<void> {
        if (!this.schedulerLease.holdsLease()) return;

        const cutoff = new Date(now.getTime() - EXPIRED_GRACE_MS);
        const { ids, orphanStoragePaths } = await this.tokenService.collectExpired(cutoff);
        if (ids.length === 0) return;

        let removedImages = 0;
        let allImagesRemoved = true;
        for (const path of orphanStoragePaths) {
            try {
                await this.storage.delete(path);
                removedImages += 1;
            } catch (error) {
                allImagesRemoved = false;
                this.logger.warn(`[ReceiptLink] failed to delete ${path}: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
        // collectExpired() only returns flattened ids/orphanStoragePaths — it has no per-id
        // storagePath, so a failed object delete cannot be attributed to the one row that
        // caused it (multiple expired rows can share a storagePath: reissuing a token for the
        // same document content reuses the same rendered PNG path). Deleting any row in this
        // batch while an object delete failed risks deleting the last row that still
        // references that path, making the orphan undiscoverable by the next sweep. Withhold
        // the whole batch instead so every row is retried until every object in it is gone.
        const idsToDelete = allImagesRemoved ? ids : [];
        const deleted = await this.tokenService.deleteByIds(idsToDelete);
        this.logger.log(`[ReceiptLink] cleanup removed ${deleted} expired tokens and ${removedImages} images`);
    }
}
