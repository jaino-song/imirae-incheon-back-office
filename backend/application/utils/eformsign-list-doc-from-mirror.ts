import { EformsignDocEntity } from "domain/entities/eformsign-doc.entity";

import type { EformsignListDoc } from "./eformsign-document-list";

/**
 * Renders a mirrored row into the shape eformsign's list endpoint returns.
 *
 * The point is not to fake a vendor response for its own sake — it is that the list rules
 * (filter, search, sort) must run over local rows byte-for-byte the same way they run over
 * the vendor's. Projecting into one shape and reusing those functions is the only version
 * of that which cannot drift; a parallel set of rules for local rows would be the fourth
 * time this codebase paid for the same mistake.
 *
 * Fields the list rules never read — histories, recipients, next/previous status — are
 * deliberately absent rather than invented. A caller that needs them is not looking at a
 * list and should fetch the document.
 */
/**
 * Where the mirror's own customer name rides along. Not a vendor field, and deliberately
 * not one the list rules read: filtering and searching must not see it, because the API
 * path's search index is built before enrichment and never sees a customer name either.
 * The page enrichment lifts it into `fields`, which is where the UI looks.
 */
export const MIRROR_CUSTOMER_NAME_KEY = "_mirror_customer_name";

/**
 * The branch's own recipient name for a document, carried the same way and for the same
 * reason: the search reads it, headquarters must not see it for unclaimed documents, and
 * a cached generation has to keep it without going back to the database.
 */
export const MIRROR_RECIPIENT_NAME_KEY = "_mirror_recipient_name";

export function eformsignListDocFromMirror(document: EformsignDocEntity): EformsignListDoc {
    return {
        id: document.documentId,
        document_name: document.documentName ?? "",
        document_number: document.documentNumber ?? "",
        created_date: document.createdDate.getTime(),
        updated_date: document.updatedDate.getTime(),
        template: {
            id: document.templateId ?? "",
            name: document.templateName ?? "",
        },
        creator: { name: document.creatorName ?? "" },
        last_editor: { name: document.lastEditorName ?? "" },
        current_status: {
            status_type: document.statusType,
            status_doc_detail: document.statusDetail,
            step_type: document.stepType,
            step_index: document.stepIndex,
            step_name: document.stepName,
            step_recipients: (document.stepRecipientTypes ?? []).map((recipientType) => ({
                recipient_type: recipientType,
            })),
            _expired: document.expired,
        },
        ...(document.customerName === null
            ? {}
            : { [MIRROR_CUSTOMER_NAME_KEY]: document.customerName }),
        // No `fields`, deliberately, even though the mirror holds a customerName. The
        // vendor's list endpoint is fetched without include_fields — only the
        // single-document fetch asks for them — so the served search never sees a customer
        // name from the document itself and matches on the local recipient name instead.
        // Emitting one here would make the mirror find documents the served path cannot,
        // and every such difference would be this mapper's, not the mirror's.
        //
        // Phase E may well decide the list should search customerName. That is a change in
        // what the feature does and belongs in that decision, not inherited by accident.
    };
}
