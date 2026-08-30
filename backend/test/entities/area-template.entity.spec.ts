import { AreaTemplateEntity } from "domain/entities/area-template.entity";

describe("AreaTemplateEntity", () => {
    it.each(["", "   "])(
        "should reject an empty templateId (%j)",
        (templateId) => {
            expect(
                () => new AreaTemplateEntity("id", "Seoul", templateId, null),
            ).toThrow("Area template templateId must be a non-empty string");
        },
    );

    it("should trim a valid templateId", () => {
        const entity = new AreaTemplateEntity(
            "id",
            "Seoul",
            "  eform-template-001  ",
            null,
        );

        expect(entity.templateId).toBe("eform-template-001");
    });
});
