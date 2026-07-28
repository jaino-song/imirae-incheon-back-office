import { EformsignDocEntity } from "domain/entities/eformsign-doc.entity";
import {
    decodeEformsignStepRecipientTypes,
    encodeEformsignStepRecipientTypes,
} from "domain/value-objects/eformsign-step-recipient-types";
import { EformsignDocMapper } from "infrastructure/database/mapper/eformsign-doc.mapper";

const createEntity = (overrides: Partial<ConstructorParameters<typeof EformsignDocEntity>[0]> = {}) =>
    EformsignDocEntity.reconstitute({
        id: 1,
        documentId: "doc-1",
        createdDate: new Date("2026-07-01T00:00:00.000Z"),
        updatedDate: new Date("2026-07-02T00:00:00.000Z"),
        statusType: "060",
        statusDetail: "대기",
        stepType: "05",
        stepIndex: "1",
        stepName: "이용자",
        stepRecipientType: "05",
        stepRecipientName: "고객",
        stepRecipientSms: "01012345678",
        expiredDate: new Date("2026-08-01T00:00:00.000Z"),
        expired: false,
        clientId: 7,
        ...overrides,
    });

describe("eformsign step recipient type codec", () => {
    it("round-trips recipient type codes through delimiter-joined text", () => {
        const encoded = encodeEformsignStepRecipientTypes(["05", "06", "01"]);

        expect(encoded).toBe("05,06,01");
        expect(decodeEformsignStepRecipientTypes(encoded)).toEqual(["05", "06", "01"]);
    });

    it("normalizes empty values to null", () => {
        expect(encodeEformsignStepRecipientTypes([" ", "", null, undefined])).toBeNull();
        expect(decodeEformsignStepRecipientTypes(null)).toBeNull();
    });
});

describe("EformsignDocMapper", () => {
    it("encodes and decodes the list display fields at the persistence boundary", () => {
        const entity = createEntity({
            templateName: "표준 계약서",
            customerName: "김고객",
            creatorName: "생성자",
            lastEditorName: "편집자",
            stepRecipientTypes: ["05", "06"],
        });

        expect(EformsignDocMapper.toPrismaCreate(entity)).toEqual(expect.objectContaining({
            templateName: "표준 계약서",
            customerName: "김고객",
            creatorName: "생성자",
            lastEditorName: "편집자",
            stepRecipientTypes: "05,06",
        }));
    });

    it("omits every nullable list display field from updates when the caller did not carry it", () => {
        const update = EformsignDocMapper.toPrismaUpdate(createEntity());

        expect(update).not.toHaveProperty("templateName");
        expect(update).not.toHaveProperty("customerName");
        expect(update).not.toHaveProperty("creatorName");
        expect(update).not.toHaveProperty("lastEditorName");
        expect(update).not.toHaveProperty("stepRecipientTypes");
    });
});
