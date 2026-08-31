export type CallCategory = "NEW_CONSULTATION" | "CLIENT_SERVICE" | "OTHER";
export type ProcessingStatus = "RECEIVED" | "EXTRACTED" | "FAILED";
export type DraftType = "NEW_CLIENT" | "CLIENT_UPDATE";
export type DraftStatus = "PENDING" | "CONFIRMED" | "DISCARDED";
export type Confidence = "high" | "low";

export interface TranscriptTurn {
    speaker: string;
    text: string;
}

/**
 * Shared contract with the backend refine stage (design spec §4.3): the label a
 * role-less utterance carries when diarization was unavailable (>30min recordings)
 * and speaker attribution was omitted rather than guessed. This is for DISPLAY
 * only — never branch on it directly. A speaker outside the known role sets
 * (including this literal, an unexpected string, or a missing/empty speaker) is
 * unattributed by virtue of being the complement of those sets.
 */
export const NEUTRAL_SPEAKER = "화자";

export interface Proposal {
    field: string;
    value: string | number | boolean | null;
    /** extraction-time snapshot for CLIENT_UPDATE diffs; render the live client value when available */
    currentValue?: string | number | boolean | null;
    evidence: string;
    confidence: Confidence;
}

export interface ClientRef {
    id: number;
    name: string;
    phone: string | null;
}

export interface Paginated<T> {
    data: T[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

export interface CallRecordListItem {
    id: string;
    category: CallCategory | null;
    processingStatus: ProcessingStatus;
    callerName: string | null;
    callerPhone: string | null;
    fileName: string;
    recordedAt: string | null;
    createdAt: string;
    matchedClient: ClientRef | null;
    draft: { id: string; type: DraftType; status: DraftStatus; requestSummary: string } | null;
    summaryLine: string | null;
}

export interface CallRecordDetail extends CallRecordListItem {
    transcript: TranscriptTurn[];
    summary: Record<string, string> | null;
    driveFileId: string;
    driveUrl: string;
    failureReason: string | null;
}

export interface ClientDraftListItem {
    id: string;
    type: DraftType;
    status: DraftStatus;
    requestSummary: string;
    callerName: string | null;
    callerPhone: string | null;
    recordedAt: string | null;
    createdAt: string;
    callRecordId: string;
    client: ClientRef | null;
    hasLowConfidence: boolean;
    possibleDuplicate: boolean;
    phoneMatchesExistingClient: boolean;
}

/**
 * What GET /client-drafts/:id actually nests: the raw call_record row +
 * matchedClient. Unlike CallRecordDetail it has NO draft / summaryLine /
 * driveUrl (those are list/detail projections) — build the Drive link from
 * driveFileId.
 */
export interface DraftCallRecord {
    id: string;
    driveFileId: string;
    fileName: string;
    recordedAt: string | null;
    transcript: TranscriptTurn[];
    summary: Record<string, string> | null;
    category: CallCategory | null;
    callerName: string | null;
    callerPhone: string | null;
    matchedClient: ClientRef | null;
    createdAt: string;
}

export interface ClientDraftDetail {
    id: string;
    type: DraftType;
    status: DraftStatus;
    clientId: number | null;
    callRecordId: string;
    proposals: Proposal[];
    requestSummary: string;
    extractionMeta: { model: string; promptVersion: string } | null;
    callRecord: DraftCallRecord;
    client: (ClientRef & Record<string, unknown>) | null;
    reviewedBy: { id: string; name: string } | null;
    reviewedAt: string | null;
    discardReason: string | null;
    createdAt: string;
}

export interface ConfirmDraftBody {
    fields: {
        name: string;
        careCenter: boolean;
        voucherClient: boolean;
        breastPump: boolean;
        [key: string]: unknown;
    };
    suppressGreetingSms?: boolean;
}

export interface ConfirmUpdateBody {
    changes: Record<string, string | number | boolean | null>;
}
