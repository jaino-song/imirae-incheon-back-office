import { enrichMirrorPage } from "application/services/eformsign-mirror-list.service";
import { documentCustomerNameValue } from "application/utils/eformsign-document-customer-name";
import { eformsignListDocFromMirror } from "application/utils/eformsign-list-doc-from-mirror";
import { EformsignDocEntity } from "domain/entities/eformsign-doc.entity";

function createMirrorDocument(): EformsignDocEntity {
    return EformsignDocEntity.reconstitute({
        id: 1,
        documentId: "doc-1",
        documentName: "산모신생아건강관리서비스 계약서",
        documentNumber: "NO-0001",
        templateName: "표준 계약서",
        customerName: "김고객",
        creatorName: "생성자",
        lastEditorName: "편집자",
        stepRecipientTypes: ["05", "06"],
        createdDate: new Date("2026-07-01T00:00:00.000Z"),
        updatedDate: new Date("2026-07-02T00:00:00.000Z"),
        statusType: "060",
        statusDetail: "서명 요청됨",
        stepType: "01",
        stepIndex: "2",
        stepName: "이용자 서명",
        stepRecipientType: "05",
        stepRecipientName: "송진호",
        stepRecipientSms: "01012345678",
        expiredDate: new Date("2026-08-01T00:00:00.000Z"),
        expired: false,
        clientId: null,
        documentKind: null,
        employeeScheduleId: null,
        templateId: "template-1",
    });
}

/**
 * Every property the contract list actually reads off a document, gathered from the
 * desktop row, the mobile row, the hooks that sort and dedupe, and the status-count
 * signal. Anything the *detail* panel needs is absent on purpose: it refetches by id and
 * uses the list item only as placeholder data, exactly as it does against the vendor list.
 */
const LIST_UI_PROPERTY_PATHS = [
    "id",
    "document_name",
    "document_number",
    "created_date",
    "updated_date",
    "template.name",
    "current_status.status_type",
    "current_status.step_type",
    "current_status.step_name",
    "current_status.step_recipients",
] as const;

function readPath(document: unknown, path: string): unknown {
    return path.split(".").reduce<unknown>(
        (value, key) => (value as Record<string, unknown> | undefined)?.[key],
        document,
    );
}

describe("eformsignListDocFromMirror", () => {
    it("carries every property the contract list reads", () => {
        // The switch is only safe if a mirrored row can answer everything the list asks
        // of a document. When a new field starts being rendered, this list grows and this
        // test is what says whether the mirror can supply it.
        const document = eformsignListDocFromMirror(createMirrorDocument());

        for (const path of LIST_UI_PROPERTY_PATHS) {
            expect({ path, value: readPath(document, path) }).toEqual({
                path,
                value: expect.anything(),
            });
        }
    });

    it("carries the recipient types the status counters fold", () => {
        const document = eformsignListDocFromMirror(createMirrorDocument());

        expect(document["current_status"]).toEqual(
            expect.objectContaining({
                step_recipients: [
                    { recipient_type: "05" },
                    { recipient_type: "06" },
                ],
            }),
        );
    });

    it("emits timestamps as epoch milliseconds, the way the list sorts and formats them", () => {
        const document = eformsignListDocFromMirror(createMirrorDocument());

        expect(document.created_date).toBe(Date.parse("2026-07-01T00:00:00.000Z"));
        expect(document["updated_date"]).toBe(Date.parse("2026-07-02T00:00:00.000Z"));
    });

    it("leaves the customer name out until the page is enriched", () => {
        // Filtering and searching happen before enrichment on the API path, so a customer
        // name must not be visible to them here either — otherwise switching the source
        // would silently change what a search finds.
        const document = eformsignListDocFromMirror(createMirrorDocument());

        expect(documentCustomerNameValue(document)).toBeNull();
        expect(documentCustomerNameValue(enrichMirrorPage([document])[0]!)).toBe("김고객");
    });
});
