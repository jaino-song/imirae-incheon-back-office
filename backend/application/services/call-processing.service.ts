import { BadRequestException, Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import { PrismaService } from "infrastructure/database/prisma.service";
import { resolveCallExtractionModel } from "infrastructure/api/gemini-call-extraction.adapter";
import {
    CALL_EXTRACTION_PORT,
    CallExtractionPort,
    CallExtractionResult,
    ExtractionProposal,
    TranscriptTurn,
} from "domain/ports/call-extraction.port";
import {
    CALL_EXTRACTION_PROMPT_VERSION,
    PROPOSAL_FIELDS,
} from "application/services/call-extraction.prompt";
import {
    CALL_REFINEMENT_PORT,
    CallRefinementPort,
    CallRefinementResult,
} from "domain/ports/call-refinement.port";
import { CALL_REFINEMENT_PROMPT_VERSION } from "application/services/call-refinement.prompt";
import { CALL_VOCABULARY } from "domain/constants/call-vocabulary";
import { assertValidPhone, extractPhoneCandidates, INVALID_PHONE_MESSAGE, normalizePhone } from "application/utils/normalize-phone";

const BOOLEAN_FIELDS = new Set(["careCenter", "voucherClient", "breastPump"]);
const NUMBER_FIELDS = new Set(["duration"]);
const NON_NULLABLE_FIELDS = new Set(["name", "voucherClient", "breastPump"]);
const ALLOWED_FIELDS = new Set<string>(PROPOSAL_FIELDS);
export const CALL_PROCESSING_CLAIM_LEASE_MS = 10 * 60 * 1000;

export type CallProcessingResult =
    | "processed"
    | "already_processed"
    | "in_progress"
    | "failed"
    | "skipped";

class CallProcessingClaimLostError extends Error {
    constructor() {
        super("call processing claim is no longer owned");
        this.name = "CallProcessingClaimLostError";
    }
}

@Injectable()
export class CallProcessingService {
    private readonly logger = new Logger(CallProcessingService.name);

    constructor(
        private readonly prismaService: PrismaService,
        @Inject(CALL_EXTRACTION_PORT)
        private readonly extractionPort: CallExtractionPort,
        @Inject(CALL_REFINEMENT_PORT)
        private readonly refinementPort: CallRefinementPort,
        private readonly configService: ConfigService,
    ) {}

    async processCallRecord(callRecordId: string): Promise<CallProcessingResult> {
        const record = await this.prismaService.call_record.findUnique({
            where: { id: callRecordId },
        });
        if (!record) {
            this.logger.warn(`call_record ${callRecordId} not found; skipping`);
            return "skipped";
        }

        if (record.processingStatus !== "RECEIVED" && record.processingStatus !== "FAILED") {
            // PROCESSING is an active claim owned by another invocation.  EXTRACTED is
            // terminal.  Expired PROCESSING claims are reclaimed by the retry scheduler,
            // so a direct invocation must not bypass that lease check.
            return record.processingStatus === "PROCESSING" ? "in_progress" : "already_processed";
        }

        // processingStatus is the in-progress marker, processingClaimedAt is the lease
        // token, and extractionRetryCount is the generation fence.  The conditional update
        // is the authoritative ownership decision: a read followed by an unconditional
        // update would allow two providers to extract and publish for the same recording.
        const claimGeneration = record.extractionRetryCount;
        const claimAt = new Date(Date.now());
        // Every call_record write below also pins branchId. It is redundant for
        // correctness (id is unique) but load-bearing for tenancy: the ingest
        // guard now establishes the token's branch on the HTTP store, so this
        // pipeline runs inside a branch-scoped context when invoked inline from
        // the webhook. Under TENANT_ISOLATION_MODE=enforce the isolation
        // extension rejects an unpinned write to a tenant model, which would
        // abort the inline pipeline at this first claim.
        const claimed = await this.prismaService.call_record.updateMany({
            where: {
                id: callRecordId,
                branchId: record.branchId,
                processingStatus: record.processingStatus,
                extractionRetryCount: claimGeneration,
            },
            data: {
                processingStatus: "PROCESSING",
                processingClaimedAt: claimAt,
                failureReason: null,
            },
        });
        if (claimed.count !== 1) {
            return this.observeCurrentState(callRecordId);
        }

        // Refine v2 records (transcriptRaw present) before extraction; v1/legacy
        // records (no transcriptRaw) skip refine and extraction reads
        // record.transcript directly, as before this stage existed. Always
        // refine from transcriptRaw — never from the (possibly already
        // refined) record.transcript — so a retried record re-refines
        // cleanly instead of compounding corrections across attempts.
        // transcriptRaw and sttMeta are never mutated by this stage.
        let transcriptForExtraction = record.transcript as unknown as TranscriptTurn[];
        if (record.transcriptRaw) {
            const rawSegments = record.transcriptRaw as unknown as TranscriptTurn[];
            const sttMeta = record.sttMeta as unknown as { diarized?: unknown } | null;
            // diarized is a caller-supplied flag (n8n computes it), and the
            // "never guess speakers" guarantee rests on it — so cross-check it
            // against the transcript itself: a payload claiming diarization
            // but carrying fewer than two distinct speaker labels gets the
            // neutral-speaker treatment instead of invented role attribution.
            const diarized =
                sttMeta?.diarized === true &&
                new Set(rawSegments.map((segment) => segment.speaker)).size >= 2;

            let refinement: CallRefinementResult;
            try {
                refinement = await this.refinementPort.refine({
                    segments: rawSegments,
                    diarized,
                    fileName: record.fileName,
                });
            } catch (error) {
                this.logger.error(`Refinement failed for ${callRecordId}: ${error}`);
                return this.markClaimFailed(
                    callRecordId,
                    record.branchId,
                    claimGeneration,
                    claimAt,
                    `refine: ${String(error).slice(0, 950)}`,
                );
            }

            // Same fence as the finalize write below: id + processingStatus +
            // extractionRetryCount (generation) + processingClaimedAt. A miss
            // means the retry cron reclaimed this record while refine was in
            // flight — stop here and report the current state; never extract
            // on a claim we no longer own.
            const persisted = await this.prismaService.call_record.updateMany({
                where: {
                    id: callRecordId,
                    branchId: record.branchId,
                    processingStatus: "PROCESSING",
                    extractionRetryCount: claimGeneration,
                    processingClaimedAt: claimAt,
                },
                data: {
                    transcript: refinement.transcript as unknown as Prisma.InputJsonValue,
                },
            });
            if (persisted.count !== 1) {
                return this.observeCurrentState(callRecordId);
            }

            transcriptForExtraction = refinement.transcript;
        }

        let extraction: CallExtractionResult;
        try {
            extraction = await this.extractionPort.extract({
                transcript: transcriptForExtraction,
                summary: record.summary as Record<string, unknown> | null,
                fileName: record.fileName,
            });
        } catch (error) {
            this.logger.error(`Extraction failed for ${callRecordId}: ${error}`);
            return this.markClaimFailed(
                callRecordId,
                record.branchId,
                claimGeneration,
                claimAt,
                String(error).slice(0, 1_000),
            );
        }

        let callerPhone: string | null;
        try {
            callerPhone = this.resolveCallerPhone(extraction, record.fileName);
        } catch (error) {
            this.logger.warn(`Extraction result normalization failed for ${callRecordId}: ${error}`);
            return this.markClaimFailed(
                callRecordId,
                record.branchId,
                claimGeneration,
                claimAt,
                `extraction normalization: ${String(error).slice(0, 950)}`,
            );
        }
        let proposals: ExtractionProposal[];
        try {
            proposals = this.sanitizeProposals(extraction.proposals);
        } catch (error) {
            this.logger.warn(`Extraction validation failed for ${callRecordId}: ${error}`);
            return this.markClaimFailed(
                callRecordId,
                record.branchId,
                claimGeneration,
                claimAt,
                `extraction validation: ${String(error).slice(0, 950)}`,
            );
        }

        try {
            const matchedClientId = await this.matchClient(record.branchId, callerPhone);
            await this.prismaService.$transaction(async (tx) => {
                const finalized = await tx.call_record.updateMany({
                    where: {
                        id: callRecordId,
                        branchId: record.branchId,
                        processingStatus: "PROCESSING",
                        extractionRetryCount: claimGeneration,
                        processingClaimedAt: claimAt,
                    },
                    data: {
                        category: extraction.category,
                        callerName: extraction.callerName ?? null,
                        callerPhone,
                        matchedClientId,
                        processingStatus: "EXTRACTED",
                        processingClaimedAt: null,
                        failureReason: null,
                        summary: extraction.summary as unknown as Prisma.InputJsonValue,
                    },
                });

                if (finalized.count !== 1) {
                    throw new CallProcessingClaimLostError();
                }

                if (extraction.category === "NEW_CONSULTATION" || extraction.category === "CLIENT_SERVICE") {
                    // callRecordId is unique.  skipDuplicates makes the expected loser of
                    // a draft race reuse the durable winner instead of aborting the whole
                    // transaction and incorrectly marking the recording FAILED.
                    await tx.client_draft.createMany({
                        data: {
                            callRecordId,
                            branchId: record.branchId,
                            type: extraction.category === "NEW_CONSULTATION" ? "NEW_CLIENT" : "CLIENT_UPDATE",
                            clientId: matchedClientId,
                            proposals: proposals as unknown as Prisma.InputJsonValue,
                            requestSummary: extraction.requestSummary,
                            extractionMeta: {
                                model: resolveCallExtractionModel(this.configService),
                                promptVersion: CALL_EXTRACTION_PROMPT_VERSION,
                                // Refine provenance (v2 records only): the model is the
                                // same resolveCallExtractionModel value; what can drift
                                // independently is the refine prompt and the correction
                                // dictionary the refine pass actually read at runtime —
                                // sttMeta.vocabularyVersion only records what n8n fed
                                // the recognizer, which can lag this constant.
                                ...(record.transcriptRaw
                                    ? {
                                          refinePromptVersion: CALL_REFINEMENT_PROMPT_VERSION,
                                          vocabularyVersion: CALL_VOCABULARY.version,
                                      }
                                    : {}),
                            } as unknown as Prisma.InputJsonValue,
                        },
                        skipDuplicates: true,
                    });
                }
            });
            return "processed";
        } catch (error) {
            if (error instanceof CallProcessingClaimLostError) {
                return this.observeCurrentState(callRecordId);
            }
            this.logger.error(`Persistence failed for ${callRecordId}: ${error}`);
            return this.markClaimFailed(
                callRecordId,
                record.branchId,
                claimGeneration,
                claimAt,
                `persistence: ${String(error).slice(0, 950)}`,
            );
        }
    }

    private async observeCurrentState(callRecordId: string): Promise<CallProcessingResult> {
        const current = await this.prismaService.call_record.findUnique({
            where: { id: callRecordId },
            select: { processingStatus: true },
        });
        if (current?.processingStatus === "EXTRACTED") return "already_processed";
        if (current?.processingStatus === "FAILED") return "failed";
        return "in_progress";
    }

    private async markClaimFailed(
        callRecordId: string,
        branchId: string,
        claimGeneration: number,
        claimAt: Date,
        failureReason: string,
    ): Promise<CallProcessingResult> {
        try {
            const failed = await this.prismaService.call_record.updateMany({
                where: {
                    id: callRecordId,
                    branchId,
                    processingStatus: "PROCESSING",
                    extractionRetryCount: claimGeneration,
                    processingClaimedAt: claimAt,
                },
                data: {
                    processingStatus: "FAILED",
                    processingClaimedAt: null,
                    failureReason,
                },
            });
            if (failed.count === 1) return "failed";
        } catch (error) {
            // Do not fall back to an unconditional write.  A database failure can leave
            // PROCESSING in place, but an old owner must never overwrite a newer owner.
            this.logger.error(`Failed to persist processing failure for ${callRecordId}: ${error}`);
        }
        return this.observeCurrentState(callRecordId);
    }

    /** transcript-spoken numbers win over filename-parsed ones */
    private resolveCallerPhone(extraction: CallExtractionResult, fileName: string): string | null {
        for (const candidate of extraction.callerPhoneCandidates) {
            // A model-supplied phone is an identity write, not a best-effort
            // search hint. Reject malformed present values instead of silently
            // dropping them and persisting a misleading null callerPhone.
            const normalized = assertValidPhone(candidate);
            if (normalized !== null) return normalized;
        }
        return extractPhoneCandidates(fileName)[0] ?? null;
    }

    /** exact normalized-phone match within the branch; ambiguity (0 or 2+) → null */
    private async matchClient(branchId: string, callerPhone: string | null): Promise<number | null> {
        if (!callerPhone) return null;
        const clients = await this.prismaService.client.findMany({
            where: { branchId, phone: { not: null } },
            select: { id: true, phone: true },
        });
        const matches = clients.filter((c) => normalizePhone(c.phone) === callerPhone);
        return matches.length === 1 ? matches[0]!.id : null;
    }

    /** allowlist fields + coerce Gemini string values to their column types */
    private sanitizeProposals(proposals: ExtractionProposal[]): ExtractionProposal[] {
        const sanitized: ExtractionProposal[] = [];
        for (const proposal of proposals) {
            if (!ALLOWED_FIELDS.has(proposal.field)) continue;
            if (proposal.value === null && NON_NULLABLE_FIELDS.has(proposal.field)) {
                throw new BadRequestException(`${proposal.field} is non-nullable`);
            }
            let value: string | number | boolean | null = proposal.value;
            if (proposal.field === "phone" && proposal.value !== null) {
                if (typeof proposal.value !== "string") {
                    throw new BadRequestException(INVALID_PHONE_MESSAGE);
                }
                assertValidPhone(proposal.value);
            }
            if (typeof value === "string") {
                if (BOOLEAN_FIELDS.has(proposal.field)) {
                    value = value.trim().toLowerCase() === "true";
                } else if (NUMBER_FIELDS.has(proposal.field)) {
                    const parsed = parseInt(value.replace(/\D/g, ""), 10);
                    if (Number.isNaN(parsed)) continue;
                    value = parsed;
                }
            }
            sanitized.push({ ...proposal, value });
        }
        return sanitized;
    }
}
