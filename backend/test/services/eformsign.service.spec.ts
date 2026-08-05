import { ConfigService } from "@nestjs/config";
import * as crypto from "crypto";

import { ContractDataDto } from "application/dto/contract.dto";
import {
    EFORMSIGN_DELETE_TIMEOUT_MS,
    EFORMSIGN_DOWNLOAD_TIMEOUT_MS,
    EFORMSIGN_MAX_DOWNLOAD_BYTES,
    EformsignService,
} from "application/services/eformsign.service";

function generateEformsignPrivateKeyHex(): string {
    const { privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    return (privateKey.export({ format: "der", type: "pkcs8" }) as Buffer).toString("hex");
}

function createConfigService(overrides: Record<string, string | undefined> = {}): ConfigService {
    return {
        get: jest.fn((key: string) => {
            const values: Record<string, string | undefined> = {
                EFORMSIGN_USER_EMAIL: "staff@example.com",
                EFORMSIGN_API_URL: "https://api.eformsign.example",
                EFORMSIGN_DOC_API_URL: "https://doc.eformsign.example",
                EFORMSIGN_API_KEY: "api-key",
                EFORMSIGN_PRIVATE_KEY: "00",
                EFORMSIGN_COMPANY_ID: "company-1",
                EFORMSIGN_TEMPLATE_ID: "template-1",
                ...overrides,
            };

            return values[key];
        }),
    } as unknown as ConfigService;
}

describe("EformsignService", () => {
    afterEach(() => {
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    it("aborts a mirrored PDF request that does not return before the deadline", async () => {
        jest.useFakeTimers();
        const service = new EformsignService(createConfigService());
        const fetchMock = jest.spyOn(global, "fetch").mockImplementation((_input, init) =>
            new Promise<Response>((_resolve, reject) => {
                const signal = (init as RequestInit).signal;
                signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
            }),
        );

        const download = service.downloadDocumentFile("access-token", "stuck-request");
        const expectation = expect(download).rejects.toThrow(
            `timed out after ${EFORMSIGN_DOWNLOAD_TIMEOUT_MS}ms`,
        );
        await jest.advanceTimersByTimeAsync(EFORMSIGN_DOWNLOAD_TIMEOUT_MS);

        await expectation;
        expect(fetchMock).toHaveBeenCalledWith(
            expect.stringContaining("stuck-request/download_files"),
            expect.objectContaining({ signal: expect.any(AbortSignal) }),
        );
    });

    it("bounds a permanent delete across both the request and response body", async () => {
        jest.useFakeTimers();
        const service = new EformsignService(createConfigService());
        let signal: AbortSignal | undefined;
        const responseBody = new Promise<never>((_resolve, reject) => {
            // The fetch promise has resolved, but its JSON body must still share
            // the same total timeout rather than waiting forever.
            queueMicrotask(() => signal?.addEventListener(
                "abort",
                () => reject(signal?.reason),
                { once: true },
            ));
        });
        const fetchMock = jest.spyOn(global, "fetch").mockImplementation((_input, init) => {
            signal = (init as RequestInit).signal as AbortSignal;
            return Promise.resolve({
                ok: true,
                json: jest.fn(() => responseBody),
            } as unknown as Response);
        });

        const deletion = service.deleteDocuments("access-token", ["stuck-document"], true);
        const expectation = expect(deletion).rejects.toThrow(
            `timed out after ${EFORMSIGN_DELETE_TIMEOUT_MS}ms`,
        );
        await Promise.resolve();
        await jest.advanceTimersByTimeAsync(EFORMSIGN_DELETE_TIMEOUT_MS);

        await expectation;
        expect(fetchMock).toHaveBeenCalledWith(
            expect.stringContaining("is_permanent=true"),
            expect.objectContaining({ signal: expect.any(AbortSignal) }),
        );
    });

    it("bounds a permanent delete when the vendor never returns response headers", async () => {
        jest.useFakeTimers();
        const service = new EformsignService(createConfigService());
        const fetchMock = jest.spyOn(global, "fetch").mockImplementation(
            () => new Promise<Response>(() => undefined),
        );

        const deletion = service.deleteDocuments("access-token", ["stuck-request"], true);
        const expectation = expect(deletion).rejects.toThrow(
            `timed out after ${EFORMSIGN_DELETE_TIMEOUT_MS}ms`,
        );
        await jest.advanceTimersByTimeAsync(EFORMSIGN_DELETE_TIMEOUT_MS);

        await expectation;
        expect(fetchMock).toHaveBeenCalledWith(
            expect.stringContaining("is_permanent=true"),
            expect.objectContaining({ signal: expect.any(AbortSignal) }),
        );
    });

    it("preserves a vendor deleted-document code from the actual delete response", async () => {
        const service = new EformsignService(createConfigService());
        jest.spyOn(global, "fetch").mockResolvedValue(new Response(
            JSON.stringify({
                code: "4000006",
                ErrorMessage: "The document has been deleted.",
            }),
            { status: 400, headers: { "Content-Type": "application/json" } },
        ));

        await expect(service.deleteDocuments(
            "access-token",
            ["deleted-document"],
            true,
        )).rejects.toMatchObject({
            status: 400,
            vendorCode: "4000006",
        });
    });

    it("posts a cancellation to the vendor's cancel endpoint", async () => {
        const service = new EformsignService(createConfigService());
        const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue(new Response(
            JSON.stringify({ result: { success_result: ["doc-1"], fail_result: [] } }),
            { status: 200, headers: { "Content-Type": "application/json" } },
        ));

        await expect(service.cancelDocuments("access-token", ["doc-1"], "관리자 삭제"))
            .resolves.toEqual({ result: { success_result: ["doc-1"], fail_result: [] } });

        expect(fetchMock).toHaveBeenCalledWith(
            "https://doc.eformsign.example/v2.0/api/documents/cancel",
            expect.objectContaining({
                method: "POST",
                // The vendor nests the payload under `input`; a flat body is rejected.
                body: JSON.stringify({
                    input: { document_ids: ["doc-1"], comment: "관리자 삭제" },
                }),
            }),
        );
    });

    it("surfaces a vendor rejection of a cancellation as an api error", async () => {
        const service = new EformsignService(createConfigService());
        jest.spyOn(global, "fetch").mockResolvedValue(new Response(
            JSON.stringify({ code: "4000164", ErrorMessage: "not authorized" }),
            { status: 400, headers: { "Content-Type": "application/json" } },
        ));

        await expect(service.cancelDocuments("access-token", ["doc-1"]))
            .rejects.toMatchObject({ status: 400, vendorCode: "4000164" });
    });

    it("surfaces a vendor rejection of an access-token request as an api error", async () => {
        const service = new EformsignService(createConfigService({
            EFORMSIGN_PRIVATE_KEY: generateEformsignPrivateKeyHex(),
        }));
        jest.spyOn(global, "fetch").mockResolvedValue(new Response(
            JSON.stringify({ code: "4010001", ErrorMessage: "unauthorized" }),
            { status: 401, headers: { "Content-Type": "application/json" } },
        ));

        await expect(service.getAccessToken(Date.now()))
            .rejects.toMatchObject({ status: 401, vendorCode: "4010001" });
    });

    it("surfaces a vendor rejection of a refresh-token request as an api error", async () => {
        const service = new EformsignService(createConfigService({
            EFORMSIGN_PRIVATE_KEY: generateEformsignPrivateKeyHex(),
        }));
        jest.spyOn(global, "fetch").mockResolvedValue(new Response(
            JSON.stringify({ code: "4010002", ErrorMessage: "expired refresh token" }),
            { status: 401, headers: { "Content-Type": "application/json" } },
        ));

        await expect(service.refreshAccessToken(Date.now(), "stale-refresh-token"))
            .rejects.toMatchObject({ status: 401, vendorCode: "4010002" });
    });

    it("aborts and cancels a mirrored PDF body that stops streaming before the deadline", async () => {
        jest.useFakeTimers();
        const service = new EformsignService(createConfigService());
        const cancel = jest.fn().mockResolvedValue(undefined);
        const reader = {
            read: jest.fn(() => new Promise(() => undefined)),
            cancel,
        };
        jest.spyOn(global, "fetch").mockResolvedValue({
            status: 200,
            headers: new Headers({ "content-type": "application/pdf" }),
            body: { getReader: () => reader },
        } as unknown as Response);

        const download = service.downloadDocumentFile("access-token", "stuck-body");
        const expectation = expect(download).rejects.toThrow(
            `timed out after ${EFORMSIGN_DOWNLOAD_TIMEOUT_MS}ms`,
        );
        await Promise.resolve();
        await jest.advanceTimersByTimeAsync(EFORMSIGN_DOWNLOAD_TIMEOUT_MS);

        await expectation;
        expect(cancel).toHaveBeenCalledTimes(1);
    });

    it("rejects an oversized PDF from content-length before buffering it", async () => {
        const service = new EformsignService(createConfigService());
        const arrayBuffer = jest.fn();
        jest.spyOn(global, "fetch").mockResolvedValue({
            status: 200,
            headers: new Headers({
                "content-type": "application/pdf",
                "content-length": String(EFORMSIGN_MAX_DOWNLOAD_BYTES + 1),
            }),
            body: null,
            arrayBuffer,
        } as unknown as Response);

        await expect(service.downloadDocumentFile(
            "access-token",
            "doc-too-large",
            "document",
        )).rejects.toThrow("exceeds the local mirror size limit");
        expect(arrayBuffer).not.toHaveBeenCalled();
    });

    it("stops reading a chunked PDF when it crosses the local mirror size limit", async () => {
        const service = new EformsignService(createConfigService());
        const cancel = jest.fn().mockResolvedValue(undefined);
        let reads = 0;
        const reader = {
            read: jest.fn().mockImplementation(async () => {
                reads += 1;
                if (reads === 1) {
                    return {
                        done: false,
                        value: new Uint8Array(EFORMSIGN_MAX_DOWNLOAD_BYTES),
                    };
                }
                return {
                    done: false,
                    value: new Uint8Array(1),
                };
            }),
            cancel,
        };
        jest.spyOn(global, "fetch").mockResolvedValue({
            status: 200,
            headers: new Headers({ "content-type": "application/pdf" }),
            body: { getReader: () => reader },
        } as unknown as Response);

        await expect(service.downloadDocumentFile(
            "access-token",
            "doc-chunked-too-large",
            "document",
        )).rejects.toThrow("exceeds the local mirror size limit");
        expect(cancel).toHaveBeenCalled();
    });

    it("sorts merged document lists by eformsign created_date newest first", async () => {
        const service = new EformsignService(createConfigService());

        jest.spyOn(service, "getInProgressDocuments").mockResolvedValue({
            documents: [
                { id: "older", created_date: 1780000000000 },
                { id: "duplicate", created_date: 1780000003000 },
            ],
        });
        jest.spyOn(service, "getCompletedDocuments").mockResolvedValue({
            documents: [
                { id: "newest", created_date: 1780000005000 },
                { id: "duplicate", created_date: 1780000003000 },
            ],
        });
        jest.spyOn(service, "getRejectedDocuments").mockResolvedValue({
            documents: [
                { id: "middle", created_date: 1780000001000 },
            ],
        });

        const result = await service.getAllDocuments("access-token");

        expect(result.documents.map((document) => document.id)).toEqual([
            "newest",
            "duplicate",
            "middle",
            "older",
        ]);
        expect(result.total_rows).toBe(4);
    });

    it("uses payment collection date fields and reviewer step for provider confirmation", () => {
        const service = new EformsignService(createConfigService());
        const contractData: ContractDataDto = {
            customerName: "김정인",
            customerContact: "010-1234-5678",
            customerDOB: "900101",
            customerAddress: "인천 서구",
            caretaker1Name: "이관리",
            caretaker1Contact: "010-9999-8888",
            type: "A통합3형",
            days: "15",
            area: "Seogu",
            contractDuration: "2026-06-03 ~ 2026-06-23",
            startYear: "26",
            startMonth: "06",
            startDay: "03",
            startDate: "2026-06-03",
            endYear: "26",
            endMonth: "06",
            endDay: "23",
            endDate: "2026-06-23",
            paymentYear: "26",
            paymentMonth: "06",
            paymentDay: "03",
            fullPrice: "1000000",
            grant: "800000",
            actualPrice: "200000",
        };

        const options = service.generateDocumentOptions(
            contractData,
            "access-token",
            "refresh-token",
            "template-seogu",
        );

        expect(options.prefill.fields).toEqual(
            expect.arrayContaining([
                { id: "이용자 생년월일", value: "900101", enabled: true },
                { id: "본인부담금 수령 년도", value: "26" },
                { id: "본인부담금 수령 월", value: "06" },
                { id: "본인부담금 수령 일", value: "03" },
            ]),
        );
        expect(options.prefill.fields.map((field) => field.id)).not.toEqual(
            expect.arrayContaining(["영수증 년도", "영수증 월", "영수증 일"]),
        );
        expect(options.prefill.recipients).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    step_idx: "3",
                    step_type: "06",
                    name: "제공기관 확인",
                }),
            ]),
        );
    });

    it("uses e2e vendor stubs for token fetches and document listing without network access", async () => {
        const fetchSpy = jest.spyOn(global, "fetch");
        const service = new EformsignService(createConfigService({
            E2E_VENDOR_STUBS: "1",
            EFORMSIGN_USER_EMAIL: undefined,
            EFORMSIGN_API_URL: undefined,
            EFORMSIGN_DOC_API_URL: undefined,
            EFORMSIGN_API_KEY: undefined,
            EFORMSIGN_PRIVATE_KEY: undefined,
            EFORMSIGN_COMPANY_ID: undefined,
            EFORMSIGN_TEMPLATE_ID: undefined,
        }));

        await expect(service.getAccessToken(Date.now())).resolves.toMatchObject({
            oauth_token: {
                access_token: "e2e-stub-token",
                refresh_token: "e2e-stub-refresh-token",
            },
        });

        const documents = await service.getAllDocuments("ignored-token");

        expect(documents.documents.map((document) => document.id)).toEqual([
            "doc-delete-target",
            "doc-finalize-test",
            "doc-keep-1",
            "doc-create-test",
        ]);
        expect(documents.documents[0]).toEqual(expect.objectContaining({
            created_date: expect.stringMatching(/^\d+$/),
            current_status: expect.objectContaining({
                status_type: expect.any(Number),
                step_type: expect.any(Number),
            }),
        }));
        expect(fetchSpy).not.toHaveBeenCalled();

        fetchSpy.mockRestore();
    });

    it("builds iframe options in stub mode even when vendor env is absent", () => {
        const service = new EformsignService(createConfigService({
            E2E_VENDOR_STUBS: "1",
            EFORMSIGN_USER_EMAIL: undefined,
            EFORMSIGN_API_URL: undefined,
            EFORMSIGN_DOC_API_URL: undefined,
            EFORMSIGN_API_KEY: undefined,
            EFORMSIGN_PRIVATE_KEY: undefined,
            EFORMSIGN_COMPANY_ID: undefined,
            EFORMSIGN_TEMPLATE_ID: undefined,
        }));
        const contractData: ContractDataDto = {
            customerName: "김정인",
            customerContact: "010-1234-5678",
            customerDOB: "900101",
            customerAddress: "인천 서구",
            caretaker1Name: "이관리",
            caretaker1Contact: "010-9999-8888",
            type: "A통합3형",
            days: "15",
            area: "Seogu",
            contractDuration: "2026-06-03 ~ 2026-06-23",
            startYear: "26",
            startMonth: "06",
            startDay: "03",
            startDate: "2026-06-03",
            endYear: "26",
            endMonth: "06",
            endDay: "23",
            endDate: "2026-06-23",
            paymentYear: "26",
            paymentMonth: "06",
            paymentDay: "03",
            fullPrice: "1000000",
            grant: "800000",
            actualPrice: "200000",
        };

        const options = service.generateDocumentOptions(
            contractData,
            "stub-access-token",
            "stub-refresh-token",
        );

        expect(options.company.id).toBe("e2e-stub-company");
        expect(options.user.id).toBe("e2e-stub@babyjamjam.test");
        expect(options.mode.template_id).toBe("tpl-test");
    });
});
