import { CALL_TERM_CORRECTIONS, CALL_VOCABULARY } from "domain/constants/call-vocabulary";
import { NEUTRAL_SPEAKER, REFINED_SPEAKERS } from "domain/ports/call-refinement.port";

/** Bump whenever the refine prompt semantics change — stamped into client_draft.extractionMeta for provenance. */
export const CALL_REFINEMENT_PROMPT_VERSION = "v1";

export function buildCallRefinementPrompt(input: {
    segments: { speaker: string; text: string }[];
    diarized: boolean;
    fileName: string;
}): string {
    const transcriptText = input.segments
        .map((turn) => `[${turn.speaker}] ${turn.text}`)
        .join("\n");

    const correctionPairs = Object.entries(CALL_TERM_CORRECTIONS)
        .map(([wrong, right]) => `${wrong}→${right}`)
        .join(", ");

    const roleInstruction = input.diarized
        ? `화자 역할 매핑 (diarized=true): 원시 화자 라벨(예: "1", "2")을 아래 닫힌 어휘로만 매핑하십시오. 이 목록 외의 문자열은 절대 사용하지 마십시오.
  - 직원측: "아이미래로" 또는 "상담원"
  - 고객측: "고객", "산모", 또는 "남편" — 발화 내용으로 판단하여 선택`
        : `화자 역할 매핑 (diarized=false): 화자를 추측하지 마십시오. 모든 턴의 speaker는 예외 없이 문자 그대로 "${NEUTRAL_SPEAKER}"로 설정하십시오.`;

    return `# Role
당신은 '아이미래로'(산후도우미·산모신생아 건강관리 업체)의 통화 정제 전문가입니다.
원시 STT 전사를 읽고 (1) 잔여 인식 오류를 교정하고 (2) 화자 역할을 매핑합니다.
통화 분류나 정보 추출은 다음 단계가 담당하므로 여기서는 수행하지 마십시오.

# 용어 참고 (STT 잔여 오류 보정)
${correctionPairs}
표준 어휘: ${CALL_VOCABULARY.phrases.join(", ")}
날짜·금액·전화번호 숫자는 절대 변형하지 마십시오.

# ${roleInstruction}

# 출력 규칙
- 입력과 동일한 턴 수, 동일한 순서로 출력하십시오.
- text는 잔여 오류만 교정하고, 요약하거나 생략하지 마십시오.
- 출력은 엄격한 JSON 하나: {"transcript": [{"speaker": "...", "text": "..."}]}

# 입력
파일명: ${input.fileName}
diarized: ${input.diarized}

# 원시 전사
${transcriptText}`;
}

/** Gemini structured-output schema for the refine call */
export const CALL_REFINEMENT_RESPONSE_SCHEMA = {
    type: "OBJECT",
    properties: {
        transcript: {
            type: "ARRAY",
            items: {
                type: "OBJECT",
                properties: {
                    speaker: { type: "STRING", enum: [...REFINED_SPEAKERS] },
                    text: { type: "STRING" },
                },
                required: ["speaker", "text"],
            },
        },
    },
    required: ["transcript"],
} as const;
