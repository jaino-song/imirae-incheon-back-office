import { contractCandidateToClientPrefill } from "@/lib/client/contract-client-prefill";
import type { EformsignContractClientCandidateResponse } from "@babyjamjam/shared/types/eformsign";

const base: EformsignContractClientCandidateResponse = {
    documentId: "doc-1",
    extracted: true,
    name: "홍길동",
    phone: "010-1234-5678",
    address: "서울시 강남구",
    birthday: "900101",
    dueDate: "2026-09-01",
    startDate: "2026-08-10",
    endDate: "2026-08-24",
    type: "A형",
    duration: 10,
    fullPrice: "1000000",
    grant: "800000",
    actualPrice: "200000",
    careCenter: true,
    voucherClient: true,
    breastPump: false,
};

describe("contractCandidateToClientPrefill", () => {
    it("후보의 모든 필드를 폼 프리필로 매핑한다", () => {
        expect(contractCandidateToClientPrefill(base)).toEqual({
            name: "홍길동",
            phone: "010-1234-5678",
            address: "서울시 강남구",
            birthday: "900101",
            dueDate: "2026-09-01",
            startDate: "2026-08-10",
            endDate: "2026-08-24",
            type: "A형",
            duration: 10,
            fullPrice: "1000000",
            grant: "800000",
            actualPrice: "200000",
            careCenter: true,
            voucherClient: true,
            breastPump: false,
        });
    });

    it("전화번호가 없어도 추출된 상세 필드를 보존하고 null은 폼 기본값으로 치환한다", () => {
        const result = contractCandidateToClientPrefill({
            ...base,
            extracted: true,
            name: "김산모",
            phone: null,
            address: null,
            birthday: null,
            dueDate: null,
            startDate: null,
            endDate: null,
            type: null,
            duration: null,
            fullPrice: null,
            grant: null,
            actualPrice: null,
            careCenter: null,
            voucherClient: false,
            breastPump: false,
        });
        expect(result).toEqual({
            name: "김산모",
            phone: "",
            address: "",
            birthday: "",
            dueDate: "",
            startDate: "",
            endDate: "",
            type: "",
            duration: null,
            fullPrice: "",
            grant: "",
            actualPrice: "",
            careCenter: false,
            voucherClient: false,
            breastPump: false,
        });

        expect(contractCandidateToClientPrefill({ ...base, name: null }).name).toBe("");
    });
});
