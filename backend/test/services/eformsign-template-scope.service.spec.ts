import { EformsignTemplateScopeService } from "application/services/eformsign-template-scope.service";
import { SERVICE_RECORD_TEMPLATE_TIER_ENV_KEYS } from "application/usecases/eformsign-doc/service-record-field-ids";
import { AreaTemplateEntity } from "domain/entities/area-template.entity";

function areaTemplate(areaId: string, templateId: string): AreaTemplateEntity {
    return AreaTemplateEntity.reconstitute(`id-${areaId}`, areaId, templateId, `${areaId} 계약서`);
}

type CreateServiceOptions = {
    areaTemplates?: AreaTemplateEntity[];
    areaTemplateError?: Error;
    /** Aligned with SERVICE_RECORD_TEMPLATE_TIER_ENV_KEYS order; missing entries stay unconfigured. */
    serviceRecordTemplateIds?: string[];
};

function createService(options: CreateServiceOptions = {}) {
    const areaTemplateService = {
        findAll: jest.fn(() =>
            options.areaTemplateError
                ? Promise.reject(options.areaTemplateError)
                : Promise.resolve(options.areaTemplates ?? [])),
    };
    // Always answers every tier key (empty string when unconfigured) so the
    // production code never falls through to this process's real environment —
    // tests must not depend on whatever the CI shell happens to export.
    const configService = {
        get: jest.fn((key: string) => {
            const index = SERVICE_RECORD_TEMPLATE_TIER_ENV_KEYS
                .findIndex(({ envKey }) => envKey === key);
            if (index >= 0) {
                return options.serviceRecordTemplateIds?.[index] ?? "";
            }
            return undefined;
        }),
    };
    const service = new EformsignTemplateScopeService(
        areaTemplateService as never,
        configService as never,
    );
    return { service, areaTemplateService, configService };
}

describe("EformsignTemplateScopeService", () => {
    describe("resolveTemplateFilter", () => {
        it("returns undefined when no section is requested", async () => {
            const { service } = createService({
                areaTemplates: [areaTemplate("area-1", "template-a")],
                serviceRecordTemplateIds: ["sr-1"],
            });

            await expect(service.resolveTemplateFilter(undefined, "branch-1")).resolves.toBeUndefined();
        });

        it("whitelists the branch's registered maternity templates for the maternity section", async () => {
            const { service, areaTemplateService } = createService({
                areaTemplates: [
                    areaTemplate("area-1", "template-a"),
                    areaTemplate("area-2", "template-b"),
                ],
                serviceRecordTemplateIds: ["sr-1"],
            });

            await expect(service.resolveTemplateFilter("maternity", "branch-1")).resolves.toEqual({
                templateId: "template-a,template-b",
                templateMatch: "include",
            });
            expect(areaTemplateService.findAll).toHaveBeenCalledWith("branch-1");
        });

        it("dedupes template ids registered under multiple areas", async () => {
            const { service } = createService({
                areaTemplates: [
                    areaTemplate("area-1", "template-a"),
                    areaTemplate("area-2", "template-a"),
                ],
            });

            await expect(service.resolveTemplateFilter("maternity", "branch-1")).resolves.toEqual({
                templateId: "template-a",
                templateMatch: "include",
            });
        });

        it("falls back to excluding service-record templates when no maternity template is registered", async () => {
            const { service, areaTemplateService } = createService({
                areaTemplates: [],
                serviceRecordTemplateIds: ["sr-1", "sr-2"],
            });

            await expect(service.resolveTemplateFilter("maternity", "branch-1")).resolves.toEqual({
                templateId: "sr-1,sr-2",
                templateMatch: "exclude",
            });
            expect(areaTemplateService.findAll).toHaveBeenCalled();
        });

        it("falls back to the legacy exclude rule when the registry lookup fails", async () => {
            const { service } = createService({
                areaTemplateError: new Error("registry unavailable"),
                serviceRecordTemplateIds: ["sr-1"],
            });

            await expect(service.resolveTemplateFilter("maternity", "branch-1")).resolves.toEqual({
                templateId: "sr-1",
                templateMatch: "exclude",
            });
        });

        it("treats an empty branchId as an unregistered branch and applies the fallback", async () => {
            const { service, areaTemplateService } = createService({
                serviceRecordTemplateIds: ["sr-1"],
            });

            await expect(service.resolveTemplateFilter("maternity", "")).resolves.toEqual({
                templateId: "sr-1",
                templateMatch: "exclude",
            });
            expect(areaTemplateService.findAll).not.toHaveBeenCalled();
        });

        it("returns undefined for the maternity section when no filter can be composed at all", async () => {
            const { service } = createService({ areaTemplates: [] });

            await expect(service.resolveTemplateFilter("maternity", "branch-1")).resolves.toBeUndefined();
        });

        it("includes every configured service-record tier for the service-records section", async () => {
            const { service, areaTemplateService } = createService({
                areaTemplates: [areaTemplate("area-1", "template-a")],
                serviceRecordTemplateIds: ["sr-1", "sr-2"],
            });

            await expect(service.resolveTemplateFilter("service-records", "branch-1")).resolves.toEqual({
                templateId: "sr-1,sr-2",
                templateMatch: "include",
            });
            expect(areaTemplateService.findAll).not.toHaveBeenCalled();
        });

        it("returns undefined for the service-records section when no tier is configured", async () => {
            const { service } = createService({ areaTemplates: [areaTemplate("area-1", "template-a")] });

            await expect(service.resolveTemplateFilter("service-records", "branch-1")).resolves.toBeUndefined();
        });
    });
});
