import { Inject, Injectable, Logger } from "@nestjs/common";

import {
    EFORMSIGN_DOC_REPOSITORY,
    EformsignDocStaleUpdateError,
    IEformsignDocRepository,
} from "domain/repositories/eformsign-doc.repository.interface";
import {
    EFORMSIGN_CLIENT_REPOSITORY,
    EformsignApiDocumentResponse,
    EformsignApiListResponse,
    IEformsignClientRepository,
} from "domain/repositories/eformsign.client.interface";

import { MirrorUnassignedEformsignDocUsecase } from "./mirror-unassigned-eformsign-doc.usecase";

const BACKFILL_PAGE_SIZE = 100;
// Slack for very small lists, where doubling the page count barely adds anything.
const BACKFILL_MIN_PAGE_BUDGET = 20;

export type EformsignBackfillDocumentType = "01" | "03" | "04";

export interface EformsignDocsBackfillTypeSummary {
    status: "pending" | "completed" | "failed";
    fetched: number;
    created: number;
    updated: number;
    skipped: number;
    /** Already mirrored by an earlier scan in the same run; see `duplicates` below. */
    duplicates: number;
    failed: number;
    pages: number;
    error: string | null;
}

export interface EformsignDocsBackfillSummary {
    fetched: number;
    created: number;
    updated: number;
    skipped: number;
    /**
     * Documents an earlier scan in this run already mirrored. Type "04" is eformsign's
     * document-management inbox, not a rejected-only one, so it overlaps the in-progress
     * and completed scans — writing those rows a second time would achieve nothing.
     */
    duplicates: number;
    failed: number;
    pages: number;
    byDocumentType: Record<
        EformsignBackfillDocumentType,
        EformsignDocsBackfillTypeSummary
    >;
}

export interface EformsignDocsBackfillProgress {
    phase: "started" | "page" | "completed" | "failed";
    documentType?: EformsignBackfillDocumentType;
    skip?: number;
    totalCount?: number;
    summary: EformsignDocsBackfillSummary;
}

export interface BackfillEformsignDocsOptions {
    onProgress?: (progress: EformsignDocsBackfillProgress) => void;
    shouldContinue?: () => boolean;
}

export class BackfillEformsignDocsError extends Error {
    readonly cause: unknown;
    readonly summary: EformsignDocsBackfillSummary;

    constructor(
        message: string,
        summary: EformsignDocsBackfillSummary,
        cause?: unknown,
    ) {
        super(message);
        this.name = BackfillEformsignDocsError.name;
        this.cause = cause;
        this.summary = cloneSummary(summary);
    }
}

class EformsignBackfillLeaseLostError extends BackfillEformsignDocsError {}

function createTypeSummary(): EformsignDocsBackfillTypeSummary {
    return {
        status: "pending",
        fetched: 0,
        created: 0,
        updated: 0,
        skipped: 0,
        duplicates: 0,
        failed: 0,
        pages: 0,
        error: null,
    };
}

function cloneSummary(summary: EformsignDocsBackfillSummary): EformsignDocsBackfillSummary {
    return {
        ...summary,
        byDocumentType: {
            "01": { ...summary.byDocumentType["01"] },
            "03": { ...summary.byDocumentType["03"] },
            "04": { ...summary.byDocumentType["04"] },
        },
    };
}

@Injectable()
export class BackfillEformsignDocsUsecase {
    private readonly logger = new Logger(BackfillEformsignDocsUsecase.name);

    constructor(
        @Inject(EFORMSIGN_CLIENT_REPOSITORY)
        private readonly eformsignClient: IEformsignClientRepository,
        @Inject(EFORMSIGN_DOC_REPOSITORY)
        private readonly eformsignDocRepository: IEformsignDocRepository,
        private readonly mirrorEformsignDocUsecase: MirrorUnassignedEformsignDocUsecase,
    ) {}

    async execute(
        options: BackfillEformsignDocsOptions = {},
    ): Promise<EformsignDocsBackfillSummary> {
        const summary: EformsignDocsBackfillSummary = {
            fetched: 0,
            created: 0,
            updated: 0,
            skipped: 0,
            duplicates: 0,
            failed: 0,
            pages: 0,
            byDocumentType: {
                "01": createTypeSummary(),
                "03": createTypeSummary(),
                "04": createTypeSummary(),
            },
        };
        options.onProgress?.({
            phase: "started",
            summary: cloneSummary(summary),
        });

        try {
            this.assertCanContinue(options, summary);
            const tokenResponse = await this.eformsignClient.getAccessToken(Date.now());
            let accessToken = tokenResponse.oauth_token.access_token;

            const scans: Array<{
                documentType: EformsignBackfillDocumentType;
                fetchPage: (limit: number, skip: number) => Promise<EformsignApiListResponse>;
            }> = [
                {
                    documentType: "01",
                    fetchPage: (limit, skip) =>
                        this.eformsignClient.getInProgressDocumentsPage(
                            accessToken,
                            limit,
                            skip,
                        ),
                },
                {
                    documentType: "03",
                    fetchPage: (limit, skip) =>
                        this.eformsignClient.getCompletedDocumentsPage(
                            accessToken,
                            limit,
                            skip,
                        ),
                },
                {
                    documentType: "04",
                    fetchPage: (limit, skip) =>
                        this.eformsignClient.getRejectedDocumentsPage(
                            accessToken,
                            limit,
                            skip,
                        ),
                },
            ];
            const fetchPageWithAuthRecovery = async (
                fetchPage: (limit: number, skip: number) => Promise<EformsignApiListResponse>,
                limit: number,
                skip: number,
            ): Promise<EformsignApiListResponse> => {
                try {
                    return await fetchPage(limit, skip);
                } catch (error) {
                    if (!this.isAuthenticationError(error)) {
                        throw error;
                    }

                    const reissuedTokenResponse = await this.eformsignClient.getAccessToken(
                        Date.now(),
                    );
                    accessToken = reissuedTokenResponse.oauth_token.access_token;
                    return fetchPage(limit, skip);
                }
            };
            // Run-level, not per-scan: the per-scan set drives pagination and the coverage
            // check and has to stay scoped to its own type's total_rows. This one only
            // stops us writing the same document twice because two inboxes both list it.
            // It records what each copy was worth, not just that we saw it — a document
            // that completes mid-sweep appears again in a later inbox carrying newer
            // state, and skipping on identity alone would throw that away.
            const mirroredUpdatedDates = new Map<string, number>();
            const scanFailures: BackfillEformsignDocsError[] = [];
            for (const scan of scans) {
                const typeSummary = summary.byDocumentType[scan.documentType];
                try {
                    await this.scanDocumentType({
                        ...scan,
                        fetchPage: (limit, skip) =>
                            fetchPageWithAuthRecovery(scan.fetchPage, limit, skip),
                        options,
                        summary,
                        typeSummary,
                        mirroredUpdatedDates,
                    });
                    // Swallowing a single document's write error to finish the sweep is
                    // deliberate, but the run still left the mirror incomplete and nothing
                    // reconciles it yet. Calling that "completed" is the same silent
                    // success the coverage check exists to prevent.
                    if (typeSummary.failed > 0) {
                        throw new BackfillEformsignDocsError(
                            `Eformsign document backfill could not mirror every document`
                            + ` type=${scan.documentType} failed=${typeSummary.failed};`
                            + " rerun the backfill",
                            summary,
                        );
                    }
                    typeSummary.status = "completed";
                } catch (error) {
                    if (error instanceof EformsignBackfillLeaseLostError) {
                        throw error;
                    }
                    const scanError = error instanceof BackfillEformsignDocsError
                        ? error
                        : new BackfillEformsignDocsError(
                            `Eformsign document backfill failed for type=${scan.documentType}`,
                            summary,
                            error,
                        );
                    typeSummary.status = "failed";
                    typeSummary.error = scanError.message;
                    scanFailures.push(scanError);
                }
            }

            if (scanFailures.length > 0) {
                const failedTypes = scans
                    .filter(({ documentType }) =>
                        summary.byDocumentType[documentType].status === "failed")
                    .map(({ documentType }) => documentType)
                    .join(",");
                throw new BackfillEformsignDocsError(
                    `Eformsign document backfill failed for types=${failedTypes}`,
                    summary,
                    scanFailures,
                );
            }

            options.onProgress?.({
                phase: "completed",
                summary: cloneSummary(summary),
            });
            return cloneSummary(summary);
        } catch (error) {
            const backfillError = error instanceof BackfillEformsignDocsError
                ? error
                : new BackfillEformsignDocsError(
                    "Eformsign document backfill failed",
                    summary,
                    error,
                );
            options.onProgress?.({
                phase: "failed",
                summary: { ...backfillError.summary },
            });
            throw backfillError;
        }
    }

    /**
     * Pages needed to cover the total we were first quoted, doubled so a sweep is not
     * failed by ordinary growth, plus a floor so tiny lists still get some slack.
     */
    private maxPagesFor(initialTotalRows: number): number {
        const pagesForInitialTotal = Math.ceil(
            initialTotalRows / BACKFILL_PAGE_SIZE,
        );
        return Math.max(BACKFILL_MIN_PAGE_BUDGET, pagesForInitialTotal * 2);
    }

    private async scanDocumentType(params: {
        documentType: EformsignBackfillDocumentType;
        fetchPage: (limit: number, skip: number) => Promise<EformsignApiListResponse>;
        options: BackfillEformsignDocsOptions;
        summary: EformsignDocsBackfillSummary;
        typeSummary: EformsignDocsBackfillTypeSummary;
        mirroredUpdatedDates: Map<string, number>;
    }): Promise<void> {
        let skip = 0;
        let initialTotalRows: number | undefined;
        let pagesFetched = 0;
        const seenDocumentIds = new Set<string>();

        while (true) {
            // A list that keeps growing faster than we page through it would otherwise
            // loop forever, and this runs as an operator job. Bound it against the total
            // we were first told, with room for documents arriving mid-sweep.
            if (
                initialTotalRows !== undefined
                && pagesFetched >= this.maxPagesFor(initialTotalRows)
            ) {
                throw new BackfillEformsignDocsError(
                    `Eformsign pagination exceeded its page budget type=${params.documentType}`
                    + ` pages=${pagesFetched} initialTotal=${initialTotalRows};`
                    + " the list is growing faster than the sweep — retry when it settles",
                    params.summary,
                );
            }
            this.assertCanContinue(params.options, params.summary);

            let page: EformsignApiListResponse;
            try {
                page = await params.fetchPage(BACKFILL_PAGE_SIZE, skip);
            } catch (error) {
                throw new BackfillEformsignDocsError(
                    `Failed to fetch eformsign document page type=${params.documentType} skip=${skip}`,
                    params.summary,
                    error,
                );
            }

            this.assertValidTotalRows(page.total_rows, params.documentType, skip, params.summary);
            pagesFetched += 1;
            if (initialTotalRows === undefined) {
                initialTotalRows = page.total_rows;
            } else if (page.total_rows < initialTotalRows) {
                throw new BackfillEformsignDocsError(
                    `Eformsign total_rows decreased during pagination type=${params.documentType} skip=${skip} initialTotal=${initialTotalRows} currentTotal=${page.total_rows}`,
                    params.summary,
                );
            }
            params.summary.pages += 1;
            params.summary.fetched += page.documents.length;
            params.typeSummary.pages += 1;
            params.typeSummary.fetched += page.documents.length;

            if (page.documents.length === 0) {
                if (skip < page.total_rows) {
                    throw new BackfillEformsignDocsError(
                        `Eformsign pagination stopped making progress type=${params.documentType} skip=${skip} total=${page.total_rows}`,
                        params.summary,
                    );
                }
                this.assertCompleteCoverage(
                    params.documentType,
                    seenDocumentIds.size,
                    page.total_rows,
                    params.summary,
                );
                // The lease is only ever checked before a write, so losing it during the
                // last one would still report success. This cannot stop the overlap — that
                // needs a fence carried into the write itself — but it stops us claiming a
                // sweep we no longer owned.
                this.assertCanContinue(params.options, params.summary);
                this.emitPageProgress(params, skip, page.total_rows);
                return;
            }

            const newDocuments = page.documents.filter(
                (document) => !seenDocumentIds.has(document.id),
            );
            if (newDocuments.length === 0) {
                throw new BackfillEformsignDocsError(
                    `Eformsign pagination repeated a page without new document ids type=${params.documentType} skip=${skip}`,
                    params.summary,
                );
            }

            for (const document of newDocuments) {
                seenDocumentIds.add(document.id);
                this.assertCanContinue(params.options, params.summary);
                const mirroredAt = params.mirroredUpdatedDates.get(document.id);
                if (mirroredAt !== undefined && document.updated_date <= mirroredAt) {
                    params.summary.duplicates += 1;
                    params.typeSummary.duplicates += 1;
                    continue;
                }

                params.mirroredUpdatedDates.set(document.id, document.updated_date);
                await this.persistDocument(document, params.summary, params.typeSummary);
            }

            const nextSkip = skip + page.documents.length;
            if (nextSkip <= skip) {
                throw new BackfillEformsignDocsError(
                    `Eformsign pagination offset did not advance type=${params.documentType} skip=${skip}`,
                    params.summary,
                );
            }

            skip = nextSkip;
            this.emitPageProgress(params, skip, page.total_rows);
            if (skip >= page.total_rows) {
                this.assertCompleteCoverage(
                    params.documentType,
                    seenDocumentIds.size,
                    page.total_rows,
                    params.summary,
                );
                this.assertCanContinue(params.options, params.summary);
                return;
            }
        }
    }

    private assertCompleteCoverage(
        documentType: EformsignBackfillDocumentType,
        uniqueSeen: number,
        currentTotal: number,
        summary: EformsignDocsBackfillSummary,
    ): void {
        const missing = currentTotal - uniqueSeen;
        if (missing <= 0) {
            return;
        }

        throw new BackfillEformsignDocsError(
            `Eformsign document coverage incomplete type=${documentType} uniqueSeen=${uniqueSeen} currentTotal=${currentTotal} missing=${missing}; documents may have moved between folders during pagination, so rerun the backfill`,
            summary,
        );
    }

    private async persistDocument(
        document: EformsignApiDocumentResponse,
        summary: EformsignDocsBackfillSummary,
        typeSummary: EformsignDocsBackfillTypeSummary,
    ): Promise<void> {
        try {
            const existing = await this.eformsignDocRepository.findByDocumentIdUnscoped(
                document.id,
            );
            await this.mirrorEformsignDocUsecase.mirrorRemoteDocument(document, {
                allowAssignedUpdate: true,
            });
            if (existing) {
                summary.updated += 1;
                typeSummary.updated += 1;
            } else {
                summary.created += 1;
                typeSummary.created += 1;
            }
        } catch (error) {
            if (error instanceof EformsignDocStaleUpdateError) {
                summary.skipped += 1;
                typeSummary.skipped += 1;
                return;
            }

            summary.failed += 1;
            typeSummary.failed += 1;
            // The status fields are here because every mirroring failure so far has been a
            // value the vendor sent that our mapping did not expect. Without them the log
            // says a document could not be mirrored and nothing about why, which costs a
            // second full sweep to find out.
            const status = document.current_status;
            this.logger.warn(
                `Failed to mirror eformsign document ${document.id}: ${
                    error instanceof Error ? error.message : String(error)
                } (status_type=${status?.status_type}`
                + ` expired_date=${JSON.stringify(status?.expired_date)}`
                + ` expired=${JSON.stringify(status?._expired)})`,
            );
        }
    }

    private assertCanContinue(
        options: BackfillEformsignDocsOptions,
        summary: EformsignDocsBackfillSummary,
    ): void {
        if (options.shouldContinue?.() === false) {
            throw new EformsignBackfillLeaseLostError(
                "Eformsign document backfill lost its execution lease",
                summary,
            );
        }
    }

    private assertValidTotalRows(
        totalRows: number,
        documentType: EformsignBackfillDocumentType,
        skip: number,
        summary: EformsignDocsBackfillSummary,
    ): void {
        if (Number.isInteger(totalRows) && totalRows >= 0) {
            return;
        }

        throw new BackfillEformsignDocsError(
            `Invalid eformsign total_rows type=${documentType} skip=${skip}`,
            summary,
        );
    }

    private isAuthenticationError(error: unknown): boolean {
        if (typeof error !== "object" || error === null || !("status" in error)) {
            return false;
        }

        return error.status === 401;
    }

    private emitPageProgress(
        params: {
            documentType: EformsignBackfillDocumentType;
            options: BackfillEformsignDocsOptions;
            summary: EformsignDocsBackfillSummary;
        },
        skip: number,
        totalCount: number,
    ): void {
        params.options.onProgress?.({
            phase: "page",
            documentType: params.documentType,
            skip,
            totalCount,
            summary: cloneSummary(params.summary),
        });
    }
}
