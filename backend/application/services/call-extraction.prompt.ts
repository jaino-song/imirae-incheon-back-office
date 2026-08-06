// v3: birthDate joined the proposal fields, so drafts extracted before this
// could not carry an actual delivery date.
export const CALL_EXTRACTION_PROMPT_VERSION = "v3";

/**
 * client fields a proposal may target (spec §6).
 *
 * Doubles as the allowlist `prepareClientUpdateChanges` filters a CLIENT_UPDATE
 * confirm through, so a field missing here cannot be proposed OR applied.
 */
export const PROPOSAL_FIELDS = [
    "name", "phone", "address", "dueDate", "birthDate", "birthday",
    "startDate", "endDate", "duration", "type",
    "careCenter", "voucherClient", "breastPump",
    "serviceStatus", "fullPrice", "grant", "actualPrice",
] as const;

export function buildCallExtractionPrompt(input: {
    transcript: { speaker: string; text: string }[];
    summary?: Record<string, unknown> | null;
    fileName: string;
}): string {
    const transcriptText = input.transcript
        .map((turn) => `[${turn.speaker}] ${turn.text}`)
        .join("\n");

    return `# Role
당신은 '아이미래로'(산후도우미·산모신생아 건강관리 업체)의 통화 분석 전문가입니다.
정제된 통화 스크립트를 읽고 (1) 통화를 분류하고 (2) 고객/서비스 정보를 구조화하여 추출합니다.

# 용어 참고 (STT 잔여 오류 보정)
산우도우미→산후도우미, 구리원/조류원→조리원, 알루사님→관리사님, 재앙절개→제왕절개,
단퇴→단태아, 쌍/쌍둥→쌍둥이, A가/가형→A가형, A라/라형→A라형, A 통합→A-통합형,
나비/라비→납입(결제 문맥). 날짜·금액·전화번호 숫자는 절대 변형 금지.

# 분류 (category)
- NEW_CONSULTATION: 산후도우미 서비스를 새로 시작하려는 문의/상담 (예약, 견적, 정부지원 문의 포함)
- CLIENT_SERVICE: 이미 서비스 이용 중이거나 계약된 고객의 변경/요청
  (출산예정일·시작일·종료일 변경, 관리사 교체, 기간 연장, 서비스 종료, 일정 조정 등)
- OTHER: 그 외 전부 (주차, 제휴/영업, 오배송, 잘못 건 전화, 스팸 등)

# 추출 규칙
- callerName: 고객(산모) 이름. 언급 없으면 null.
- callerPhoneCandidates: 통화에서 "불러준" 전화번호들 (들리는 그대로). 없으면 [].
  파일명에도 번호가 있을 수 있으나 그것은 시스템이 따로 처리하므로 무시.
- requestSummary: 고객 요청을 한국어 한 문장으로.
- proposals: category별로 다음 필드만 사용 (그 외 필드명 금지):
  ${PROPOSAL_FIELDS.join(", ")}
  - NEW_CONSULTATION: 파악된 모든 고객 정보 (name, phone, address, dueDate,
    duration(일수, 숫자), careCenter(조리원 이용, boolean), voucherClient(정부지원, boolean),
    startDate(희망 시작일), type 등)
  - CLIENT_SERVICE: 변경 요청된 필드만. 관리사 교체 요청 → field "serviceStatus",
    value "replacement_requested". 서비스 종료 요청 → "serviceStatus", "terminated".
    출산했다는 알림("어제 낳았어요", "8월 5일에 출산했어요") → field "birthDate".
    아직 낳지 않은 예정일은 "birthDate"가 아니라 "dueDate"입니다.
  - OTHER: proposals는 [].
- 각 proposal: value(날짜는 YYYY-MM-DD, 기간은 일수 숫자, boolean은 true/false),
  evidence(근거가 된 발화 인용, 원문 그대로), confidence("high" | "low").
- 언급되지 않은 필드는 proposals에 포함하지 마십시오. "해당 없음"도 포함 금지.
- 추측은 confidence "low"로 표시 (예: "부평구청 근처" → address, low).

# 입력
파일명: ${input.fileName}
${input.summary ? `1차 요약: ${JSON.stringify(input.summary)}` : ""}

# 스크립트
${transcriptText}`;
}

/** Gemini structured-output schema for the extraction call */
export const CALL_EXTRACTION_RESPONSE_SCHEMA = {
    type: "OBJECT",
    properties: {
        category: { type: "STRING", enum: ["NEW_CONSULTATION", "CLIENT_SERVICE", "OTHER"] },
        callerName: { type: "STRING", nullable: true },
        callerPhoneCandidates: { type: "ARRAY", items: { type: "STRING" } },
        requestSummary: { type: "STRING" },
        proposals: {
            type: "ARRAY",
            items: {
                type: "OBJECT",
                properties: {
                    field: { type: "STRING" },
                    value: { type: "STRING", nullable: true },
                    evidence: { type: "STRING" },
                    confidence: { type: "STRING", enum: ["high", "low"] },
                },
                required: ["field", "value", "evidence", "confidence"],
            },
        },
    },
    required: ["category", "callerPhoneCandidates", "requestSummary", "proposals"],
} as const;
