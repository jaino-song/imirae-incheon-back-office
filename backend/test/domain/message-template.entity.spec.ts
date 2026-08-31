import { MessageTemplateEntity, TemplateVariable } from "domain/entities/message-template.entity";

describe("MessageTemplateEntity", () => {
    const variableWithFallback: TemplateVariable = {
        key: "name",
        type: "text",
        label: "이름",
        required: true,
        fallback: "고객",
    };

    describe("create", () => {
        it("should preserve a variable's fallback", () => {
            const entity = MessageTemplateEntity.create({
                name: "환영 메시지",
                content: "안녕하세요 {{name}}님",
                variables: [variableWithFallback],
            });

            expect(entity.variables[0]).toMatchObject({ key: "name", fallback: "고객" });
        });
    });

    describe("reconstitute", () => {
        it("should preserve a variable's fallback", () => {
            const createdAt = new Date("2025-01-01T00:00:00Z");
            const updatedAt = new Date("2025-01-01T00:00:00Z");

            const entity = MessageTemplateEntity.reconstitute(
                "template-1",
                "환영 메시지",
                "안녕하세요 {{name}}님",
                [variableWithFallback],
                createdAt,
                updatedAt
            );

            expect(entity.variables[0]).toMatchObject({ key: "name", fallback: "고객" });
        });
    });

    describe("update", () => {
        it("should round-trip a variable's fallback through an update", () => {
            const entity = MessageTemplateEntity.reconstitute(
                "template-1",
                "환영 메시지",
                "안녕하세요 {{name}}님",
                [{ key: "name", type: "text", label: "이름", required: true }],
                new Date("2025-01-01T00:00:00Z"),
                new Date("2025-01-01T00:00:00Z")
            );

            entity.update({ variables: [variableWithFallback] });

            expect(entity.variables[0]).toMatchObject({ key: "name", fallback: "고객" });
        });
    });

    describe("validateVariables", () => {
        it("should not be affected by a variable carrying fallback", () => {
            const entity = MessageTemplateEntity.create({
                name: "환영 메시지",
                content: "안녕하세요 {{name}}님",
                variables: [variableWithFallback],
            });

            const result = entity.validateVariables();

            expect(result.valid).toBe(true);
            expect(result.errors).toEqual([]);
        });

        it("should still flag a variable defined but unused in content, fallback notwithstanding", () => {
            const entity = MessageTemplateEntity.create({
                name: "환영 메시지",
                content: "안녕하세요",
                variables: [variableWithFallback],
            });

            const result = entity.validateVariables();

            expect(result.valid).toBe(false);
            expect(result.errors).toEqual(["사용되지 않는 변수 정의: name"]);
        });

        it("should still flag a variable used in content but not defined", () => {
            const entity = MessageTemplateEntity.create({
                name: "환영 메시지",
                content: "안녕하세요 {{name}}님",
                variables: [],
            });

            const result = entity.validateVariables();

            expect(result.valid).toBe(false);
            expect(result.errors).toEqual(["템플릿에 정의되지 않은 변수: {{name}}"]);
        });
    });
});
