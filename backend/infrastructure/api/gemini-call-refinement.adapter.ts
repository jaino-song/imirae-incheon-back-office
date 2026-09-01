import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
    CallRefinementInput,
    CallRefinementPort,
    CallRefinementResult,
    REFINED_SPEAKERS,
} from "domain/ports/call-refinement.port";
import {
    buildCallRefinementPrompt,
    CALL_REFINEMENT_RESPONSE_SCHEMA,
} from "application/services/call-refinement.prompt";
import { resolveCallExtractionModel } from "infrastructure/api/gemini-call-extraction.adapter";

const GEMINI_URL_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const TIMEOUT_MS = 60_000;
const ALLOWED_SPEAKERS = new Set<string>(REFINED_SPEAKERS);
/** Floor on retained turns; below this the model summarised rather than refined. */
const MIN_RETAINED_TURN_RATIO = 0.8;

@Injectable()
export class GeminiCallRefinementAdapter implements CallRefinementPort {
    private readonly logger = new Logger(GeminiCallRefinementAdapter.name);

    constructor(private readonly configService: ConfigService) {}

    async refine(input: CallRefinementInput): Promise<CallRefinementResult> {
        const apiKey = this.configService.get<string>("GEMINI_API_KEY")?.trim() ?? "";
        if (!apiKey) {
            throw new Error("GEMINI_API_KEY not configured");
        }

        const model = resolveCallExtractionModel(this.configService);
        const response = await fetch(`${GEMINI_URL_BASE}/${model}:generateContent`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-goog-api-key": apiKey,
            },
            body: JSON.stringify({
                contents: [{ parts: [{ text: buildCallRefinementPrompt(input) }] }],
                generationConfig: {
                    responseMimeType: "application/json",
                    responseSchema: CALL_REFINEMENT_RESPONSE_SCHEMA,
                },
            }),
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });

        if (!response.ok) {
            const detail = await response.text().catch(() => "");
            throw new Error(`Gemini refinement failed (${response.status}): ${detail.slice(0, 500)}`);
        }

        const data = (await response.json()) as {
            candidates?: { content?: { parts?: { text?: string }[] } }[];
        };
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) {
            throw new Error("Gemini refinement returned no candidates");
        }

        let parsed: CallRefinementResult;
        try {
            parsed = JSON.parse(text) as CallRefinementResult;
        } catch {
            throw new Error(`Gemini refinement returned unparseable JSON (length=${text.length})`);
        }

        this.assertValidRefinement(parsed, input);
        return parsed;
    }

    /**
     * Validation beyond the extraction sibling: the response schema's enum
     * already constrains speaker at the model layer, but a model can still
     * deviate (e.g. emitting "상담사" instead of "상담원"). Catching that here —
     * rather than trusting the schema alone — throws so the record goes
     * FAILED and the retry cron re-runs, instead of letting an
     * out-of-vocabulary speaker poison the mobile UI's speaker-set
     * classification (TranscriptView.tsx renders anything outside the six
     * literals as unattributed, but a near-miss like "상담사" is a silent
     * misclassification rather than a loud failure).
     *
     * Turn count and text are checked for the same reason: the port contract
     * (call-refinement.port.ts) requires same-count/same-order output, and a
     * model that summarises 120 turns into 15 — or drops a turn's text —
     * would otherwise persist silently; a missing text also crashes the
     * mobile review sheet's evidence lookup at render time.
     *
     * The count check is deliberately a floor, not equality. Refinement failure
     * is not free: it marks the record FAILED, and the retry cron re-runs the
     * same prompt over the same input at most MAX_ATTEMPTS times, so a check
     * that a well-behaved model trips reproducibly strands the call in terminal
     * FAILED — no draft, no inbox entry. Merging or splitting a couple of
     * adjacent turns is ordinary model behaviour and costs nothing; wholesale
     * summarisation is the actual hazard, and it is what the floor catches.
     */
    private assertValidRefinement(parsed: CallRefinementResult, input: CallRefinementInput): void {
        if (!Array.isArray(parsed.transcript) || parsed.transcript.length === 0) {
            throw new Error("Gemini refinement returned an empty or non-array transcript");
        }
        if (parsed.transcript.length < input.segments.length * MIN_RETAINED_TURN_RATIO) {
            throw new Error(
                `Gemini refinement dropped turns (in=${input.segments.length}, out=${parsed.transcript.length})`,
            );
        }
        for (const turn of parsed.transcript) {
            if (!ALLOWED_SPEAKERS.has(turn.speaker)) {
                throw new Error(`Gemini refinement returned an unrecognized speaker: "${turn.speaker}"`);
            }
            if (typeof turn.text !== "string") {
                throw new Error("Gemini refinement returned a turn without string text");
            }
        }
    }
}
