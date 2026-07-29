import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import {
    documentSearchValues,
    filterDocumentsByStatusCategory,
    filterDocumentsByTemplate,
    filterOutDeletedDocuments,
    getDocumentStatusCategory,
    matchesKoreanSearch,
    sortDocumentsByCreatedDate,
    type DocumentStatusCategory,
    type EformsignListDoc,
    type TemplateMatch,
} from "application/utils/eformsign-document-list";
import {
    isRecord,
    stringFromUnknown,
} from "application/utils/eformsign-document-customer-name";
import { eformsignDocumentTemplateId } from "application/utils/eformsign-document-template-id";
import { eformsignListDocFromMirror } from "application/utils/eformsign-list-doc-from-mirror";
import { getDocumentCreatedTimestamp } from "application/services/eformsign.service";
import {
    normalizeEformsignStatusCode,
    normalizeEformsignStepType,
} from "domain/utils/eformsign-status-code";
import {
    EFORMSIGN_DOC_REPOSITORY,
    IEformsignDocRepository,
} from "domain/repositories/eformsign-doc.repository.interface";

export interface ListShadowCompareQuery {
    branchId: string;
    isHeadquarters: boolean;
    scope: string;
    /**
     * For the per-tab endpoints, the status categories a local list would use in place of
     * "whichever vendor inbox the document sits in" — the mirror does not record that, and
     * the switch has to answer those tabs from status codes instead.
     *
     * So a difference on these scopes means one of two things: the mirror is stale, or the
     * vendor's inbox and its own status code disagree about where a document belongs. Both
     * are worth knowing before the switch; neither shows up on the merged list.
     */
    scopeCategories?: DocumentStatusCategory[];
    limit: number;
    skip: number;
    templateId?: string;
    templateMatch: TemplateMatch;
    statusCategory?: DocumentStatusCategory;
    search?: string;
    excludeDeleted?: boolean;
}

/** The list values the contracts UI actually renders, normalised for comparison. */
export interface ListShadowCompareFields {
    documentName: string;
    documentNumber: string;
    templateId: string;
    templateName: string;
    statusType: string;
    stepType: string;
    stepIndex: string;
    stepName: string;
    createdAt: number;
    /** Rendered as the signed/completion date, so a stale one shows users a wrong date. */
    updatedAt: number;
}

export interface ListShadowCompareServed {
    /** Every document that survived the filters, in served order — not just the page. */
    documentIds: string[];
    /** Same documents, by id, projected to the values the UI reads. */
    fieldsById: Map<string, ListShadowCompareFields>;
    /**
     * Created time of the oldest document the vendor scan produced for this scope, taken
     * before any per-request filter — undefined when the scan returned nothing.
     *
     * The served path scans at most 10 vendor pages of 100 and warns in its own log when
     * it hits that cap. A mirrored row older than this is outside the range the API path
     * returned, so it is reported apart from a real disagreement rather than counted as
     * one; whether that is the cap or a document the vendor no longer has is answered by
     * the scan's own warning in the same logs.
     */
    oldestScannedAt: number | undefined;
    /**
     * Whether the vendor scan stopped at its page cap. A scan that simply ran out is
     * exhaustive, so a mirrored row the vendor did not return is stale however old it is —
     * suppressing those would be the one way this comparison could bless a wrong mirror.
     */
    scanCapped: boolean;
}

/** How many differing ids to name before the log becomes noise rather than evidence. */
const MAX_LOGGED_IDS = 10;

/**
 * Runs the contract list a second time against the local mirror and reports only where the
 * two disagree. Nothing it computes is ever served — this is the evidence for whether the
 * mirror is ready to become the source, and the only honest way to get that evidence is to
 * answer the same question both ways on real traffic.
 *
 * It reuses the list rules rather than reimplementing them, so a difference here means the
 * mirror's *data* differs, never that the two paths filtered differently.
 *
 * Off unless `EFORMSIGN_SHADOW_COMPARE_ENABLED=true`.
 */
@Injectable()
export class EformsignListShadowCompareService {
    private readonly logger = new Logger(EformsignListShadowCompareService.name);
    /**
     * One comparison at a time. Every list request would otherwise load the branch's whole
     * mirror and sort it, and a burst of page-throughs or searches would put that in front
     * of the Prisma pool the served requests are using. Skipping is fine: this is sampling
     * for evidence, not an audit that must see every request.
     */
    private comparisonInFlight = false;
    private skippedWhileBusy = 0;

    constructor(
        private readonly configService: ConfigService,
        @Inject(EFORMSIGN_DOC_REPOSITORY)
        private readonly eformsignDocRepository: IEformsignDocRepository,
    ) {}

    isEnabled(): boolean {
        return this.configService.get<string>("EFORMSIGN_SHADOW_COMPARE_ENABLED") === "true";
    }

    /**
     * Fire-and-forget: the caller has already answered the request. A comparison that
     * throws must never turn a served page into an error, so everything is swallowed
     * into a log — this feature exists to observe, not to participate.
     */
    compareInBackground(query: ListShadowCompareQuery, served: ListShadowCompareServed): void {
        if (!this.isEnabled()) {
            return;
        }

        if (this.comparisonInFlight) {
            this.skippedWhileBusy += 1;
            return;
        }

        this.comparisonInFlight = true;
        void this.compare(query, served)
            .catch((error: unknown) => {
                this.logger.warn(
                    `[Shadow] comparison failed scope=${query.scope}: ${
                        error instanceof Error ? error.message : String(error)
                    }`,
                );
            })
            .finally(() => {
                this.comparisonInFlight = false;
            });
    }

    private async compare(
        query: ListShadowCompareQuery,
        served: ListShadowCompareServed,
    ): Promise<void> {
        const local = await this.buildLocalList(query);
        const servedSet = new Set(served.documentIds);
        const localSet = new Set(local.documentIds);

        const missing = served.documentIds.filter((id) => !localSet.has(id));
        const beyondWindow: string[] = [];
        const extra: string[] = [];
        const unclassifiable: string[] = [];
        for (const id of local.documentIds) {
            if (servedSet.has(id)) {
                continue;
            }
            if (!served.scanCapped) {
                // Exhaustive scan: the vendor does not have this document, whatever its
                // age. That is a real disagreement.
                extra.push(id);
                continue;
            }
            if (served.oldestScannedAt === undefined) {
                // The vendor scan produced nothing for this scope, so there is no range to
                // place these against. A branch whose documents all sit past the scan cap
                // looks exactly like a branch whose mirror is wrong, and claiming either
                // would be inventing a verdict — say what we have instead.
                unclassifiable.push(id);
                continue;
            }
            const createdAt = local.fieldsById.get(id)?.createdAt;
            const olderThanScanned = createdAt !== undefined
                && createdAt < served.oldestScannedAt;
            (olderThanScanned ? beyondWindow : extra).push(id);
        }

        const differences: string[] = [];
        if (missing.length > 0) {
            differences.push(`missing=${summariseIds(missing)}`);
        }
        if (extra.length > 0) {
            differences.push(`extra=${summariseIds(extra)}`);
        }
        if (unclassifiable.length > 0) {
            differences.push(
                `localOnlyNoScanRange=${summariseIds(unclassifiable)}`
                + " (vendor scan returned nothing for this scope)",
            );
        }
        // Compare order over the documents both sides can hold — dropping the out-of-range
        // ones rather than giving up on the check whenever any exist, which would have hid
        // a reversal behind a single ancient row.
        const beyondWindowSet = new Set(beyondWindow);
        const comparableLocalIds = local.documentIds.filter((id) => !beyondWindowSet.has(id));
        if (missing.length === 0
            && extra.length === 0
            && comparableLocalIds.join(",") !== served.documentIds.join(",")) {
            differences.push("order differs");
        }

        // Same documents in the same order still serves different content if the values
        // differ, and the UI reads these directly — status drives the pill and which
        // actions are offered. A zero-diff gate that never looked at them would be a
        // gate on membership alone.
        const fieldDifferences = collectFieldDifferences(served, local.fieldsById);
        if (fieldDifferences.length > 0) {
            differences.push(`fields=${summariseIds(fieldDifferences)}`);
        }

        // Named separately from `rows` so a reader cannot mistake it for a disagreement.
        const windowNote = beyondWindow.length > 0
            ? ` olderThanScanned=${beyondWindow.length}`
            : "";
        // Enough of the query to tell one difference apart from another without carrying
        // anything a customer could be identified by. The search term itself is a customer
        // name often enough that it stays out; that a search happened is what explains a
        // difference, and the ids below say which documents to go and look at.
        const skipped = this.skippedWhileBusy;
        this.skippedWhileBusy = 0;
        const context = `scope=${query.scope} branch=${query.branchId}`
            + ` rows=${served.documentIds.length}`
            + windowNote
            + `${query.search?.trim() ? " search=present" : ""}`
            + `${query.statusCategory ? ` status=${query.statusCategory}` : ""}`
            + `${query.templateId ? ` template=${query.templateMatch}` : ""}`
            + `${query.excludeDeleted ? " excludeDeleted" : ""}`
            + `${skipped > 0 ? ` skippedWhileBusy=${skipped}` : ""}`;

        if (differences.length === 0) {
            this.logger.log(`[Shadow] match ${context}`);
            return;
        }

        this.logger.warn(`[Shadow] diff ${context} :: ${differences.join("; ")}`);
    }

    private async buildLocalList(
        query: ListShadowCompareQuery,
    ): Promise<{ documentIds: string[]; fieldsById: Map<string, ListShadowCompareFields> }> {
        // For a regular branch the corpus and the search rows are the same query, so it
        // is read once; only headquarters needs the wider set as well.
        const branchOwned = await this.eformsignDocRepository.findAll(query.branchId);
        const mirrored = query.isHeadquarters
            ? await this.eformsignDocRepository.findAllForHeadquarters(query.branchId)
            : branchOwned;
        // Deliberately the branch-owned rows only, even for headquarters. The served path
        // builds its recipient-name search corpus from findAll(branchId), so an unassigned
        // document's recipient name is not searchable there — reproducing that is the
        // point, and "fixing" it here would report a difference that is ours, not the
        // mirror's.
        const localSearchValues = new Map(
            branchOwned.map((document) => [
                document.documentId,
                [document.stepRecipientName].filter((value) => Boolean(value)),
            ] as const),
        );
        const documents = mirrored.map(eformsignListDocFromMirror);
        const fieldsById = new Map(
            documents.map((document) => [
                document.id,
                eformsignListCompareFields(document),
            ] as const),
        );

        const templateFiltered = filterDocumentsByTemplate(
            documents,
            query.templateId,
            query.templateMatch,
        );
        const deletionFiltered = filterOutDeletedDocuments(
            templateFiltered,
            query.excludeDeleted ?? false,
        );
        const scopeFiltered = query.scopeCategories === undefined
            ? deletionFiltered
            : deletionFiltered.filter((document) =>
                query.scopeCategories!.includes(getDocumentStatusCategory(document)));
        const statusFiltered = filterDocumentsByStatusCategory(
            scopeFiltered,
            query.statusCategory,
        );
        const searchFiltered = this.filterBySearch(statusFiltered, localSearchValues, query.search);
        const sorted = sortDocumentsByCreatedDate(searchFiltered);

        return {
            documentIds: sorted.map((document) => document.id),
            fieldsById,
        };
    }

    private filterBySearch(
        documents: EformsignListDoc[],
        localSearchValues: Map<string, string[]>,
        search: string | undefined,
    ): EformsignListDoc[] {
        const query = search?.trim() ?? "";
        if (!query) {
            return documents;
        }

        return documents.filter((document) => {
            const values = documentSearchValues(
                document,
                localSearchValues.get(document.id) ?? [],
            );
            return values.some((value) => matchesKoreanSearch(value, query));
        });
    }
}

/**
 * Projects a list document — vendor's or mirror's — to the values the contracts UI reads.
 * Both sides go through this same function so a difference is a difference in the data,
 * never in how the two were read.
 */
export function eformsignListCompareFields(
    document: EformsignListDoc,
): ListShadowCompareFields {
    const template = isRecord(document["template"]) ? document["template"] : null;
    const currentStatus = isRecord(document["current_status"])
        ? document["current_status"]
        : null;

    return {
        documentName: stringFromUnknown(document["document_name"]) ?? "",
        documentNumber: stringFromUnknown(document["document_number"]) ?? "",
        // Resolved rather than read straight off `template`, because the vendor supplies
        // it through three different places and the filter already agrees on the order.
        templateId: eformsignDocumentTemplateId(document) ?? "",
        templateName: stringFromUnknown(template?.["name"]) ?? "",
        statusType: normalizeEformsignStatusCode(
            stringFromUnknown(currentStatus?.["status_type"]),
        ),
        stepType: normalizeEformsignStepType(stringFromUnknown(currentStatus?.["step_type"])),
        stepIndex: stringFromUnknown(currentStatus?.["step_index"]) ?? "",
        stepName: stringFromUnknown(currentStatus?.["step_name"]) ?? "",
        createdAt: getDocumentCreatedTimestamp(document),
        updatedAt: numberFromUnknown(document["updated_date"]),
    };
}

function numberFromUnknown(value: unknown): number {
    if (typeof value === "number") {
        return Number.isFinite(value) ? value : 0;
    }
    if (typeof value === "string") {
        const parsed = Number(value);
        return Number.isFinite(parsed) && value.trim() !== "" ? parsed : Date.parse(value) || 0;
    }
    return 0;
}

/** Ids whose served and mirrored values disagree, each tagged with the fields that did. */
function collectFieldDifferences(
    served: ListShadowCompareServed,
    localFieldsById: Map<string, ListShadowCompareFields>,
): string[] {
    const differing: string[] = [];
    for (const [documentId, servedFields] of served.fieldsById) {
        const localFields = localFieldsById.get(documentId);
        if (!localFields) {
            continue;
        }

        const names = (Object.keys(servedFields) as Array<keyof ListShadowCompareFields>)
            .filter((name) => servedFields[name] !== localFields[name]);
        if (names.length > 0) {
            differing.push(`${documentId}[${names.join("|")}]`);
        }
    }
    return differing;
}

function summariseIds(ids: string[]): string {
    const shown = ids.slice(0, MAX_LOGGED_IDS).join(",");
    return ids.length > MAX_LOGGED_IDS
        ? `${shown}(+${ids.length - MAX_LOGGED_IDS} more)`
        : shown;
}
