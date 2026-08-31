import { TranscriptTurn } from "domain/ports/call-extraction.port";

export const CALL_REFINEMENT_PORT = Symbol("CallRefinementPort");

/**
 * Closed speaker-role vocabulary the refine stage may emit (design spec §4.3).
 * This is a shared contract with the mobile UI's speaker classification —
 * backend cannot import from mobile, so these literals are duplicated here
 * and MUST stay byte-identical to both:
 *   - `STAFF_SPEAKERS`/`CUSTOMER_SPEAKERS` in
 *     mobile/src/components/app/call-inbox/TranscriptView.tsx:10-11
 *     ({"아이미래로", "상담원"} / {"고객", "산모", "남편"})
 *   - `NEUTRAL_SPEAKER` in mobile/src/lib/call-inbox/types.ts:20 ("화자")
 * Any speaker outside these six literals renders unattributed on mobile, so
 * the refine port's implementations must never emit anything else.
 */
export const NEUTRAL_SPEAKER = "화자";
export const REFINED_SPEAKERS = ["아이미래로", "상담원", "고객", "산모", "남편", NEUTRAL_SPEAKER] as const;

export interface CallRefinementInput {
    /** raw diarized turns from call_record.transcriptRaw ("1"/"2" or similar STT speaker labels) */
    segments: TranscriptTurn[];
    /** sttMeta.diarized === true; when false, refine must not guess roles */
    diarized: boolean;
    fileName: string;
}

export interface CallRefinementResult {
    /** same turn count/order as input; speaker mapped into REFINED_SPEAKERS, text corrected */
    transcript: TranscriptTurn[];
}

export interface CallRefinementPort {
    refine(input: CallRefinementInput): Promise<CallRefinementResult>;
}
