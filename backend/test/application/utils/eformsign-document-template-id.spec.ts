import { eformsignDocumentTemplateId } from "application/utils/eformsign-document-template-id";

describe("eformsignDocumentTemplateId", () => {
    it("uses template.id before the fallback response shapes", () => {
        expect(eformsignDocumentTemplateId({
            template: { id: "template-object" },
            detail_template_info: { id: "detail-template" },
            template_id: "flat-template",
        })).toBe("template-object");
    });

    it("falls back to detail_template_info.id and then template_id", () => {
        expect(eformsignDocumentTemplateId({
            template: { id: "   " },
            detail_template_info: { id: "detail-template" },
            template_id: "flat-template",
        })).toBe("detail-template");
        expect(eformsignDocumentTemplateId({
            detail_template_info: { id: "" },
            template_id: "flat-template",
        })).toBe("flat-template");
    });

    it("returns null when no response shape contains a valid id", () => {
        expect(eformsignDocumentTemplateId({
            template: { id: 123 },
            detail_template_info: null,
            template_id: " ",
        })).toBeNull();
    });
});
