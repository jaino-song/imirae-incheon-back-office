import { ConfigService } from "@nestjs/config";

import { AligoApiClient } from "infrastructure/api/aligo-api.client";
import { EformsignApiClient } from "infrastructure/api/eformsign-api.client";
import { GeminiChatGateway } from "infrastructure/api/gemini-chat.gateway";
import { VercelGeminiGateway } from "infrastructure/api/vercel-gemini.gateway";
import {
    assertVendorStubsConfigured,
    buildEformsignStubDocument,
    buildEformsignStubListResponse,
    createAligoPortClient,
    createEformsignClientRepository,
    createGeminiGateway,
    E2eAligoApiStub,
    E2eEformsignClientStub,
    E2eGeminiGatewayStub,
} from "infrastructure/vendor-stubs/e2e-vendor-stubs";

function createConfigService(overrides: Record<string, string | undefined> = {}): ConfigService {
    return {
        get: jest.fn((key: string) => {
            const values: Record<string, string | undefined> = {
                ALIGO_API_KEY: "aligo-key",
                ALIGO_API_URL: "https://kakaoapi.aligo.in",
                ALIGO_SENDER_KEY: "aligo-sender-key",
                ALIGO_SENDER_PHONE: "01012345678",
                ALIGO_SMS_API_URL: "https://apis.aligo.in",
                ALIGO_USER_ID: "aligo-user",
                E2E_VENDOR_STUBS: "0",
                EFORMSIGN_API_KEY: "eformsign-key",
                EFORMSIGN_API_URL: "https://api.eformsign.example",
                EFORMSIGN_DOC_API_URL: "https://doc.eformsign.example",
                EFORMSIGN_PRIVATE_KEY: "00",
                EFORMSIGN_USER_EMAIL: "staff@example.com",
                GEMINI_API_KEY: "gemini-key",
                USE_VERCEL_AI_SDK: "false",
                ...overrides,
            };

            return values[key];
        }),
    } as unknown as ConfigService;
}

describe("vendor stub factory selection", () => {
    it("keeps real vendor clients when E2E_VENDOR_STUBS is off", () => {
        const configService = createConfigService();

        expect(createEformsignClientRepository(configService)).toBeInstanceOf(EformsignApiClient);
        expect(createAligoPortClient(configService)).toBeInstanceOf(AligoApiClient);
        expect(createGeminiGateway(configService)).toBeInstanceOf(GeminiChatGateway);
    });

    it("keeps the Vercel Gemini gateway path when configured and stubs are off", () => {
        const configService = createConfigService({
            USE_VERCEL_AI_SDK: "true",
        });

        expect(createGeminiGateway(configService)).toBeInstanceOf(VercelGeminiGateway);
    });

    it("prefers the stub over the Vercel flag when both are set (precedence)", () => {
        const configService = createConfigService({
            E2E_VENDOR_STUBS: "1",
            USE_VERCEL_AI_SDK: "true",
        });

        expect(createGeminiGateway(configService)).toBeInstanceOf(E2eGeminiGatewayStub);
    });

    it("treats truthy-but-not-'1' stub flag values as OFF (fail-safe)", () => {
        for (const value of ["true", "yes", " 1"]) {
            const configService = createConfigService({ E2E_VENDOR_STUBS: value });

            expect(createGeminiGateway(configService)).toBeInstanceOf(GeminiChatGateway);
            expect(createAligoPortClient(configService)).toBeInstanceOf(AligoApiClient);
            expect(createEformsignClientRepository(configService)).toBeInstanceOf(EformsignApiClient);
        }
    });

    it("switches to stubbed vendor clients when E2E_VENDOR_STUBS is on", async () => {
        const configService = createConfigService({
            E2E_VENDOR_STUBS: "1",
            ALIGO_API_KEY: undefined,
            ALIGO_API_URL: undefined,
            ALIGO_SENDER_KEY: undefined,
            ALIGO_SENDER_PHONE: undefined,
            ALIGO_SMS_API_URL: undefined,
            ALIGO_USER_ID: undefined,
            EFORMSIGN_API_KEY: undefined,
            EFORMSIGN_API_URL: undefined,
            EFORMSIGN_DOC_API_URL: undefined,
            EFORMSIGN_PRIVATE_KEY: undefined,
            EFORMSIGN_USER_EMAIL: undefined,
            GEMINI_API_KEY: undefined,
        });

        const eformsignClient = createEformsignClientRepository(configService);
        const aligoClient = createAligoPortClient(configService);
        const geminiGateway = createGeminiGateway(configService);

        expect(eformsignClient).toBeInstanceOf(E2eEformsignClientStub);
        expect(aligoClient).toBeInstanceOf(E2eAligoApiStub);
        expect(geminiGateway).toBeInstanceOf(E2eGeminiGatewayStub);
        await expect(eformsignClient.getAllDocuments("ignored-token")).resolves.toEqual(
            expect.arrayContaining([
                expect.objectContaining({ id: "doc-create-test" }),
                expect.objectContaining({ id: "doc-finalize-test" }),
            ]),
        );
        await expect(aligoClient.sendSms({
            receiver: "01012345678",
            message: "테스트",
        })).resolves.toMatchObject({
            result_code: 1,
            error_cnt: 0,
            success_cnt: 1,
        });

        const streamEvents: Array<{ type: string; content?: string }> = [];
        for await (const event of geminiGateway.chatStream([
            { role: "system", content: "sys" },
            { role: "user", content: "안녕하세요 반가워요" },
        ])) {
            streamEvents.push(event);
        }

        expect(streamEvents).toEqual([
            { type: "text", content: "[e2e-stub] " },
            { type: "text", content: "안녕하세요 반가워요" },
            { type: "done" },
        ]);
    });

    it("returns raw vendor list values from the HTTP-boundary eformsign stub", () => {
        const page = buildEformsignStubListResponse("01", 1, 0);

        expect(Number(page.total_rows)).toBeGreaterThan(0);
        expect(typeof page.total_rows).toBe("string");
        expect(page.documents[0]).toEqual(expect.objectContaining({
            created_date: expect.stringMatching(/^\d+$/),
            updated_date: expect.stringMatching(/^\d+$/),
            current_status: expect.objectContaining({
                status_type: expect.any(Number),
                step_type: expect.any(Number),
                step_index: expect.any(Number),
            }),
        }));
        expect(page.documents[0]?.current_status).not.toHaveProperty("expired_date");
        expect(page.documents[0]?.current_status).not.toHaveProperty("_expired");
        // The list schema carries neither of these; only a single-document fetch does.
        expect(page.documents[0]?.current_status).not.toHaveProperty("step_recipients");
        expect(page.documents[0]).not.toHaveProperty("fields");
    });

    it("returns a raw vendor document from the HTTP-boundary eformsign stub", () => {
        const document = buildEformsignStubDocument("doc-finalize-test");

        expect(document).toEqual(expect.objectContaining({
            created_date: expect.stringMatching(/^\d+$/),
            updated_date: expect.stringMatching(/^\d+$/),
            current_status: expect.objectContaining({
                status_type: 60,
                step_type: 5,
                step_index: 3,
            }),
        }));
    });

    it("keeps API-client stub responses normalized for backfill consumers", async () => {
        const client = new E2eEformsignClientStub();

        const page = await client.getInProgressDocumentsPage("ignored-token", 1, 0);
        const document = await client.getDocument("ignored-token", "doc-finalize-test");

        expect(page).toEqual(expect.objectContaining({
            total_rows: expect.any(Number),
            documents: [
                expect.objectContaining({
                    created_date: expect.any(Number),
                    updated_date: expect.any(Number),
                    current_status: expect.objectContaining({
                        status_type: expect.stringMatching(/^\d{3}$/),
                        step_type: expect.stringMatching(/^\d{2}$/),
                        step_index: expect.any(String),
                    }),
                }),
            ],
        }));
        expect(document).toEqual(expect.objectContaining({
            created_date: expect.any(Number),
            updated_date: expect.any(Number),
            current_status: expect.objectContaining({
                status_type: "060",
                step_type: "05",
                step_index: "3",
            }),
        }));
    });
});

function createBootEnvConfigService(overrides: Record<string, string | undefined>): ConfigService {
    return {
        get: jest.fn((key: string) => overrides[key]),
    } as unknown as ConfigService;
}

describe("assertVendorStubsConfigured (boot-time guard)", () => {
    it("throws when NODE_ENV=test and E2E_VENDOR_STUBS is unset", () => {
        const configService = createBootEnvConfigService({ NODE_ENV: "test" });

        expect(() => assertVendorStubsConfigured(configService)).toThrow(/E2E_VENDOR_STUBS=1/);
    });

    it("passes when NODE_ENV=test and E2E_VENDOR_STUBS=1", () => {
        const configService = createBootEnvConfigService({ NODE_ENV: "test", E2E_VENDOR_STUBS: "1" });

        expect(() => assertVendorStubsConfigured(configService)).not.toThrow();
    });

    it("passes when NODE_ENV=production and E2E_VENDOR_STUBS is unset (no regression)", () => {
        const configService = createBootEnvConfigService({ NODE_ENV: "production" });

        expect(() => assertVendorStubsConfigured(configService)).not.toThrow();
    });

    it("passes when NODE_ENV=development and no CI/test signal (local dev, no regression)", () => {
        const configService = createBootEnvConfigService({ NODE_ENV: "development" });

        expect(() => assertVendorStubsConfigured(configService)).not.toThrow();
    });

    it("passes in a Railway preview runtime even when the platform exposes CI=true", () => {
        const configService = createBootEnvConfigService({ NODE_ENV: "preview", CI: "true" });

        expect(() => assertVendorStubsConfigured(configService)).not.toThrow();
    });

    it("throws in GitHub Actions when the e2e flag is unset", () => {
        const configService = createBootEnvConfigService({
            NODE_ENV: "development",
            CI: "true",
            GITHUB_ACTIONS: "true",
        });

        expect(() => assertVendorStubsConfigured(configService)).toThrow(/E2E_VENDOR_STUBS=1/);
    });

    it("passes in GitHub Actions when E2E_VENDOR_STUBS=1", () => {
        const configService = createBootEnvConfigService({
            NODE_ENV: "development",
            CI: "true",
            GITHUB_ACTIONS: "true",
            E2E_VENDOR_STUBS: "1",
        });

        expect(() => assertVendorStubsConfigured(configService)).not.toThrow();
    });

    it("never throws in production even if CI/test signals are also present (production guard wins)", () => {
        const configService = createBootEnvConfigService({ NODE_ENV: "production", CI: "true" });

        expect(() => assertVendorStubsConfigured(configService)).not.toThrow();
    });

    it("includes a near-miss hint when a truthy-but-not-'1' value is detected", () => {
        const configService = createBootEnvConfigService({ NODE_ENV: "test", E2E_VENDOR_STUBS: "true" });

        expect(() => assertVendorStubsConfigured(configService)).toThrow(/detected value "true"/);
    });
});
