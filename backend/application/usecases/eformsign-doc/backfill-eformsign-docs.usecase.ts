import { Inject, Injectable, Logger, Optional } from "@nestjs/common";

import { EformsignDocumentMirrorService } from "application/services/eformsign-document-mirror.service";
import { EformsignService } from "application/services/eformsign.service";
import { sanitizeEformsignErrorMessage } from "application/utils/eformsign-error-message";
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
import {
    isEformsignDocumentAbsentError,
} from "infrastructure/api/eformsign-api.error";

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
    suppressOutboundAutomation?: boolean;
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
        @Optional()
        private readonly documentMirrorService?: EformsignDocumentMirrorService,
        @Optional()
        private readonly eformsignService?: EformsignService,
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
            const refreshAccessToken = async (): Promise<string> => {
                const reissuedTokenResponse =
                    await this.eformsignClient.getAccessToken(Date.now());
                accessToken = reissuedTokenResponse.oauth_token.access_token;
                return accessToken;
            };

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

                    await refreshAccessToken();
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
                        accessToken: () => accessToken,
                        refreshAccessToken,
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

            await this.verifyLocallyActiveDocumentsMissingFromVendorLists(
                mirroredUpdatedDates,
                () => accessToken,
                refreshAccessToken,
                options,
                summary,
            );

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
        accessToken: () => string;
        refreshAccessToken: () => Promise<string>;
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
                await this.assertStableCoverage(
                    params,
                    seenDocumentIds,
                    page.total_rows,
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
                await this.persistDocument(
                    document,
                    params.accessToken,
                    params.refreshAccessToken,
                    params.summary,
                    params.typeSummary,
                    params.options.suppressOutboundAutomation === true,
                );
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
                await this.assertStableCoverage(
                    params,
                    seenDocumentIds,
                    page.total_rows,
                );
                this.assertCanContinue(params.options, params.summary);
                return;
            }
        }
    }

    /**
     * Offset pagination cannot prove a complete snapshot from one pass: deleting an
     * early row and appending another row can preserve total_rows while shifting an
     * unseen document before the next offset. A second read-only pass must observe the
     * exact same ID set before this run may declare coverage.
     */
    private async assertStableCoverage(
        params: {
            documentType: EformsignBackfillDocumentType;
            fetchPage: (limit: number, skip: number) => Promise<EformsignApiListResponse>;
            options: BackfillEformsignDocsOptions;
            summary: EformsignDocsBackfillSummary;
        },
        firstPassIds: Set<string>,
        firstPassTotal: number,
    ): Promise<void> {
        let skip = 0;
        let verificationTotal: number | undefined;
        let pagesFetched = 0;
        const verificationIds = new Set<string>();

        while (true) {
            if (
                verificationTotal !== undefined
                && pagesFetched >= this.maxPagesFor(verificationTotal)
            ) {
                throw new BackfillEformsignDocsError(
                    `Eformsign coverage verification exceeded its page budget`
                    + ` type=${params.documentType} pages=${pagesFetched}`
                    + ` total=${verificationTotal}; retry when the list settles`,
                    params.summary,
                );
            }
            this.assertCanContinue(params.options, params.summary);

            let page: EformsignApiListResponse;
            try {
                page = await params.fetchPage(BACKFILL_PAGE_SIZE, skip);
            } catch (error) {
                throw new BackfillEformsignDocsError(
                    `Failed to verify eformsign document coverage`
                    + ` type=${params.documentType} skip=${skip}`,
                    params.summary,
                    error,
                );
            }

            this.assertValidTotalRows(
                page.total_rows,
                params.documentType,
                skip,
                params.summary,
            );
            pagesFetched += 1;
            if (verificationTotal === undefined) {
                verificationTotal = page.total_rows;
                if (verificationTotal !== firstPassTotal) {
                    throw new BackfillEformsignDocsError(
                        `Eformsign document coverage changed between consecutive scans`
                        + ` type=${params.documentType}`
                        + ` firstTotal=${firstPassTotal}`
                        + ` verificationTotal=${verificationTotal};`
                        + " retry when the list settles",
                        params.summary,
                    );
                }
            } else if (page.total_rows !== verificationTotal) {
                throw new BackfillEformsignDocsError(
                    `Eformsign total_rows changed during coverage verification`
                    + ` type=${params.documentType} skip=${skip}`
                    + ` initialTotal=${verificationTotal}`
                    + ` currentTotal=${page.total_rows};`
                    + " retry when the list settles",
                    params.summary,
                );
            }

            if (page.documents.length === 0) {
                if (skip < page.total_rows) {
                    throw new BackfillEformsignDocsError(
                        `Eformsign coverage verification stopped making progress`
                        + ` type=${params.documentType} skip=${skip}`
                        + ` total=${page.total_rows}`,
                        params.summary,
                    );
                }
                break;
            }

            const newDocuments = page.documents.filter(
                (document) => !verificationIds.has(document.id),
            );
            if (newDocuments.length === 0) {
                throw new BackfillEformsignDocsError(
                    `Eformsign coverage verification repeated a page without new document ids`
                    + ` type=${params.documentType} skip=${skip}`,
                    params.summary,
                );
            }
            for (const document of newDocuments) {
                verificationIds.add(document.id);
            }

            const nextSkip = skip + page.documents.length;
            if (nextSkip <= skip) {
                throw new BackfillEformsignDocsError(
                    `Eformsign coverage verification offset did not advance`
                    + ` type=${params.documentType} skip=${skip}`,
                    params.summary,
                );
            }
            skip = nextSkip;
            if (skip >= page.total_rows) {
                break;
            }
        }

        this.assertCompleteCoverage(
            params.documentType,
            verificationIds.size,
            verificationTotal ?? 0,
            params.summary,
        );
        const missingFromVerification = [...firstPassIds].filter(
            (documentId) => !verificationIds.has(documentId),
        ).length;
        const newInVerification = [...verificationIds].filter(
            (documentId) => !firstPassIds.has(documentId),
        ).length;
        if (missingFromVerification > 0 || newInVerification > 0) {
            throw new BackfillEformsignDocsError(
                `Eformsign document coverage changed between consecutive scans`
                + ` type=${params.documentType}`
                + ` firstCount=${firstPassIds.size}`
                + ` verificationCount=${verificationIds.size}`
                + ` missingFromVerification=${missingFromVerification}`
                + ` newInVerification=${newInVerification};`
                + " retry when the list settles",
                params.summary,
            );
        }
        this.assertCanContinue(params.options, params.summary);
    }

    private assertCompleteCoverage(
        documentType: EformsignBackfillDocumentType,
        uniqueSeen: number,
        currentTotal: number,
        summary: EformsignDocsBackfillSummary,
    ): void {
        const missing = currentTotal - uniqueSeen;
        if (missing === 0) {
            return;
        }
        const extra = Math.max(0, -missing);

        throw new BackfillEformsignDocsError(
            `Eformsign document coverage incomplete`
            + ` type=${documentType}`
            + ` uniqueSeen=${uniqueSeen}`
            + ` currentTotal=${currentTotal}`
            + ` missing=${Math.max(0, missing)}`
            + ` extra=${extra};`
            + " documents may have moved between folders during pagination,"
            + " so rerun the backfill",
            summary,
        );
    }

    private async verifyLocallyActiveDocumentsMissingFromVendorLists(
        seenDocuments: Map<string, number>,
        accessToken: () => string,
        refreshAccessToken: () => Promise<string>,
        options: BackfillEformsignDocsOptions,
        summary: EformsignDocsBackfillSummary,
    ): Promise<void> {
        if (
            !this.documentMirrorService
            || typeof (this.documentMirrorService as unknown as {
                findActiveDocumentIds?: unknown;
            }).findActiveDocumentIds !== "function"
        ) return;

        const seenIds = new Set(seenDocuments.keys());
        const activeIds = await this.documentMirrorService.findActiveDocumentIds();
        const pendingPermanentPurge = new Set(
            await this.documentMirrorService.findPermanentPurgeRequestedDocumentIds(),
        );

        for (const documentId of new Set([...activeIds, ...pendingPermanentPurge])) {
            const hasPermanentPurgeIntent = pendingPermanentPurge.has(documentId);
            if (seenIds.has(documentId) && !hasPermanentPurgeIntent) continue;
            this.assertCanContinue(options, summary);
            try {
                const verify = async (token: string) => this.eformsignClient.getDocument(token, documentId);
                let detail: EformsignApiDocumentResponse;
                try {
                    detail = await verify(accessToken());
                } catch (error) {
                    if (!this.isAuthenticationError(error)) throw error;
                    detail = await verify(await refreshAccessToken());
                }
                // syncDocumentWithToken tolerates a stale list projection while still
                // converging detail and files; do not reintroduce that stale-write gap.
                await this.documentMirrorService.syncDocumentWithToken(accessToken(), documentId, {
                    force: true,
                    expectedUpdatedDate: detail.updated_date,
                    ...(options.suppressOutboundAutomation ? { suppressOutboundAutomation: true } : {}),
                });
                if (hasPermanentPurgeIntent) {
                    await this.retryConfirmedPresentPermanentPurge(
                        documentId,
                        accessToken,
                        refreshAccessToken,
                    );
                }
            } catch (error) {
                if (!isEformsignDocumentAbsentError(error)) {
                    throw new BackfillEformsignDocsError(
                        `Failed to verify locally active eformsign document ${documentId}`,
                        summary,
                        error,
                    );
                }
                if (hasPermanentPurgeIntent) {
                    await this.documentMirrorService.purgeDocuments([documentId]);
                } else {
                    await this.documentMirrorService.markDocumentsDeleted([documentId]);
                }
            }
        }
    }

    /**
     * A durable intent can survive an ambiguous original DELETE timeout. Once a
     * later reconciliation has confirmed the document still exists, retry the
     * vendor deletion instead of indefinitely refreshing a locally hidden row.
     */
    private async retryConfirmedPresentPermanentPurge(
        documentId: string,
        accessToken: () => string,
        refreshAccessToken: () => Promise<string>,
    ): Promise<void> {
        const documentMirrorService = this.documentMirrorService;
        const eformsignService = this.eformsignService;
        if (!documentMirrorService || !eformsignService) {
            throw new Error("Permanent eformsign purge retry dependencies are unavailable");
        }

        // Allocate a new generation immediately before the retry. A definitive
        // vendor rejection may clear only this retry's intent, never a newer one.
        const requests = await documentMirrorService.requestPermanentPurge([documentId]);
        const request = requests.find((candidate) => candidate.documentId === documentId);
        if (!request) {
            throw new Error(`Could not persist permanent eformsign purge retry for ${documentId}`);
        }

        const deleteWithToken = (token: string) =>
            eformsignService.deleteDocuments(token, [documentId], true);
        let result: unknown;
        try {
            try {
                result = await deleteWithToken(accessToken());
            } catch (error) {
                if (!this.isAuthenticationError(error)) {
                    throw error;
                }
                result = await deleteWithToken(await refreshAccessToken());
            }
        } catch (error) {
            if (isEformsignDocumentAbsentError(error)) {
                await documentMirrorService.purgeDocuments([documentId]);
                return;
            }
            if (isDefinitivePermanentDeleteHttpFailure(error)) {
                await documentMirrorService.clearPermanentPurgeRequest([request]);
            }
            throw error;
        }

        const successfulIds = successfulPermanentDeleteDocumentIds(result);
        if (successfulIds.includes(documentId)) {
            await documentMirrorService.purgeDocuments([documentId]);
            return;
        }

        if (failedPermanentDeleteDocumentIds(result, [documentId]).includes(documentId)) {
            await documentMirrorService.clearPermanentPurgeRequest([request]);
        }
        // Unknown and already-deleted outcomes deliberately retain the new durable
        // intent. The next reconciliation verifies vendor absence before purging.
    }

    private async persistDocument(
        document: EformsignApiDocumentResponse,
        accessToken: () => string,
        refreshAccessToken: () => Promise<string>,
        summary: EformsignDocsBackfillSummary,
        typeSummary: EformsignDocsBackfillTypeSummary,
        suppressOutboundAutomation: boolean,
    ): Promise<void> {
        try {
            const existing = await this.eformsignDocRepository.findByDocumentIdUnscoped(
                document.id,
            );
            let projectionWasStale = false;
            try {
                await this.mirrorEformsignDocUsecase.mirrorRemoteDocument(document, {
                    allowAssignedUpdate: true,
                });
            } catch (error) {
                if (!(error instanceof EformsignDocStaleUpdateError)) {
                    throw error;
                }

                // The list projection is already newer, but its full detail and mirrored
                // PDFs may still be incomplete. Keep the stale projection from blocking
                // that independent convergence work below.
                projectionWasStale = true;
            }
            if (this.documentMirrorService) {
                const sync = (token: string) =>
                    this.documentMirrorService!.syncDocumentWithToken(
                        token,
                        document.id,
                        {
                            expectedUpdatedDate: document.updated_date,
                            ...(suppressOutboundAutomation
                                ? { suppressOutboundAutomation: true }
                                : {}),
                        },
                    );
                try {
                    await sync(accessToken());
                } catch (error) {
                    if (!this.isAuthenticationError(error)) {
                        throw error;
                    }
                    await sync(await refreshAccessToken());
                }
            }
            if (projectionWasStale) {
                summary.skipped += 1;
                typeSummary.skipped += 1;
                return;
            }
            if (existing) {
                summary.updated += 1;
                typeSummary.updated += 1;
            } else {
                summary.created += 1;
                typeSummary.created += 1;
            }
        } catch (error) {
            summary.failed += 1;
            typeSummary.failed += 1;
            // The status fields are here because every mirroring failure so far has been a
            // value the vendor sent that our mapping did not expect. Without them the log
            // says a document could not be mirrored and nothing about why, which costs a
            // second full sweep to find out.
            const status = document.current_status;
            this.logger.warn(
                `Failed to mirror eformsign document ${document.id}: ${sanitizeEformsignErrorMessage(error)}`
                + ` (status_type=${status?.status_type}`
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

function successfulPermanentDeleteDocumentIds(result: unknown): string[] {
    if (typeof result !== "object" || result === null) {
        return [];
    }
    const resultBody = (result as Record<string, unknown>)["result"];
    if (typeof resultBody !== "object" || resultBody === null) {
        return [];
    }
    const successResult = (resultBody as Record<string, unknown>)["success_result"];
    if (!Array.isArray(successResult)) {
        return [];
    }
    return successResult.filter(
        (documentId): documentId is string =>
            typeof documentId === "string" && documentId.trim().length > 0,
    );
}

function failedPermanentDeleteDocumentIds(
    result: unknown,
    requestedDocumentIds: string[],
): string[] {
    if (typeof result !== "object" || result === null) return [];
    const resultBody = (result as Record<string, unknown>)["result"];
    if (typeof resultBody !== "object" || resultBody === null) return [];
    const failures = (resultBody as Record<string, unknown>)["fail_result"];
    if (!Array.isArray(failures)) return [];

    const requested = new Set(requestedDocumentIds);
    return [...new Set(failures.flatMap((failure) => {
        if (typeof failure !== "object" || failure === null) return [];
        const { document_id: documentId, code } = failure as Record<string, unknown>;
        const normalizedId = typeof documentId === "string" ? documentId.trim() : "";
        return classifyPermanentDeleteFailureCode(code) === "clear"
            && normalizedId
            && requested.has(normalizedId)
            ? [normalizedId]
            : [];
    }))];
}

function isDefinitivePermanentDeleteHttpFailure(error: unknown): boolean {
    return typeof error === "object"
        && error !== null
        && "status" in error
        && typeof error.status === "number"
        && error.status >= 400
        && error.status < 500
        && error.status !== 408
        && error.status !== 429;
}

/** Vendor application codes, not HTTP statuses. Unknown outcomes retain intent. */
function classifyPermanentDeleteFailureCode(code: unknown): "clear" | "retain" {
    const normalized = typeof code === "string"
        ? code.trim()
        : typeof code === "number" && Number.isInteger(code)
            ? String(code)
            : "";

    switch (normalized) {
        case "4000164": // token lacks authority to delete this document
            return "clear";
        case "4000031": // already deleted; verify vendor absence before purge
        default:
            return "retain";
    }
}
