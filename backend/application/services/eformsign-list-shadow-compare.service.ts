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
    documentIds: string[];
    totalRows: number;
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

        void this.compare(query, served).catch((error: unknown) => {
            this.logger.warn(
                `[Shadow] comparison failed scope=${query.scope}: ${
                    error instanceof Error ? error.message : String(error)
                }`,
            );
        });
    }

    private async compare(
        query: ListShadowCompareQuery,
        served: ListShadowCompareServed,
    ): Promise<void> {
        const local = await this.buildLocalPage(query);
        const differences: string[] = [];

        if (local.totalRows !== served.totalRows) {
            differences.push(`total_rows served=${served.totalRows} local=${local.totalRows}`);
        }

        const servedSet = new Set(served.documentIds);
        const localSet = new Set(local.documentIds);
        const missing = served.documentIds.filter((id) => !localSet.has(id));
        const extra = local.documentIds.filter((id) => !servedSet.has(id));

        if (missing.length > 0) {
            differences.push(`missing=${summariseIds(missing)}`);
        }
        if (extra.length > 0) {
            differences.push(`extra=${summariseIds(extra)}`);
        }
        // Only worth reporting when both pages hold the same documents: otherwise the
        // order difference is just a restatement of the membership difference above.
        if (missing.length === 0
            && extra.length === 0
            && local.documentIds.join(",") !== served.documentIds.join(",")) {
            differences.push("order differs");
        }

        if (differences.length === 0) {
            this.logger.log(
                `[Shadow] match scope=${query.scope} branch=${query.branchId}`
                + ` skip=${query.skip} rows=${served.totalRows}`,
            );
            return;
        }

        this.logger.warn(
            `[Shadow] diff scope=${query.scope} branch=${query.branchId}`
            + ` skip=${query.skip} limit=${query.limit}`
            + `${query.search ? ` search="${query.search}"` : ""}`
            + `${query.statusCategory ? ` status=${query.statusCategory}` : ""}`
            + ` :: ${differences.join("; ")}`,
        );
    }

    private async buildLocalPage(
        query: ListShadowCompareQuery,
    ): Promise<{ documentIds: string[]; totalRows: number }> {
        const mirrored = query.isHeadquarters
            ? await this.eformsignDocRepository.findAllForHeadquarters(query.branchId)
            : await this.eformsignDocRepository.findAll(query.branchId);
        // Recipient names come from the same rows, so unlike the served path this does not
        // need a second lookup to search them.
        const localSearchValues = new Map(
            mirrored.map((document) => [
                document.documentId,
                [document.stepRecipientName].filter((value) => Boolean(value)),
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
            documentIds: sorted
                .slice(query.skip, query.skip + query.limit)
                .map((document) => document.id),
            totalRows: sorted.length,
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
