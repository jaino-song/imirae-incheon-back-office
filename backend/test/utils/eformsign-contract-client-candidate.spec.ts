import {
    eformsignCustomerPhone,
    extractEformsignContractClientCandidate,
    extractEformsignContractClientPrefillCandidate,
} from "application/utils/eformsign-contract-client-candidate";
import { EformsignApiDocumentResponse } from "domain/repositories/eformsign.client.interface";

function documentDetail(
    overrides: Partial<EformsignApiDocumentResponse> = {},
): EformsignApiDocumentResponse {
    return {
        id: "doc-1",
        document_number: "DOC-1",
        template: { id: "contract-template", name: "계약서" },
        document_name: "산모신생아 건강관리 계약서",
        creator: { recipient_type: "01", id: "staff@example.com", name: "담당자" },
        created_date: Date.parse("2026-07-01T00:00:00.000Z"),
        updated_date: Date.parse("2026-07-02T00:00:00.000Z"),
        current_status: {
            status_type: "072",
            step_type: "06",
            step_index: "3",
            step_name: "완료",
            step_recipients: [{
                recipient_type: "06",
                id: "provider@example.com",
                name: "제공기관",
                sms: "010-9999-9999",
            }],
            step_group: 3,
        },
        fields: [
            { id: "이용자 성명", value: "김고객", type: "text" },
            // This field can contain the issuing staff's number in the current template.
            { id: "이용자 연락처", value: "010-8888-8888", type: "text" },
            { id: "이용자 생년월일", value: "1992-03-04", type: "date" },
            { id: "이용자 주소", value: "서울시 중구", type: "text" },
            { id: "계약 시작 년도", value: "2026", type: "text" },
            { id: "계약 시작 월", value: "08", type: "text" },
            { id: "계약 시작 일", value: "01", type: "text" },
            { id: "계약 종료 년도", value: "2026", type: "text" },
            { id: "계약 종료 월", value: "08", type: "text" },
            { id: "계약 종료 일", value: "14", type: "text" },
            { id: "서비스 비용", value: "1,500,000원", type: "text" },
            { id: "정부지원금", value: "1,000,000원", type: "text" },
            { id: "본인부담금", value: "500,000원", type: "text" },
            { id: "서비스 일수", value: "15일", type: "text" },
        ],
        recipients: [{
            recipient_type: "02",
            name: "김고객",
            sms: "010-1234-5678",
        }],
        ...overrides,
    };
}

describe("extractEformsignContractClientCandidate", () => {
    it("maps the final contract detail and prefers the named customer recipient phone", () => {
        const candidate = extractEformsignContractClientCandidate(documentDetail());

        expect(candidate).toEqual(expect.objectContaining({
            name: "김고객",
            phone: "01012345678",
            address: "서울시 중구",
            birthday: "920304",
            duration: 15,
            fullPrice: "1500000",
            grant: "1000000",
            actualPrice: "500000",
            voucherClient: true,
        }));
        expect(candidate?.startDate?.toISOString()).toBe("2026-08-01T00:00:00.000Z");
        expect(candidate?.endDate?.toISOString()).toBe("2026-08-14T00:00:00.000Z");
    });

    it("extracts both provider identities for branch-scoped employee resolution", () => {
        const detail = documentDetail({
            fields: [
                ...(documentDetail().fields ?? []),
                { id: "제공인력 1 성명", value: "김희선", type: "text" },
                { id: "제공인력 1 연락처", value: "82 10 5330 9359", type: "text" },
                { id: "제공인력2 성명", value: "이보조", type: "text" },
                { id: "제공인력2 연락처", value: "010-2222-3333", type: "text" },
            ],
        });

        expect(extractEformsignContractClientPrefillCandidate(detail)).toEqual(
            expect.objectContaining({
                primaryProviderName: "김희선",
                primaryProviderPhone: "01053309359",
                secondaryProviderName: "이보조",
                secondaryProviderPhone: "01022223333",
            }),
        );
    });

    it("does not guess when the same named recipient has conflicting phones", () => {
        const detail = documentDetail({
            recipients: [
                { recipient_type: "02", name: "김고객", sms: "010-1234-5678" },
                { recipient_type: "02", name: "김고객", sms: "010-7777-7777" },
            ],
        });

        expect(eformsignCustomerPhone(detail)).toBeNull();
        expect(extractEformsignContractClientCandidate(detail)).toBeNull();
    });

    it("does not mistake the current provider recipient for the customer", () => {
        const detail = documentDetail({
            recipients: [],
            fields: documentDetail().fields?.filter((field) => field.id !== "이용자 연락처"),
        });

        expect(eformsignCustomerPhone(detail)).toBeNull();
    });

    it("uses the customer-qualified name when a provider name field comes first", () => {
        const detail = documentDetail({
            fields: [
                { id: "제공자 성명", value: "제공자", type: "text" },
                { id: "고객 성명", value: "김고객", type: "text" },
            ],
            recipients: [
                { recipient_type: "06", name: "제공자", sms: "010-9999-9999" },
                { recipient_type: "02", name: "김고객", sms: "010-1234-5678" },
            ],
        });

        expect(extractEformsignContractClientCandidate(detail)).toEqual(
            expect.objectContaining({
                name: "김고객",
                phone: "01012345678",
            }),
        );
    });

    it("rejects a generic-only name field as unsafe for auto-registration", () => {
        const detail = documentDetail({
            fields: [{ id: "성명", value: "김고객", type: "text" }],
        });

        expect(extractEformsignContractClientCandidate(detail)).toBeNull();
    });

    it("keeps the legacy customer_name alias eligible for auto-registration", () => {
        const detail = documentDetail({
            fields: [],
            detail_template_info: {
                customer_name: { value: "김고객" },
            },
        });

        expect(extractEformsignContractClientCandidate(detail)).toEqual(
            expect.objectContaining({
                name: "김고객",
                phone: "01012345678",
            }),
        );
    });
});
