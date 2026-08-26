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

@Injectable()
export class CallProcessingService {
    private readonly logger = new Logger(CallProcessingService.name);

    constructor(
        private readonly prismaService: PrismaService,
        @Inject(CALL_EXTRACTION_PORT)
        private readonly extractionPort: CallExtractionPort,
    ) {}

    async processCallRecord(callRecordId: string): Promise<void> {
        const record = await this.prismaService.call_record.findUnique({
            where: { id: callRecordId },
        });
        if (!record) {
            this.logger.warn(`call_record ${callRecordId} not found; skipping`);
            return;
        }
        if (record.processingStatus !== "RECEIVED" && record.processingStatus !== "FAILED") {
            return; // already extracted (idempotency for cron + manual retriggers)
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
            await this.prismaService.call_record.update({
                where: { id: callRecordId },
                data: {
                    processingStatus: "FAILED",
                    failureReason: String(error).slice(0, 1_000),
                },
            });
            return;
        }

        const callerPhone = this.resolveCallerPhone(extraction, record.fileName);
        let proposals: ExtractionProposal[];
        try {
            proposals = this.sanitizeProposals(extraction.proposals);
        } catch (error) {
            this.logger.warn(`Extraction validation failed for ${callRecordId}: ${error}`);
            await this.prismaService.call_record.update({
                where: { id: callRecordId },
                data: {
                    processingStatus: "FAILED",
                    failureReason: `extraction validation: ${String(error).slice(0, 950)}`,
                },
            }).catch(() => undefined);
            return;
        }
        const matchedClientId = await this.matchClient(record.branchId, callerPhone);

        try {
            await this.prismaService.$transaction(async (tx) => {
                await tx.call_record.update({
                    where: { id: callRecordId },
                    data: {
                        category: extraction.category,
                        callerName: extraction.callerName ?? null,
                        callerPhone,
                        matchedClientId,
                        processingStatus: "EXTRACTED",
                        failureReason: null,
                    },
                });
                if (extraction.category === "NEW_CONSULTATION" || extraction.category === "CLIENT_SERVICE") {
                    await tx.client_draft.create({
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
                    });
                }
            });
        } catch (error) {
            this.logger.error(`Persistence failed for ${callRecordId}: ${error}`);
            // rollback left the record RECEIVED/FAILED; mark FAILED so the retry cron picks it up with a reason
            await this.prismaService.call_record
                .update({
                    where: { id: callRecordId },
                    data: {
                        processingStatus: "FAILED",
                        failureReason: `persistence: ${String(error).slice(0, 950)}`,
                    },
                })
                .catch(() => undefined); // if even this fails, the stuck-RECEIVED cron branch recovers it
        }
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
