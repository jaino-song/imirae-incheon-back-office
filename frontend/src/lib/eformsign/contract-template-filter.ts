/**
 * Which eformsign template filter each contracts section sends with its document list query.
 *
 * 산모 계약서: 화이트리스트 — 지점 doc_template(지역별 계약서 템플릿)으로 만든 문서만 섹션에
 * 노출한다. 같은 eformsign 계정의 무관한 템플릿(예: 근로계약서) 문서가 섞이는 것을 막는다.
 * 지점에 등록된 계약서 템플릿이 없으면(미등록/조회 실패) 레거시 규칙인 제공기록지 템플릿
 * exclude로 폴백한다 — registry가 비었다는 이유만으로 과거 계약서가 목록에서 사라지지 않도록.
 * 제공기록지: include — 설정된 모든 제공기록지 티어 템플릿(5/10/15/20회)으로 만든 문서만.
 */
export type ContractTemplateSection = "maternity" | "service-records";

export type ContractTemplateFilter = {
  templateId: string;
  templateMatch: "include" | "exclude";
};

export function buildContractTemplateFilter({
  activeSection,
  maternityTemplateIds,
  serviceRecordTemplateIds,
}: {
  activeSection: ContractTemplateSection;
  maternityTemplateIds: string[];
  serviceRecordTemplateIds: string[];
}): ContractTemplateFilter | undefined {
  if (activeSection === "service-records") {
    return serviceRecordTemplateIds.length > 0
      ? { templateId: serviceRecordTemplateIds.join(","), templateMatch: "include" }
      : undefined;
  }

  if (maternityTemplateIds.length > 0) {
    return { templateId: maternityTemplateIds.join(","), templateMatch: "include" };
  }
  return serviceRecordTemplateIds.length > 0
    ? { templateId: serviceRecordTemplateIds.join(","), templateMatch: "exclude" }
    : undefined;
}
