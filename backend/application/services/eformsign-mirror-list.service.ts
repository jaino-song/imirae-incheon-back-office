import { Inject, Injectable } from "@nestjs/common";

import {
    documentSearchValues,
    eformsignListScopeSelector,
    filterDocumentsByStatusCategory,
    filterDocumentsByTemplate,
    filterOutDeletedDocuments,
    matchesKoreanSearch,
    sortDocumentsByCreatedDate,
    type DocumentStatusCategory,
    type EformsignListDoc,
    type TemplateMatch,
} from "application/utils/eformsign-document-list";
import {
    eformsignListDocFromMirror,
    MIRROR_CUSTOMER_NAME_KEY,
    MIRROR_RECIPIENT_NAME_KEY,
    MIRROR_UNKNOWN_RECIPIENT_NAME,
} from "application/utils/eformsign-list-doc-from-mirror";
import { stringFromUnknown } from "application/utils/eformsign-document-customer-name";
import {
    EFORMSIGN_DOC_REPOSITORY,
    IEformsignDocRepository,
} from "domain/repositories/eformsign-doc.repository.interface";

export interface MirrorListQuery {
    branchId: string;
    isHeadquarters: boolean;
    /** "all" for the merged list, or a tab name the scope selector understands. */
    scope: string;
    templateId?: string;
    templateMatch: TemplateMatch;
    statusCategory?: DocumentStatusCategory;
    search?: string;
    excludeDeleted?: boolean;
}

export interface MirrorListResult {
    /** Filtered and sorted, but not paginated — the caller slices what it needs. */
    documents: EformsignListDoc[];
}

/**
 * Answers the contract list from the local mirror.
 *
 * This is the same computation the shadow comparison measures and the same one the switch
 * serves — deliberately one implementation, because evidence gathered from a second one
 * would say nothing about what production would do.
 *
 * It runs the shared list rules over mirror rows rendered into the vendor's list shape,
 * rather than teaching those rules a second shape. Keeping one set of rules is not tidiness
 * here: a divergence between them is exactly the class of defect this codebase has paid for
 * three times, and it would be invisible to a comparison that used them both.
 */
@Injectable()
export class EformsignMirrorListService {
    constructor(
        @Inject(EFORMSIGN_DOC_REPOSITORY)
        private readonly eformsignDocRepository: IEformsignDocRepository,
    ) {}

    /**
     * Every mirrored document for a scope, in list order and before any per-request
     * filter. Separate from `buildList` so a caller can cache this — the list has to be
     * paginated over one generation, or a document that leaves the set between two pages
     * shifts the rest up and is never shown.
     */
    async loadScopeDocuments(query: {
        branchId: string;
        isHeadquarters: boolean;
    }): Promise<EformsignListDoc[]> {
        // For a regular branch the list rows and the search rows are the same query, so it
        // is read once; only headquarters needs the wider set as well.
        const branchOwned = await this.eformsignDocRepository.findAll(query.branchId);
        const mirrored = query.isHeadquarters
            ? await this.eformsignDocRepository.findAllForHeadquarters(query.branchId)
            : branchOwned;

        // Branch-owned rows only, even for headquarters: the API path builds its
        // recipient-name search corpus from findAll(branchId), so an unassigned document's
        // recipient name is not searchable there either. Carried on the document so a
        // cached generation keeps it without a second read.
        const recipientNameById = new Map(
            branchOwned.map((document) => [
                document.documentId,
                document.stepRecipientName,
            ] as const),
        );
        return mirrored.map((document) => {
            const listDoc = eformsignListDocFromMirror(document);
            const recipientName = recipientNameById.get(document.documentId);
            return recipientName
                ? { ...listDoc, [MIRROR_RECIPIENT_NAME_KEY]: recipientName }
                : listDoc;
        });
    }

    /** Applies the per-request filters to an already-loaded scope. */
    filterScope(documents: EformsignListDoc[], query: MirrorListQuery): MirrorListResult {
        const templateFiltered = filterDocumentsByTemplate(
            documents,
            query.templateId,
            query.templateMatch,
        );
        const deletionFiltered = filterOutDeletedDocuments(
            templateFiltered,
            query.excludeDeleted ?? false,
        );
        const scopeSelector = eformsignListScopeSelector(query.scope);
        const scopeFiltered = scopeSelector === undefined
            ? deletionFiltered
            : deletionFiltered.filter(scopeSelector);
        const statusFiltered = filterDocumentsByStatusCategory(
            scopeFiltered,
            query.statusCategory,
        );
        const searchFiltered = filterBySearch(statusFiltered, query.search);

        return { documents: sortDocumentsByCreatedDate(searchFiltered) };
    }

    async buildList(query: MirrorListQuery): Promise<MirrorListResult> {
        return this.filterScope(await this.loadScopeDocuments(query), query);
    }
}

function filterBySearch(
    documents: EformsignListDoc[],
    search: string | undefined,
): EformsignListDoc[] {
    const query = search?.trim() ?? "";
    if (!query) {
        return documents;
    }

    return documents.filter((document) => {
        const recipientName = document[MIRROR_RECIPIENT_NAME_KEY];
        const values = documentSearchValues(
            document,
            typeof recipientName === "string" ? [recipientName] : [],
        );
        return values.some((value) => matchesKoreanSearch(value, query));
    });
}

/**
 * Fills in the customer name the list renders, the way the API path's enrichment does —
 * except that the mirror already holds the answer, so no document is ever re-fetched.
 *
 * Applied to a page rather than the whole list, and deliberately after filtering: the API
 * path enriches only what it is about to return, so its search never sees these values.
 * Adding them earlier here would quietly make the list searchable by customer name.
 */
export function enrichMirrorPage(documents: EformsignListDoc[]): EformsignListDoc[] {
    return documents.map((document) => {
        const customerName = stringFromUnknown(document[MIRROR_CUSTOMER_NAME_KEY])
            ?? recipientNameAsCustomerName(document);
        if (!customerName) {
            return document;
        }

        return {
            ...document,
            fields: [
                ...(Array.isArray(document.fields) ? document.fields : []),
                { id: "이용자 성명", value: customerName },
            ],
        };
    });
}

/**
 * The branch's own recipient name, used the way the API path uses it — and only where it
 * does. That path reads this from a branch-scoped lookup, so an unclaimed document never
 * gets one; it falls through to a document-detail fetch instead.
 *
 * Which is why this must not reach for the recipient name of an unclaimed row even though
 * the mirror has it: `stepRecipientName` is whoever the *current* step is waiting on, and
 * when that step is the provider review it is the provider. Showing the wrong person's
 * name is worse than showing none, so those rows read 고객 미지정 until the mirror learns
 * a real customer name — which it does the moment any webhook touches the document, since
 * that path mirrors from a detail response.
 *
 * Adoption can also put the document title here, or — when it had neither a name nor a
 * title — the literal word 수신자. Neither is a customer name, and the API path rejects
 * both: `findDisplayFieldsByDocumentIds` nulls the sentinel out before enrichment sees it,
 * and enrichment itself drops a title match. Both then fall through to a detail fetch. This
 * path has no detail fetch to fall through to, so it returns nothing and the row reads
 * 고객 미지정 — which is what the UI's own missing-name fallback is for, and what it would
 * stop doing if we handed it the sentinel as a name.
 */
function recipientNameAsCustomerName(document: EformsignListDoc): string | null {
    const recipientName = stringFromUnknown(document[MIRROR_RECIPIENT_NAME_KEY]);
    if (!recipientName || recipientName === MIRROR_UNKNOWN_RECIPIENT_NAME) {
        return null;
    }

    const documentTitle = (stringFromUnknown(document["document_name"]) ?? "").trim();
    return recipientName === documentTitle ? null : recipientName;
}
