import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
    CallCategory,
    CallExtractionInput,
    CallExtractionPort,
    CallExtractionResult,
} from "domain/ports/call-extraction.port";
import {
    buildCallExtractionPrompt,
    CALL_EXTRACTION_RESPONSE_SCHEMA,
} from "application/services/call-extraction.prompt";

const GEMINI_URL_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const TIMEOUT_MS = 60_000;

/** Default Gemini model for extraction (and, via `resolveCallExtractionModel`, refine — spec :120-121). */
export const DEFAULT_CALL_EXTRACTION_MODEL = "gemini-2.5-flash";

/** GEMINI_EXTRACTION_MODEL governs both the extract and refine Gemini calls. */
export function resolveCallExtractionModel(config: ConfigService): string {
    return config.get<string>("GEMINI_EXTRACTION_MODEL")?.trim() || DEFAULT_CALL_EXTRACTION_MODEL;
}

@Injectable()
export class GeminiCallExtractionAdapter implements CallExtractionPort {
    private readonly logger = new Logger(GeminiCallExtractionAdapter.name);

    constructor(private readonly configService: ConfigService) {}

    async extract(input: CallExtractionInput): Promise<CallExtractionResult> {
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
                contents: [{ parts: [{ text: buildCallExtractionPrompt(input) }] }],
                generationConfig: {
                    responseMimeType: "application/json",
                    responseSchema: CALL_EXTRACTION_RESPONSE_SCHEMA,
                },
            }),
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });

        if (!response.ok) {
            const detail = await response.text().catch(() => "");
            throw new Error(`Gemini extraction failed (${response.status}): ${detail.slice(0, 500)}`);
        }

        const data = (await response.json()) as {
            candidates?: { content?: { parts?: { text?: string }[] } }[];
        };
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) {
            throw new Error("Gemini extraction returned no candidates");
        }

        let parsed: CallExtractionResult;
        try {
            parsed = JSON.parse(text) as CallExtractionResult;
        } catch {
            throw new Error(`Gemini extraction returned unparseable JSON (length=${text.length})`);
        }

        this.assertValidExtraction(parsed);
        return parsed;
    }

    /**
     * The structured-output schema's `required` list is a hint, not a hard
     * constraint — a response missing `summary` (or carrying a category
     * outside the union) would otherwise be cast straight into
     * CallExtractionResult and persisted, landing the record in a terminal
     * EXTRACTED state with a NULL/partial summary the retry cron never
     * revisits. Throwing here sends the record to FAILED with a
     * failureReason so the cron retries instead.
     *
     * Summary values are checked for presence and string type, deliberately
     * NOT non-emptiness: a legitimately sparse call (wrong number, hang-up)
     * may yield an empty string, and failing it three times would strand the
     * record in terminal FAILED for a cosmetic gap.
     */
    private assertValidExtraction(parsed: CallExtractionResult): void {
        const categories: CallCategory[] = ["NEW_CONSULTATION", "CLIENT_SERVICE", "OTHER"];
        if (!categories.includes(parsed.category)) {
            throw new Error(`Gemini extraction returned an unrecognized category: "${parsed.category}"`);
        }
        if (typeof parsed.requestSummary !== "string") {
            throw new Error("Gemini extraction returned a non-string requestSummary");
        }
        if (!Array.isArray(parsed.proposals)) {
            throw new Error("Gemini extraction returned non-array proposals");
        }
        if (!Array.isArray(parsed.callerPhoneCandidates)) {
            throw new Error("Gemini extraction returned non-array callerPhoneCandidates");
        }
        const summary = parsed.summary as unknown;
        if (typeof summary !== "object" || summary === null || Array.isArray(summary)) {
            throw new Error("Gemini extraction returned no structured summary object");
        }
        for (const key of ["inquiry_type", "customer_info", "key_content", "result_action"] as const) {
            if (typeof parsed.summary[key] !== "string") {
                throw new Error(`Gemini extraction summary is missing string key "${key}"`);
            }
        }
    }
}
