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

export type EformsignBackfillDocumentType = "01" | "03" | "04";

export interface EformsignDocsBackfillTypeSummary {
    status: "pending" | "completed" | "failed";
    fetched: number;
    created: number;
    updated: number;
    skipped: number;
    failed: number;
    pages: number;
    error: string | null;
}

export interface EformsignDocsBackfillSummary {
    fetched: number;
    created: number;
    updated: number;
    skipped: number;
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
            let refreshToken = tokenResponse.oauth_token.refresh_token;

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

                    const refreshedTokenResponse = await this.eformsignClient.refreshAccessToken(
                        Date.now(),
                        refreshToken,
                    );
                    accessToken = refreshedTokenResponse.oauth_token.access_token;
                    refreshToken = refreshedTokenResponse.oauth_token.refresh_token;
                    return fetchPage(limit, skip);
                }
            };
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
                    });
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

    private async scanDocumentType(params: {
        documentType: EformsignBackfillDocumentType;
        fetchPage: (limit: number, skip: number) => Promise<EformsignApiListResponse>;
        options: BackfillEformsignDocsOptions;
        summary: EformsignDocsBackfillSummary;
        typeSummary: EformsignDocsBackfillTypeSummary;
    }): Promise<void> {
        let skip = 0;
        const seenDocumentIds = new Set<string>();

        while (true) {
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
                return;
            }
        }
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
            this.logger.warn(
                `Failed to mirror eformsign document ${document.id}: ${
                    error instanceof Error ? error.message : String(error)
                }`,
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
