import { Injectable, Logger } from "@nestjs/common";
// 일반 import여야 한다 — import type은 DI 메타데이터(design:paramtypes)를 지워
// Nest가 ConfigService를 resolve하지 못한다.
import { ConfigService } from "@nestjs/config";

import { AreaTemplateService } from "application/services/area-template.service";
import { configuredServiceRecordTemplateIds } from "application/utils/eformsign-document-kind";
import type { TemplateMatch } from "application/utils/eformsign-document-list";

/**
 * The contracts-page section a document list request can name with `section=`.
 * Matches the section names the UIs already use for their own tab state.
 */
export type EformsignListSection = "maternity" | "service-records";

export interface EformsignSectionTemplateFilter {
    templateId: string;
    templateMatch: TemplateMatch;
}

/**
 * section 쿼리가 붙은 문서 목록 요청의 템플릿 필터를 서버가 정본 데이터로 결정한다.
 *
 * 산모 계약서(maternity): 지점 doc_template(area_template) 레지스트리에 등록된 계약서
 * 템플릿만 include한다. 같은 eformsign 계정의 무관한 템플릿(예: 근로계약서) 문서가
 * 섹션에 섞이는 것을 막는 화이트리스트다. 클라이언트가 계산해 보내던 값을 신뢰하지
 * 않고 서버에서 조회하므로 frontend와 mobile이 같은 목록을 보장받는다.
 *
 * 지점에 등록된 계약서 템플릿이 없거나 레지스트리 조회가 실패하면 레거시 규칙인
 * 제공기록지 템플릿 exclude로 폴백한다 — registry가 비었다는 이유만으로 과거 계약서가
 * 목록에서 사라지지 않도록 한다(frontend 화이트리스트가 가지던 폴백 동작과 동일).
 *
 * 제공기록지(service-records): 설정된 모든 제공기록지 티어 템플릿(5/10/15/20회)을
 * include한다.
 *
 * 반환값이 undefined면(섹션 미지정, 또는 어떤 필터도 구성할 수 없음) 목록 엔드포인트는
 * 클라이언트가 보낸 templateId/templateMatch를 그대로 적용한다.
 */
@Injectable()
export class EformsignTemplateScopeService {
    private readonly logger = new Logger(EformsignTemplateScopeService.name);

    constructor(
        private readonly areaTemplateService: AreaTemplateService,
        private readonly configService: ConfigService,
    ) {}

    async resolveTemplateFilter(
        section: EformsignListSection | undefined,
        branchId: string,
    ): Promise<EformsignSectionTemplateFilter | undefined> {
        if (section === undefined) {
            return undefined;
        }
        if (section === "maternity") {
            const maternityTemplateIds = await this.maternityTemplateIds(branchId);
            if (maternityTemplateIds.length > 0) {
                return { templateId: maternityTemplateIds.join(","), templateMatch: "include" };
            }
            return this.serviceRecordFilter("exclude");
        }
        return this.serviceRecordFilter("include");
    }

    private async maternityTemplateIds(branchId: string): Promise<string[]> {
        if (!branchId) {
            return [];
        }
        let templates;
        try {
            templates = await this.areaTemplateService.findAll(branchId);
        } catch {
            // 정본 조회 실패는 요청 실패가 아니라 레거시 규칙으로의 강등이다. 과거 계약서가
            // 목록에서 사라지는 것보다 안전하므로 warn을 남기고 폴백한다.
            this.logger.warn(
                `area template registry lookup failed for branch ${branchId}, falling back to service-record exclude`,
            );
            return [];
        }
        return [...new Set(templates.map((template) => template.templateId).filter(Boolean))];
    }

    private serviceRecordFilter(
        templateMatch: TemplateMatch,
    ): EformsignSectionTemplateFilter | undefined {
        const serviceRecordTemplateIds = [...configuredServiceRecordTemplateIds(this.configService)];
        return serviceRecordTemplateIds.length > 0
            ? { templateId: serviceRecordTemplateIds.join(","), templateMatch }
            : undefined;
    }
}
