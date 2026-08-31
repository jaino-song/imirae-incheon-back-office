import { ConfigService } from "@nestjs/config";

import {
    CallExtractionInput,
    CallExtractionPort,
    CallExtractionResult,
} from "domain/ports/call-extraction.port";
import { GeminiCallExtractionAdapter } from "infrastructure/api/gemini-call-extraction.adapter";
import {
    CallRefinementInput,
    CallRefinementPort,
    CallRefinementResult,
    NEUTRAL_SPEAKER,
} from "domain/ports/call-refinement.port";
import { GeminiCallRefinementAdapter } from "infrastructure/api/gemini-call-refinement.adapter";
import {
    AligoSendSmsParams,
    AligoSmsResponse,
    IAligoSmsApiPort,
} from "domain/ports/aligo-sms-api.port";
import {
    CreateDocumentPayload,
    CreateDocumentResponse,
    EformsignApiDocumentResponse,
    EformsignApiListResponse,
    EformsignReviewerMember,
    EformsignTokenResponse,
    IEformsignClientRepository,
} from "domain/repositories/eformsign.client.interface";
import { AligoApiClient } from "infrastructure/api/aligo-api.client";
import { EformsignApiClient } from "infrastructure/api/eformsign-api.client";
import {
    normalizeEformsignDocumentResponse,
    normalizeEformsignListResponse,
} from "infrastructure/api/eformsign-response.normalizer";
import {
    ChatMessage,
    FunctionCall,
    FunctionDeclaration,
    GeminiChatGateway,
    GeminiStreamChunk,
} from "infrastructure/api/gemini-chat.gateway";
import { VercelGeminiGateway } from "infrastructure/api/vercel-gemini.gateway";
import type { IGeminiGateway } from "application/services/ai-chat.service";

export const E2E_VENDOR_STUBS_ENV = "E2E_VENDOR_STUBS";
export const EFORMSIGN_STUB_USER_EMAIL = "e2e-stub@babyjamjam.test";
export const EFORMSIGN_STUB_COMPANY_ID = "e2e-stub-company";
export const EFORMSIGN_STUB_TEMPLATE_ID = "tpl-test";

const EFORMSIGN_STUB_ACCESS_TOKEN = "e2e-stub-token";
const EFORMSIGN_STUB_REFRESH_TOKEN = "e2e-stub-refresh-token";
const EFORMSIGN_STUB_API_URL = "https://stub.eformsign.invalid";
const GEMINI_STUB_PREFIX = "[e2e-stub] ";
const GEMINI_STUB_MAX_ECHO_LENGTH = 48;

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeGeminiStubText(value: string | undefined): string {
    const normalized = (value ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, GEMINI_STUB_MAX_ECHO_LENGTH);

    return normalized || "stub response";
}

function buildGeminiStubText(messages: ChatMessage[]): string {
    const lastUserMessage = [...messages]
        .reverse()
        .find((message) => message.role === "user")?.content;

    return `${GEMINI_STUB_PREFIX}${normalizeGeminiStubText(lastUserMessage)}`;
}

type EformsignStubWireDocument = Omit<
    EformsignApiDocumentResponse,
    "created_date" | "current_status" | "updated_date"
> & {
    created_date: string;
    detail_template_info?: {
        id: string;
        name: string;
    };
    histories?: unknown[];
    last_editor?: {
        recipient_type: string;
        id: string;
        name: string;
    };
    previous_status?: unknown[];
    recipients?: unknown[];
    updated_date: string;
    current_status: Omit<
        EformsignApiDocumentResponse["current_status"],
        "status_type" | "step_index" | "step_type"
    > & {
        status_type: number;
        step_index: number;
        step_type: number;
    };
};

/**
 * The list response is genuinely narrower than a single-document fetch: the vendor schema
 * carries no expiry pair at all, and lists step_recipients and fields as optional — the
 * vendor leaves them out unless asked. Typing the absences keeps the stub honest.
 */
type EformsignStubWireListDocument = Omit<EformsignStubWireDocument, "current_status" | "fields"> & {
    current_status: Omit<
        EformsignStubWireDocument["current_status"],
        "step_recipients" | "expired_date" | "_expired"
    >;
};

interface EformsignStubWireListResponse {
    documents: EformsignStubWireListDocument[];
    total_rows: string;
}

const STUB_EFORMSIGN_DOCUMENTS: EformsignStubWireDocument[] = [
    {
        id: "doc-finalize-test",
        document_number: "E2E-20260602-0002",
        template: {
            id: "tpl-test",
            name: "남동구 계약서",
        },
        detail_template_info: {
            id: "tpl-test",
            name: "남동구 계약서",
        },
        document_name: "최종 확인 테스트 계약서",
        creator: {
            recipient_type: "01",
            id: EFORMSIGN_STUB_USER_EMAIL,
            name: "E2E Stub Staff",
        },
        created_date: String(Date.parse("2026-06-02T09:00:00.000Z")),
        updated_date: String(Date.parse("2026-06-02T09:00:00.000Z")),
        last_editor: {
            recipient_type: "01",
            id: EFORMSIGN_STUB_USER_EMAIL,
            name: "E2E Stub Staff",
        },
        current_status: {
            status_type: 60,
            status_doc_type: "진행중",
            status_doc_detail: "검토 필요",
            step_type: 5,
            step_index: 3,
            step_name: "이용자 서명",
            step_recipients: [
                {
                    recipient_type: "01",
                    id: "hong-test",
                    name: "홍테스트",
                },
            ],
            step_group: 0,
            expired_date: 0,
            _expired: false,
        },
        fields: [],
        next_status: [],
        previous_status: [],
        histories: [],
        recipients: [],
    },
    {
        id: "doc-delete-target",
        document_number: "E2E-20260603-0003",
        template: {
            id: "tpl-existing-test",
            name: "남동구 계약서",
        },
        detail_template_info: {
            id: "tpl-existing-test",
            name: "남동구 계약서",
        },
        document_name: "삭제 대상 테스트 계약서",
        creator: {
            recipient_type: "01",
            id: EFORMSIGN_STUB_USER_EMAIL,
            name: "E2E Stub Staff",
        },
        created_date: String(Date.parse("2026-06-03T09:00:00.000Z")),
        updated_date: String(Date.parse("2026-06-03T09:00:00.000Z")),
        last_editor: {
            recipient_type: "01",
            id: EFORMSIGN_STUB_USER_EMAIL,
            name: "E2E Stub Staff",
        },
        current_status: {
            status_type: 2,
            status_doc_type: "진행중",
            status_doc_detail: "대기",
            step_type: 1,
            step_index: 1,
            step_name: "발송 대기",
            step_recipients: [
                {
                    recipient_type: "02",
                    id: "",
                    name: "홍테스트",
                },
            ],
            step_group: 0,
            expired_date: 30,
            _expired: false,
        },
        fields: [],
        next_status: [],
        previous_status: [],
        histories: [],
        recipients: [],
    },
    {
        id: "doc-keep-1",
        document_number: "E2E-20260602-0001",
        template: {
            id: "tpl-existing-test",
            name: "남동구 계약서",
        },
        detail_template_info: {
            id: "tpl-existing-test",
            name: "남동구 계약서",
        },
        document_name: "유지 대상 테스트 계약서",
        creator: {
            recipient_type: "01",
            id: EFORMSIGN_STUB_USER_EMAIL,
            name: "E2E Stub Staff",
        },
        created_date: String(Date.parse("2026-06-02T09:00:00.000Z")),
        updated_date: String(Date.parse("2026-06-02T09:00:00.000Z")),
        last_editor: {
            recipient_type: "01",
            id: EFORMSIGN_STUB_USER_EMAIL,
            name: "E2E Stub Staff",
        },
        current_status: {
            status_type: 2,
            status_doc_type: "진행중",
            status_doc_detail: "대기",
            step_type: 1,
            step_index: 1,
            step_name: "발송 대기",
            step_recipients: [
                {
                    recipient_type: "02",
                    id: "",
                    name: "홍테스트",
                },
            ],
            step_group: 0,
            expired_date: 29,
            _expired: false,
        },
        fields: [],
        next_status: [],
        previous_status: [],
        histories: [],
        recipients: [],
    },
    {
        id: "doc-create-test",
        document_number: "E2E-20260501-0001",
        template: {
            id: "tpl-create-test",
            name: "남동구 계약서",
        },
        detail_template_info: {
            id: "tpl-create-test",
            name: "남동구 계약서",
        },
        document_name: "생성 테스트 계약서",
        creator: {
            recipient_type: "01",
            id: EFORMSIGN_STUB_USER_EMAIL,
            name: "E2E Stub Staff",
        },
        created_date: String(Date.parse("2026-05-01T09:00:00.000Z")),
        updated_date: String(Date.parse("2026-05-01T09:00:00.000Z")),
        last_editor: {
            recipient_type: "01",
            id: EFORMSIGN_STUB_USER_EMAIL,
            name: "E2E Stub Staff",
        },
        current_status: {
            status_type: 60,
            status_doc_type: "진행중",
            status_doc_detail: "대기",
            step_type: 5,
            step_index: 2,
            step_name: "이용자 서명",
            step_recipients: [
                {
                    recipient_type: "02",
                    id: "",
                    name: "홍테스트",
                },
            ],
            step_group: 0,
            expired_date: 60,
            _expired: false,
        },
        fields: [],
        next_status: [],
        previous_status: [],
        histories: [],
        recipients: [],
    },
];

function cloneStubDocument<T>(value: T): T {
    return structuredClone(value);
}

function buildFallbackStubDocument(documentId: string): EformsignStubWireDocument {
    return {
        id: documentId,
        document_number: `E2E-${documentId}`,
        template: {
            id: EFORMSIGN_STUB_TEMPLATE_ID,
            name: "남동구 계약서",
        },
        detail_template_info: {
            id: EFORMSIGN_STUB_TEMPLATE_ID,
            name: "남동구 계약서",
        },
        document_name: `Stub Document ${documentId}`,
        creator: {
            recipient_type: "01",
            id: EFORMSIGN_STUB_USER_EMAIL,
            name: "E2E Stub Staff",
        },
        created_date: String(Date.parse("2026-06-06T00:00:00.000Z")),
        updated_date: String(Date.parse("2026-06-06T00:00:00.000Z")),
        last_editor: {
            recipient_type: "01",
            id: EFORMSIGN_STUB_USER_EMAIL,
            name: "E2E Stub Staff",
        },
        current_status: {
            status_type: 2,
            status_doc_type: "진행중",
            status_doc_detail: "대기",
            step_type: 1,
            step_index: 1,
            step_name: "발송 대기",
            step_recipients: [
                {
                    recipient_type: "02",
                    id: "",
                    name: "홍테스트",
                },
            ],
            step_group: 0,
            expired_date: 30,
            _expired: false,
        },
        fields: [],
        next_status: [],
        previous_status: [],
        histories: [],
        recipients: [],
    };
}

function buildCreatedStubDocumentId(payload: CreateDocumentPayload): string {
    const recipientKey = payload.recipient?.sms ?? payload.reviewer?.id ?? "";
    const source = `${payload.templateId}:${payload.documentName}:${recipientKey}`;
    return `doc-stub-${Buffer.from(source).toString("hex").slice(0, 16)}`;
}

export function areE2EVendorStubsEnabled(configService: Pick<ConfigService, "get">): boolean {
    return configService.get<string>(E2E_VENDOR_STUBS_ENV) === "1";
}

/**
 * Fail-fast guard for the opposite direction from the NODE_ENV=production
 * check in main.ts: in a test-like boot, a MISSING or misspelled
 * E2E_VENDOR_STUBS must never silently fall through to the real Aligo /
 * eformsign / Gemini clients (createAligoPortClient / createEformsignClientRepository /
 * createGeminiGateway above all fail open to the real client when the flag
 * isn't exactly "1").
 *
 * "Test-like" is NOT just NODE_ENV==="test" — the one place this repo boots
 * main.ts under e2e conditions (.github/workflows/mobile-ci.yml `e2e` job)
 * deliberately sets NODE_ENV=development (only production is special-cased
 * elsewhere) alongside CI=true, GITHUB_ACTIONS=true, and E2E_VENDOR_STUBS=1. Jest unit specs never
 * invoke bootstrap() at all (see test/e2e/call-inbox.e2e.spec.ts header — the
 * AppModule can't even be built under ts-jest), so NODE_ENV=test alone would
 * never actually cover the real failure mode this guards against. Hence:
 * NODE_ENV==="test" OR the GitHub Actions CI runtime (and never for
 * NODE_ENV==="production", which already has its own dedicated guard and must
 * not regress). CI alone is insufficient because deployment platforms such as
 * Railway also expose CI=true to production-like preview runtimes.
 */
export function assertVendorStubsConfigured(configService: Pick<ConfigService, "get">): void {
    const nodeEnv = configService.get<string>("NODE_ENV");
    if (nodeEnv === "production") {
        return;
    }

    const isCi = configService.get<string>("CI") === "true";
    const isGitHubActions = configService.get<string>("GITHUB_ACTIONS") === "true";
    const isTestLikeEnv = nodeEnv === "test" || (isCi && isGitHubActions);
    if (!isTestLikeEnv) {
        return;
    }

    const rawValue = configService.get<string>(E2E_VENDOR_STUBS_ENV);
    if (rawValue === "1") {
        return;
    }

    const nearMissHint = rawValue !== undefined && rawValue !== ""
        ? ` 감지된 값 "${rawValue}"은 정확히 "1"이 아니므로 무효 처리되어 실 API가 호출됩니다 (detected value "${rawValue}" is not exactly "1" — it is silently ignored and real vendor APIs will be called).`
        : "";

    throw new Error(
        `E2E/test 환경에서는 ${E2E_VENDOR_STUBS_ENV}=1이 필수입니다 — 실제 외부 API(Aligo/eformsign/Gemini) 호출을 차단합니다.${nearMissHint} ` +
        `(${E2E_VENDOR_STUBS_ENV} must be exactly "1" in test/e2e environments to block real vendor API calls.)`,
    );
}

export function buildEformsignStubTokenResponse(): EformsignTokenResponse {
    return {
        oauth_token: {
            access_token: EFORMSIGN_STUB_ACCESS_TOKEN,
            refresh_token: EFORMSIGN_STUB_REFRESH_TOKEN,
        },
        api_key: {
            company: {
                api_url: EFORMSIGN_STUB_API_URL,
            },
        },
    };
}

function buildEformsignStubWireDocuments(): EformsignStubWireDocument[] {
    return STUB_EFORMSIGN_DOCUMENTS
        .map((document) => cloneStubDocument(document))
        .sort((left, right) => Number(right.created_date) - Number(left.created_date));
}

function buildEformsignStubWireDocument(documentId: string): EformsignStubWireDocument {
    const existing = STUB_EFORMSIGN_DOCUMENTS.find((document) => document.id === documentId);
    return cloneStubDocument(existing ?? buildFallbackStubDocument(documentId));
}

export function buildEformsignStubDocuments(): EformsignApiDocumentResponse[] {
    return buildEformsignStubWireDocuments().map(normalizeEformsignDocumentResponse);
}

export function buildEformsignStubListResponse(
    documentType: "01" | "03" | "04",
    limit: number,
    skip: number,
): EformsignStubWireListResponse {
    const documents = documentType === "01"
        ? buildEformsignStubWireDocuments().slice(skip, skip + limit)
        : [];

    return buildSpecShapedEformsignListResponse(
        documents,
        documentType === "01" ? STUB_EFORMSIGN_DOCUMENTS.length : 0,
    );
}

function buildSpecShapedEformsignListResponse(
    documents: EformsignStubWireDocument[],
    totalRows = documents.length,
): EformsignStubWireListResponse {
    return {
        documents: documents.map((document) => {
            // The list response is a narrower shape than a single-document fetch. The
            // expiry pair is absent from the list schema outright; step_recipients and
            // fields are in it but optional, and the vendor omits them unless asked.
            // Omitting all four is the shape our readers actually have to survive.
            // eslint-disable-next-line @typescript-eslint/no-unused-vars -- named only to drop them
            const { step_recipients, expired_date, _expired, ...current_status } = document.current_status;
            // eslint-disable-next-line @typescript-eslint/no-unused-vars -- named only to drop it
            const { fields, ...listDocument } = { ...document, current_status };
            return listDocument;
        }),
        total_rows: String(totalRows),
    };
}

export function buildEformsignStubDocument(documentId: string): EformsignStubWireDocument {
    return buildEformsignStubWireDocument(documentId);
}

export function buildEformsignStubCreateDocumentResponse(
    payload: CreateDocumentPayload,
): CreateDocumentResponse {
    return {
        documentId: buildCreatedStubDocumentId(payload),
        status: "created",
    };
}

export function buildEformsignStubDeleteResponse(documentIds: string[]) {
    return {
        code: 0,
        message: "stubbed",
        status: 200,
        result: {
            success_result: documentIds,
            fail_result: [],
        },
    };
}

export function buildEformsignStubReRequestResponse(documentId: string) {
    return {
        code: 0,
        message: "stubbed",
        status: "re-requested",
        documentId,
    };
}

export function buildEformsignStubPdf(documentId: string, fileType: "document" | "audit_trail"): Buffer {
    const pdf = [
        "%PDF-1.4",
        "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj",
        "2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj",
        "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]/Contents 4 0 R>>endobj",
        `4 0 obj<</Length 60>>stream\nBT /F1 12 Tf 18 140 Td (${documentId} ${fileType}) Tj ET\nendstream endobj`,
        "trailer<</Root 1 0 R>>",
        "%%EOF",
    ].join("\n");

    return Buffer.from(pdf);
}

export class E2eEformsignClientStub implements IEformsignClientRepository {
    getAccessToken(executionTime: number): Promise<EformsignTokenResponse> {
        void executionTime;
        return Promise.resolve(buildEformsignStubTokenResponse());
    }

    refreshAccessToken(executionTime: number, refreshToken: string): Promise<EformsignTokenResponse> {
        void executionTime;
        void refreshToken;
        return Promise.resolve(buildEformsignStubTokenResponse());
    }

    getInProgressDocuments(
        accessToken: string,
        limit = 100,
        skip = 0,
    ): Promise<EformsignApiDocumentResponse[]> {
        return this.getInProgressDocumentsPage(accessToken, limit, skip)
            .then((page) => page.documents);
    }

    getInProgressDocumentsPage(
        accessToken: string,
        limit = 100,
        skip = 0,
    ): Promise<EformsignApiListResponse> {
        void accessToken;
        const documents = buildEformsignStubWireDocuments();
        return Promise.resolve(normalizeEformsignListResponse(
            buildSpecShapedEformsignListResponse(
                documents.slice(skip, skip + limit),
                documents.length,
            ),
        ));
    }

    getCompletedDocuments(
        accessToken: string,
        limit = 100,
        skip = 0,
    ): Promise<EformsignApiDocumentResponse[]> {
        return this.getCompletedDocumentsPage(accessToken, limit, skip)
            .then((page) => page.documents);
    }

    getCompletedDocumentsPage(
        accessToken: string,
        limit = 100,
        skip = 0,
    ): Promise<EformsignApiListResponse> {
        void accessToken;
        const documents = buildEformsignStubWireDocuments();
        return Promise.resolve(normalizeEformsignListResponse(
            buildSpecShapedEformsignListResponse(
                documents.slice(skip, skip + limit),
                documents.length,
            ),
        ));
    }

    getRejectedDocuments(
        accessToken: string,
        limit = 100,
        skip = 0,
    ): Promise<EformsignApiDocumentResponse[]> {
        return this.getRejectedDocumentsPage(accessToken, limit, skip)
            .then((page) => page.documents);
    }

    getRejectedDocumentsPage(
        accessToken: string,
        limit = 100,
        skip = 0,
    ): Promise<EformsignApiListResponse> {
        void accessToken;
        void limit;
        void skip;
        return Promise.resolve(normalizeEformsignListResponse(
            buildSpecShapedEformsignListResponse([], 0),
        ));
    }

    getAllDocuments(accessToken: string): Promise<EformsignApiDocumentResponse[]> {
        void accessToken;
        return Promise.resolve(buildEformsignStubDocuments());
    }

    findDocumentsByTitle(
        accessToken: string,
        title: string,
    ): Promise<EformsignApiDocumentResponse[]> {
        void accessToken;
        return Promise.resolve(
            buildEformsignStubDocuments().filter((document) => document.document_name === title),
        );
    }

    getDocument(accessToken: string, documentId: string): Promise<EformsignApiDocumentResponse> {
        void accessToken;
        return Promise.resolve(
            normalizeEformsignDocumentResponse(buildEformsignStubWireDocument(documentId)),
        );
    }

    createDocument(accessToken: string, payload: CreateDocumentPayload): Promise<CreateDocumentResponse> {
        void accessToken;
        return Promise.resolve(buildEformsignStubCreateDocumentResponse(payload));
    }

    getTemplateReviewer(accessToken: string, templateId: string): Promise<EformsignReviewerMember | null> {
        void accessToken;
        void templateId;
        return Promise.resolve({ name: "E2E 검토자", id: "e2e-reviewer@example.com", phoneNumber: "01000000000" });
    }
}

export class E2eAligoApiStub implements IAligoSmsApiPort {
    sendSms(params: AligoSendSmsParams): Promise<AligoSmsResponse> {
        return Promise.resolve({
            result_code: 1,
            message: "stubbed",
            msg_type: params.msgType ?? "SMS",
            success_cnt: 1,
            error_cnt: 0,
        });
    }
}

/**
 * Deterministic Gemini double for e2e runs. SCOPE: text streaming only —
 * it never emits "function_call" (or "error") chunks, so the agentic
 * tool-execution loop in AIChatService.chatStream is intentionally NOT
 * exercised under E2E_VENDOR_STUBS=1. Tool-calling regressions are covered
 * by unit tests, not the e2e suite.
 */
export class E2eGeminiGatewayStub implements IGeminiGateway {
    async chat(
        messages: ChatMessage[],
        tools?: FunctionDeclaration[],
    ): Promise<{ text?: string; functionCall?: FunctionCall }> {
        void tools;
        return {
            text: buildGeminiStubText(messages),
        };
    }

    async *chatStream(
        messages: ChatMessage[],
        tools?: FunctionDeclaration[],
    ): AsyncGenerator<GeminiStreamChunk> {
        void tools;
        const responseText = buildGeminiStubText(messages);
        const chunks = [
            GEMINI_STUB_PREFIX,
            responseText.slice(GEMINI_STUB_PREFIX.length, GEMINI_STUB_PREFIX.length + 12),
            responseText.slice(GEMINI_STUB_PREFIX.length + 12),
        ].filter((chunk) => chunk.length > 0);

        await sleep(10);
        for (const chunk of chunks) {
            yield { type: "text", content: chunk };
            await sleep(10);
        }

        yield { type: "done" };
    }

    async sendFunctionResult(
        messages: ChatMessage[],
        functionName: string,
        result: unknown,
        tools?: FunctionDeclaration[],
    ): Promise<{ text?: string; functionCall?: FunctionCall }> {
        void tools;

        return {
            text: `${GEMINI_STUB_PREFIX}${normalizeGeminiStubText(`${functionName} ${JSON.stringify(result)}`)}`,
        };
    }
}

export function createEformsignClientRepository(configService: ConfigService): IEformsignClientRepository {
    return areE2EVendorStubsEnabled(configService)
        ? new E2eEformsignClientStub()
        : new EformsignApiClient(configService);
}

export function createAligoPortClient(configService: ConfigService): IAligoSmsApiPort {
    return areE2EVendorStubsEnabled(configService)
        ? new E2eAligoApiStub()
        : new AligoApiClient(configService);
}

export function createGeminiGateway(configService: ConfigService): IGeminiGateway {
    if (areE2EVendorStubsEnabled(configService)) {
        return new E2eGeminiGatewayStub();
    }

    const useVercelAiSdk = configService.get<string>("USE_VERCEL_AI_SDK") === "true";
    if (useVercelAiSdk) {
        return new VercelGeminiGateway(configService);
    }

    return new GeminiChatGateway(configService);
}

export class StubCallExtractionAdapter implements CallExtractionPort {
    async extract(_input: CallExtractionInput): Promise<CallExtractionResult> {
        return {
            category: "NEW_CONSULTATION",
            callerName: "김서연",
            callerPhoneCandidates: ["010-4821-7763"],
            requestSummary: "산후도우미 신규 문의 (E2E stub)",
            proposals: [
                { field: "name", value: "김서연", evidence: "stub", confidence: "high" },
                { field: "dueDate", value: "2026-07-15", evidence: "stub", confidence: "high" },
            ],
        };
    }
}

export function createCallExtractionAdapter(configService: ConfigService): CallExtractionPort {
    if (areE2EVendorStubsEnabled(configService)) {
        return new StubCallExtractionAdapter();
    }
    return new GeminiCallExtractionAdapter(configService);
}

/**
 * Deterministic diarized-speaker map for the e2e stub. Only "1"/"2" are
 * mapped (the raw labels this repo's fixtures use); any other raw speaker
 * falls back to NEUTRAL_SPEAKER rather than guessing a role — the same
 * never-guess posture the real refine prompt takes for diarized:false.
 */
const STUB_DIARIZED_SPEAKER_MAP: Readonly<Record<string, string>> = {
    "1": "아이미래로",
    "2": "고객",
};

export class StubCallRefinementAdapter implements CallRefinementPort {
    async refine(input: CallRefinementInput): Promise<CallRefinementResult> {
        return {
            transcript: input.segments.map((turn) => ({
                speaker: input.diarized
                    ? (STUB_DIARIZED_SPEAKER_MAP[turn.speaker] ?? NEUTRAL_SPEAKER)
                    : NEUTRAL_SPEAKER,
                text: turn.text,
            })),
        };
    }
}

export function createCallRefinementAdapter(configService: ConfigService): CallRefinementPort {
    if (areE2EVendorStubsEnabled(configService)) {
        return new StubCallRefinementAdapter();
    }
    return new GeminiCallRefinementAdapter(configService);
}
