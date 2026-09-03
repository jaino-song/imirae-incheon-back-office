export const EFORMSIGN_WEBHOOK_EVENT_REPOSITORY = "EFORMSIGN_WEBHOOK_EVENT_REPOSITORY";

/**
 * One ledger row, already clipped to its column widths by the caller. Every
 * field is nullable except `outcome`, which the table requires.
 */
export interface EformsignWebhookEventRow {
    webhookId: string | null;
    eventType: string | null;
    companyId: string | null;
    documentId: string | null;
    rawStatus: string | null;
    statusType: string | null;
    statusDetail: string | null;
    sourceUpdatedDate: Date | null;
    outcome: string;
    outcomeReason: string | null;
}

/** One outcome value and how many rows carried it in the window queried. */
export interface EformsignWebhookOutcomeTally {
    outcome: string;
    count: number;
}

export interface IEformsignWebhookEventRepository {
    /** Insert one row. Throws on failure; the caller decides whether that matters. */
    append(row: EformsignWebhookEventRow): Promise<void>;
    /**
     * Rows created at or after `since`, tallied by outcome. Deliberately not a
     * received/dropped pair: which outcomes count as dropped is domain
     * knowledge, and it stays out of the data access layer.
     */
    countByOutcomeSince(since: Date): Promise<EformsignWebhookOutcomeTally[]>;
    /** Retention sweep. Returns how many rows were removed. */
    deleteOlderThan(cutoff: Date): Promise<number>;
}
