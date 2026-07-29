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
import { eformsignListDocFromMirror } from "application/utils/eformsign-list-doc-from-mirror";
import { stringFromUnknown } from "application/utils/eformsign-document-customer-name";
import { EformsignDocEntity } from "domain/entities/eformsign-doc.entity";
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
    /** The rows behind those documents, for filling in display values on a page. */
    entityById: Map<string, EformsignDocEntity>;
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

    async buildList(query: MirrorListQuery): Promise<MirrorListResult> {
        // For a regular branch the list rows and the search rows are the same query, so it
        // is read once; only headquarters needs the wider set as well.
        const branchOwned = await this.eformsignDocRepository.findAll(query.branchId);
        const mirrored = query.isHeadquarters
            ? await this.eformsignDocRepository.findAllForHeadquarters(query.branchId)
            : branchOwned;

        // Branch-owned rows only, even for headquarters: the API path builds its
        // recipient-name search corpus from findAll(branchId), so an unassigned document's
        // recipient name is not searchable there either.
        const searchValuesById = new Map(
            branchOwned.map((document) => [
                document.documentId,
                [document.stepRecipientName].filter((value) => Boolean(value)),
            ] as const),
        );
        const entityById = new Map(
            mirrored.map((document) => [document.documentId, document] as const),
        );
        const documents = mirrored.map(eformsignListDocFromMirror);

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
        const searchFiltered = filterBySearch(statusFiltered, searchValuesById, query.search);

        return {
            documents: sortDocumentsByCreatedDate(searchFiltered),
            entityById,
        };
    }
}

function filterBySearch(
    documents: EformsignListDoc[],
    searchValuesById: Map<string, string[]>,
    search: string | undefined,
): EformsignListDoc[] {
    const query = search?.trim() ?? "";
    if (!query) {
        return documents;
    }

    return documents.filter((document) => {
        const values = documentSearchValues(
            document,
            searchValuesById.get(document.id) ?? [],
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
export function enrichMirrorPage(
    documents: EformsignListDoc[],
    entityById: Map<string, EformsignDocEntity>,
): EformsignListDoc[] {
    return documents.map((document) => {
        const entity = entityById.get(document.id);
        if (!entity) {
            return document;
        }

        const customerName = entity.customerName
            ?? recipientNameAsCustomerName(entity, document);
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
 * Adoption can fall back to the document title for the recipient name, and a title is not
 * a customer name. The API path skips those for the same reason.
 */
function recipientNameAsCustomerName(
    entity: EformsignDocEntity,
    document: EformsignListDoc,
): string | null {
    const recipientName = entity.stepRecipientName?.trim();
    if (!recipientName) {
        return null;
    }

    const documentTitle = (stringFromUnknown(document["document_name"]) ?? "").trim();
    return recipientName === documentTitle ? null : recipientName;
}
