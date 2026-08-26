import { BadRequestException, Inject, Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "infrastructure/database/prisma.service";
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
import { extractPhoneCandidates, normalizePhone } from "application/utils/normalize-phone";

const BOOLEAN_FIELDS = new Set(["careCenter", "voucherClient", "breastPump"]);
const NUMBER_FIELDS = new Set(["duration"]);
const NON_NULLABLE_FIELDS = new Set(["name", "voucherClient", "breastPump"]);
const ALLOWED_FIELDS = new Set<string>(PROPOSAL_FIELDS);

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
            // terminal.  Neither state is safe to re-enter without a lease/token column.
            return record.processingStatus === "PROCESSING" ? "in_progress" : "already_processed";
        }

        // processingStatus is used as the in-progress marker and extractionRetryCount is
        // the generation fence.  The conditional update is the authoritative ownership
        // decision: a read followed by an unconditional update would allow two providers
        // to extract and publish for the same recording.
        const claimGeneration = record.extractionRetryCount;
        const claimed = await this.prismaService.call_record.updateMany({
            where: {
                id: callRecordId,
                processingStatus: record.processingStatus,
                extractionRetryCount: claimGeneration,
            },
            data: { processingStatus: "PROCESSING", failureReason: null },
        });
        if (claimed.count !== 1) {
            return this.observeCurrentState(callRecordId);
        }

        let extraction: CallExtractionResult;
        try {
            extraction = await this.extractionPort.extract({
                transcript: record.transcript as unknown as TranscriptTurn[],
                summary: record.summary as Record<string, unknown> | null,
                fileName: record.fileName,
            });
        } catch (error) {
            this.logger.error(`Extraction failed for ${callRecordId}: ${error}`);
            return this.markClaimFailed(callRecordId, claimGeneration, String(error).slice(0, 1_000));
        }

        let callerPhone: string | null;
        try {
            callerPhone = this.resolveCallerPhone(extraction, record.fileName);
        } catch (error) {
            this.logger.warn(`Extraction result normalization failed for ${callRecordId}: ${error}`);
            return this.markClaimFailed(
                callRecordId,
                claimGeneration,
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
                claimGeneration,
                `extraction validation: ${String(error).slice(0, 950)}`,
            );
        }

        try {
            const matchedClientId = await this.matchClient(record.branchId, callerPhone);
            await this.prismaService.$transaction(async (tx) => {
                const finalized = await tx.call_record.updateMany({
                    where: {
                        id: callRecordId,
                        processingStatus: "PROCESSING",
                        extractionRetryCount: claimGeneration,
                    },
                    data: {
                        category: extraction.category,
                        callerName: extraction.callerName ?? null,
                        callerPhone,
                        matchedClientId,
                        processingStatus: "EXTRACTED",
                        failureReason: null,
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
                                model: "gemini-2.5-flash",
                                promptVersion: CALL_EXTRACTION_PROMPT_VERSION,
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
                claimGeneration,
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
        claimGeneration: number,
        failureReason: string,
    ): Promise<CallProcessingResult> {
        try {
            const failed = await this.prismaService.call_record.updateMany({
                where: {
                    id: callRecordId,
                    processingStatus: "PROCESSING",
                    extractionRetryCount: claimGeneration,
                },
                data: { processingStatus: "FAILED", failureReason },
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
            const normalized = normalizePhone(candidate);
            if (normalized) return normalized;
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
