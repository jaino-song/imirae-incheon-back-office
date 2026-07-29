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

/** What the mirror stores when eformsign gave it no recipient name at all. */
export const MIRROR_UNKNOWN_RECIPIENT_NAME = "수신자";

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
            step_recipients: buildStepRecipients(document),
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

/**
 * Recipient types only — deliberately without the stored name and contact.
 *
 * A webhook that advances a document updates its step type, index and name but copies the
 * recipient fields forward unchanged, and the reconciliation sweep cannot refresh them
 * either: it reads list responses, which carry no recipients. So what the mirror holds may
 * describe the step *before* the current one. Emitting a name and phone number under
 * `current_status` would present that as the person to contact, and the mobile sheet acts
 * on it — it offers edit-and-send from the list row before the detail request returns.
 *
 * The list itself does not render these; the detail fetch that does is where accurate
 * recipients come from. The types are here because the status counters fold them, and the
 * shadow comparison checks them so a mirror whose recipients have gone stale shows up as a
 * difference rather than being discovered after the switch.
 */
function buildStepRecipients(
    document: EformsignDocEntity,
): Array<Record<string, unknown>> {
    return (document.stepRecipientTypes ?? []).map((recipientType) => ({
        recipient_type: recipientType,
    }));
}
