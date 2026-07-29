import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import {
    documentSearchValues,
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
import {
    EFORMSIGN_DOC_REPOSITORY,
    IEformsignDocRepository,
} from "domain/repositories/eformsign-doc.repository.interface";

export interface ListShadowCompareQuery {
    branchId: string;
    isHeadquarters: boolean;
    scope: string;
    limit: number;
    skip: number;
    templateId?: string;
    templateMatch: TemplateMatch;
    statusCategory?: DocumentStatusCategory;
    search?: string;
    excludeDeleted?: boolean;
}

export interface ListShadowCompareServed {
    /** Every document that survived the filters, in served order — not just the page. */
    documentIds: string[];
    /**
     * Created time of the oldest served document, or undefined when nothing survived.
     * The served path scans at most 10 vendor pages of 100, and says so in its own log,
     * so anything the mirror holds from before this point is outside the window the API
     * path can even see. Attributing those separately is what keeps the zero-diff gate
     * reachable: they are what the switch recovers, not evidence the mirror is wrong.
     */
    oldestCreatedAt: number | undefined;
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
        for (const id of local.documentIds) {
            if (servedSet.has(id)) {
                continue;
            }
            const createdAt = local.createdAtById.get(id);
            const outsideScanWindow = served.oldestCreatedAt !== undefined
                && createdAt !== undefined
                && createdAt < served.oldestCreatedAt;
            (outsideScanWindow ? beyondWindow : extra).push(id);
        }

        const differences: string[] = [];
        if (missing.length > 0) {
            differences.push(`missing=${summariseIds(missing)}`);
        }
        if (extra.length > 0) {
            differences.push(`extra=${summariseIds(extra)}`);
        }
        // An order difference is only its own finding when both sides hold the same
        // documents; otherwise it just restates the membership difference above.
        if (missing.length === 0
            && extra.length === 0
            && beyondWindow.length === 0
            && local.documentIds.join(",") !== served.documentIds.join(",")) {
            differences.push("order differs");
        }

        // Named separately from `rows` so a reader cannot mistake it for a disagreement.
        const windowNote = beyondWindow.length > 0
            ? ` beyondScanWindow=${beyondWindow.length}`
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
    ): Promise<{ documentIds: string[]; createdAtById: Map<string, number> }> {
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
        const createdAtById = new Map(
            mirrored.map((document) => [
                document.documentId,
                document.createdDate.getTime(),
            ] as const),
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
        const statusFiltered = filterDocumentsByStatusCategory(
            deletionFiltered,
            query.statusCategory,
        );
        const searchFiltered = this.filterBySearch(statusFiltered, localSearchValues, query.search);
        const sorted = sortDocumentsByCreatedDate(searchFiltered);

        return {
            documentIds: sorted.map((document) => document.id),
            createdAtById,
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

function summariseIds(ids: string[]): string {
    const shown = ids.slice(0, MAX_LOGGED_IDS).join(",");
    return ids.length > MAX_LOGGED_IDS
        ? `${shown}(+${ids.length - MAX_LOGGED_IDS} more)`
        : shown;
}
