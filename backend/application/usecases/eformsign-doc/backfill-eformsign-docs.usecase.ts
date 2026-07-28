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

export interface EformsignDocsBackfillSummary {
    fetched: number;
    created: number;
    updated: number;
    skipped: number;
    failed: number;
    pages: number;
}

export interface EformsignDocsBackfillProgress {
    phase: "started" | "page" | "completed" | "failed";
    documentType?: "01" | "03";
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
        this.summary = { ...summary };
    }
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
        };
        options.onProgress?.({
            phase: "started",
            summary: { ...summary },
        });

        try {
            this.assertCanContinue(options, summary);
            const tokenResponse = await this.eformsignClient.getAccessToken(Date.now());
            const accessToken = tokenResponse.oauth_token.access_token;

            await this.scanDocumentType({
                documentType: "01",
                fetchPage: (limit, skip) =>
                    this.eformsignClient.getInProgressDocumentsPage(
                        accessToken,
                        limit,
                        skip,
                    ),
                options,
                summary,
            });
            await this.scanDocumentType({
                documentType: "03",
                fetchPage: (limit, skip) =>
                    this.eformsignClient.getCompletedDocumentsPage(
                        accessToken,
                        limit,
                        skip,
                    ),
                options,
                summary,
            });

            options.onProgress?.({
                phase: "completed",
                summary: { ...summary },
            });
            return { ...summary };
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
        documentType: "01" | "03";
        fetchPage: (limit: number, skip: number) => Promise<EformsignApiListResponse>;
        options: BackfillEformsignDocsOptions;
        summary: EformsignDocsBackfillSummary;
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

            this.assertValidTotalCount(page.total_count, params.documentType, skip, params.summary);
            params.summary.pages += 1;
            params.summary.fetched += page.documents.length;

            if (page.documents.length === 0) {
                if (skip < page.total_count) {
                    throw new BackfillEformsignDocsError(
                        `Eformsign pagination stopped making progress type=${params.documentType} skip=${skip} total=${page.total_count}`,
                        params.summary,
                    );
                }
                this.emitPageProgress(params, skip, page.total_count);
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
                await this.persistDocument(document, params.summary);
            }

            const nextSkip = skip + page.documents.length;
            if (nextSkip <= skip) {
                throw new BackfillEformsignDocsError(
                    `Eformsign pagination offset did not advance type=${params.documentType} skip=${skip}`,
                    params.summary,
                );
            }

            skip = nextSkip;
            this.emitPageProgress(params, skip, page.total_count);
            if (skip >= page.total_count) {
                return;
            }
        }
    }

    private async persistDocument(
        document: EformsignApiDocumentResponse,
        summary: EformsignDocsBackfillSummary,
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
            } else {
                summary.created += 1;
            }
        } catch (error) {
            if (error instanceof EformsignDocStaleUpdateError) {
                summary.skipped += 1;
                return;
            }

            summary.failed += 1;
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
            throw new BackfillEformsignDocsError(
                "Eformsign document backfill lost its execution lease",
                summary,
            );
        }
    }

    private assertValidTotalCount(
        totalCount: number,
        documentType: "01" | "03",
        skip: number,
        summary: EformsignDocsBackfillSummary,
    ): void {
        if (Number.isInteger(totalCount) && totalCount >= 0) {
            return;
        }

        throw new BackfillEformsignDocsError(
            `Invalid eformsign total_count type=${documentType} skip=${skip}`,
            summary,
        );
    }

    private emitPageProgress(
        params: {
            documentType: "01" | "03";
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
            summary: { ...params.summary },
        });
    }
}
