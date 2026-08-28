import { buildContractTemplateFilter } from "../contract-template-filter";

describe("buildContractTemplateFilter", () => {
  const maternityTemplateIds = ["namdong-contract-template", "seo-contract-template"];
  const serviceRecordTemplateIds = ["service-record-5", "service-record-10"];

  it("includes only the branch's 계약서 template documents for the maternity section", () => {
    expect(
      buildContractTemplateFilter({
        activeSection: "maternity",
        maternityTemplateIds,
        serviceRecordTemplateIds,
      }),
    ).toEqual({
      templateId: "namdong-contract-template,seo-contract-template",
      templateMatch: "include",
    });
  });

  it("falls back to excluding 제공기록지 templates when the branch has no 계약서 templates", () => {
    expect(
      buildContractTemplateFilter({
        activeSection: "maternity",
        maternityTemplateIds: [],
        serviceRecordTemplateIds,
      }),
    ).toEqual({
      templateId: "service-record-5,service-record-10",
      templateMatch: "exclude",
    });
  });

  it("sends no template filter when the maternity section has neither template source", () => {
    expect(
      buildContractTemplateFilter({
        activeSection: "maternity",
        maternityTemplateIds: [],
        serviceRecordTemplateIds: [],
      }),
    ).toBeUndefined();
  });

  it("includes 제공기록지 tier templates for the service-records section regardless of 계약서 templates", () => {
    expect(
      buildContractTemplateFilter({
        activeSection: "service-records",
        maternityTemplateIds,
        serviceRecordTemplateIds,
      }),
    ).toEqual({
      templateId: "service-record-5,service-record-10",
      templateMatch: "include",
    });
  });

  it("sends no template filter for the service-records section when no tier is configured", () => {
    expect(
      buildContractTemplateFilter({
        activeSection: "service-records",
        maternityTemplateIds,
        serviceRecordTemplateIds: [],
      }),
    ).toBeUndefined();
  });
});
