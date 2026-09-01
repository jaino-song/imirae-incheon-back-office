/**
 * Business-domain vocabulary for the call-inbox transcription pipeline
 * (spec §4.5). `CALL_VOCABULARY` is served over
 * `GET /webhooks/call-transcripts/vocabulary` and fed to Gemini 3.5
 * Transcribe as `custom_vocabulary` by the n8n workflow — it must contain
 * ONLY correctly-spelled target terms. `custom_vocabulary` biases the
 * recognizer toward whatever it is given, so listing a misrecognition would
 * make transcription worse than an empty list.
 *
 * `CALL_TERM_CORRECTIONS` is the wrong→right map lifted from the same 교정
 * 사전 (`call-extraction.prompt.ts`'s "용어 참고" block) as a typed single
 * source for the refine/extract prompts to consume later. It is not served
 * by the endpoint.
 *
 * Both are lifted from the correction dictionary in
 * `application/services/call-extraction.prompt.ts`. Bump `version` (a
 * static date string) whenever either export changes.
 */
export const CALL_VOCABULARY = {
    version: "2026-09-01",
    phrases: [
        "산후도우미",
        "조리원",
        "관리사님",
        "제왕절개",
        "단태아",
        "쌍둥이",
        "A가형",
        "A라형",
        "A-통합형",
        "납입",
    ],
} as const;

export const CALL_TERM_CORRECTIONS: Readonly<Record<string, string>> = {
    "산우도우미": "산후도우미",
    "구리원": "조리원",
    "조류원": "조리원",
    "알루사님": "관리사님",
    "재앙절개": "제왕절개",
    "단퇴": "단태아",
    "쌍": "쌍둥이",
    "쌍둥": "쌍둥이",
    "A가": "A가형",
    "가형": "A가형",
    "A라": "A라형",
    "라형": "A라형",
    "A 통합": "A-통합형",
    "나비": "납입",
    "라비": "납입",
};
