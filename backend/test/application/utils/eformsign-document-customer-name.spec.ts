import { documentCustomerNameValue } from "application/utils/eformsign-document-customer-name";

describe("documentCustomerNameValue", () => {
    it("keeps the direct-key pass before the field-record id pass", () => {
        expect(documentCustomerNameValue({
            fields: [{ id: "이용자 성명", value: "필드 고객" }],
            detail_template_info: {
                field_values: { "이용자 성명": "상세 고객" },
            },
        })).toBe("상세 고객");
    });

    it("extracts a normalized alias from nested detail template data", () => {
        expect(documentCustomerNameValue({
            detail_template_info: {
                groups: [{ customer_name: { value: "상세 고객" } }],
            },
        })).toBe("상세 고객");
    });

    it("keeps the field-record value key priority", () => {
        expect(documentCustomerNameValue({
            fields: [{
                field_id: "clientName",
                value: "첫 값",
                field_value: "둘째 값",
            }],
        })).toBe("첫 값");
    });

    it("returns null when no customer-name alias has a value", () => {
        expect(documentCustomerNameValue({
            fields: [{ id: "주소", value: "인천" }],
        })).toBeNull();
    });
});
