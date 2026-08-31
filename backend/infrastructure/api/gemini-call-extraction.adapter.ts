import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
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

        try {
            return JSON.parse(text) as CallExtractionResult;
        } catch {
            throw new Error(`Gemini extraction returned unparseable JSON (length=${text.length})`);
        }
    }
}
