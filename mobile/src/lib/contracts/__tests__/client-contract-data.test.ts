import {
  buildClientContractData,
  resolveContractAreaTemplateId,
} from "@/lib/contracts/client-contract-data";
import type { Client } from "@/lib/client/types";
import type { Employee } from "@/hooks/useEmployees";
import type { AreaTemplate } from "@/hooks/useVoucherData";

const baseClient: Client = {
  id: 44,
  name: "김정인",
  birthday: "960101",
  dueDate: "2026-05-30T00:00:00.000Z",
  birthDate: null,
  address: "인천광역시 남동구 구월동",
  phone: "010-1234-5678",
  primaryEmployee: { id: 7, name: "이관리" },
  secondaryEmployee: null,
  type: "A통합3형",
  duration: 15,
  fullPrice: "1,234,000",
  grant: "900,000",
  actualPrice: "334,000",
  startDate: "2026-06-03T00:00:00.000Z",
  endDate: "2026-06-23T00:00:00.000Z",
  careCenter: false,
  voucherClient: true,
  breastPump: false,
  serviceStatus: "active",
  eDocId: null,
  hasSigned: false,
  documentStatus: null,
};

const employees: Employee[] = [
  {
    id: 7,
    name: "이관리",
    phone: "010-9999-8888",
    workArea: ["남동구"],
    grade: "베스트",
    openToNextWork: true,
    registeredDate: "2026-01-01",
    status: "working",
  },
];

const areaTemplates: AreaTemplate[] = [
  { id: "at_001", areaId: "area_dong", templateId: "tmpl_001", templateName: "동구 서비스 계약서" },
  { id: "at_002", areaId: "area_namdong", templateId: "tmpl_002", templateName: "남동구 서비스 계약서" },
  { id: "at_003", areaId: "area_jung", templateId: "tmpl_003", templateName: "중구 서비스 계약서" },
];

describe("buildClientContractData", () => {
  it("builds eformsign contract data from an existing client", () => {
    const result = buildClientContractData({
      client: baseClient,
      employees,
      areaTemplates,
    });

    expect(result.areaId).toBe("area_namdong");
    expect(result.contractData).toMatchObject({
      customerName: "김정인",
      customerContact: "010-1234-5678",
      caretaker1Name: "이관리",
      caretaker1Contact: "010-9999-8888",
      type: "A통합3형",
      days: "15",
      area: "area_namdong",
      startDate: "2026-06-03",
      endDate: "2026-06-23",
      paymentYear: "26",
      paymentMonth: "06",
      paymentDay: "03",
    });
  });
});

describe("resolveContractAreaTemplateId", () => {
  it("blocks automatic issuance when multiple templates cannot be matched", () => {
    expect(() =>
      resolveContractAreaTemplateId(
        {
          ...baseClient,
          address: "인천광역시 주소 미확인",
        },
        areaTemplates,
      ),
    ).toThrow("계약서 유형을 주소에서 판단할 수 없습니다.");
  });
});
