import { ConfigService } from "@nestjs/config";

import { ContractDataDto } from "application/dto/contract.dto";
import { EformsignService } from "application/services/eformsign.service";

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
