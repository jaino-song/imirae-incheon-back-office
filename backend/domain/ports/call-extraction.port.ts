export const CALL_EXTRACTION_PORT = Symbol("CallExtractionPort");

export type CallCategory = "NEW_CONSULTATION" | "CLIENT_SERVICE" | "OTHER";

export interface TranscriptTurn {
    speaker: string;
    text: string;
}

export interface ExtractionProposal {
    /** client column name, validated against PROPOSAL_FIELDS allowlist */
    field: string;
    /** From the Gemini adapter this is always string|null (schema emits strings); the processing-service sanitizer coerces booleans/numbers before persistence. */
    value: string | number | boolean | null;
    /** verbatim transcript quote backing the value */
    evidence: string;
    confidence: "high" | "low";
}

export interface CallExtractionInput {
    transcript: TranscriptTurn[];
    summary?: Record<string, unknown> | null;
    fileName: string;
}

export interface CallExtractionResult {
    category: CallCategory;
    callerName: string | null;
    /** phone numbers spoken in the call, raw as heard (normalization happens outside) */
    callerPhoneCandidates: string[];
    /** one-line Korean summary of what the caller asked for */
    requestSummary: string;
    proposals: ExtractionProposal[];
    /** structured Korean call summary persisted to call_record.summary (spec §4.3); all four keys required. */
    summary: {
        inquiry_type: string;
        customer_info: string;
        key_content: string;
        result_action: string;
    };
}

export interface CallExtractionPort {
    extract(input: CallExtractionInput): Promise<CallExtractionResult>;
}
