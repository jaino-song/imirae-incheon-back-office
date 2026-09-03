/**
 * What became of one inbound eformsign webhook.
 *
 * The service drops events at a dozen points and, until this table existed,
 * every one of them left nothing behind but a log line nobody read — which is
 * how a mapping bug that froze every 제공기관 검토 document at 060 survived for
 * months. Recording the arrival alone would not have caught it: the question
 * worth asking is "what arrived and was thrown away, and why", so the outcome
 * is the reason this table exists.
 */
export const EFORMSIGN_WEBHOOK_OUTCOME = {
    /** A projection write landed. */
    APPLIED: "applied",
    /** The completion claim took the document to its terminal state. */
    COMPLETION_CLAIMED: "completion_claimed",
    /** A completion webhook arrived after the claim was already made. */
    COMPLETION_DUPLICATE: "completion_duplicate",
    /**
     * The mapped status disagreed with the mirrored detail, so the update was
     * refused as stale. A row here whose raw_status and status_type disagree in
     * kind (say doc_request_reviewer mapped to 060) is a mapping defect, not a
     * genuinely late webhook.
     */
    IGNORED_STALE_MIRROR: "ignored_stale_mirror",
    /** The stored projection was already at or ahead of this event. */
    IGNORED_STALE_PROJECTION: "ignored_stale_projection",
    /** The event's own timestamp precedes the stored row's updatedDate. */
    IGNORED_STALE_EVENT: "ignored_stale_event",
    /** A backward transition or terminal downgrade on an unassigned document. */
    IGNORED_BACKWARD_TRANSITION: "ignored_backward_transition",
    /** No local row for this document, so there was nothing to update. */
    DOCUMENT_NOT_FOUND: "document_not_found",
    /** Mirroring an externally created document failed. */
    MIRROR_FAILED: "mirror_failed",
    /** The payload carried no document identifier. */
    MISSING_DOCUMENT_ID: "missing_document_id",
    /** An event type this service does not handle. */
    UNKNOWN_EVENT_TYPE: "unknown_event_type",
    /** Processing threw. */
    ERROR: "error",
    /**
     * Processing returned without classifying itself. Not a vendor condition —
     * it means an exit path in the service was never instrumented, so treat any
     * row carrying it as a bug in this ledger rather than in the webhook.
     */
    UNRECORDED: "unrecorded",
} as const;

export type EformsignWebhookOutcome =
    (typeof EFORMSIGN_WEBHOOK_OUTCOME)[keyof typeof EFORMSIGN_WEBHOOK_OUTCOME];

/**
 * Outcomes that mean the webhook changed nothing. The operator-facing counter
 * and any alerting read this set — "arrived" on its own is not interesting.
 */
export const EFORMSIGN_WEBHOOK_DROPPED_OUTCOMES: ReadonlySet<EformsignWebhookOutcome> = new Set([
    EFORMSIGN_WEBHOOK_OUTCOME.IGNORED_STALE_MIRROR,
    EFORMSIGN_WEBHOOK_OUTCOME.IGNORED_STALE_PROJECTION,
    EFORMSIGN_WEBHOOK_OUTCOME.IGNORED_STALE_EVENT,
    EFORMSIGN_WEBHOOK_OUTCOME.IGNORED_BACKWARD_TRANSITION,
    EFORMSIGN_WEBHOOK_OUTCOME.DOCUMENT_NOT_FOUND,
    EFORMSIGN_WEBHOOK_OUTCOME.MIRROR_FAILED,
    EFORMSIGN_WEBHOOK_OUTCOME.MISSING_DOCUMENT_ID,
    EFORMSIGN_WEBHOOK_OUTCOME.UNKNOWN_EVENT_TYPE,
    EFORMSIGN_WEBHOOK_OUTCOME.ERROR,
]);

/** How long an event row is kept before the reconcile sweep purges it. */
export const EFORMSIGN_WEBHOOK_EVENT_RETENTION_DAYS = 90;
