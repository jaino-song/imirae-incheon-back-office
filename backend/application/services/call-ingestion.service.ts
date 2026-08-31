import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "infrastructure/database/prisma.service";
import { CallProcessingService } from "application/services/call-processing.service";
import { CallTranscriptWebhookDto } from "interface/dto/call-inbox.dto";

export interface IngestResult {
    duplicate: boolean;
    callRecordId: string;
}

function isUniqueViolation(error: unknown): boolean {
    return typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002";
}

@Injectable()
export class CallIngestionService {
    private readonly logger = new Logger(CallIngestionService.name);

    constructor(
        private readonly prismaService: PrismaService,
        private readonly processingService: CallProcessingService,
    ) {}

    async ingest(branchId: string, payload: CallTranscriptWebhookDto): Promise<IngestResult> {
        const existing = await this.prismaService.call_record.findUnique({
            where: { driveFileId: payload.driveFileId },
        });
        if (existing) {
            this.logger.log(`Duplicate webhook for drive file ${payload.driveFileId}; no-op`);
            return { duplicate: true, callRecordId: existing.id };
        }

        // sttMeta echoes what n8n reported about the transcription itself,
        // kept alongside transcriptRaw for audit. transcript is NOT NULL and
        // holds the same raw segments until the refine stage (unit 1.4)
        // overwrites it with the corrected role-mapped version.
        let record;
        try {
            record = await this.prismaService.call_record.create({
                data: {
                    branchId,
                    driveFileId: payload.driveFileId,
                    fileName: payload.fileName,
                    recordedAt: payload.recordedAt ? new Date(payload.recordedAt) : null,
                    transcript: payload.transcriptRaw as unknown as Prisma.InputJsonValue,
                    transcriptRaw: payload.transcriptRaw as unknown as Prisma.InputJsonValue,
                    sttMeta: {
                        sttModel: payload.sttModel,
                        diarized: payload.diarized,
                        vocabularyVersion: payload.vocabularyVersion,
                    } as unknown as Prisma.InputJsonValue,
                    processingStatus: "RECEIVED",
                },
            });
        } catch (error) {
            if (isUniqueViolation(error)) {
                const winner = await this.prismaService.call_record.findUnique({
                    where: { driveFileId: payload.driveFileId },
                });
                if (winner) {
                    this.logger.log(`Concurrent duplicate for drive file ${payload.driveFileId}; no-op`);
                    return { duplicate: true, callRecordId: winner.id };
                }
            }
            throw error;
        }

        // Fire-and-forget (repo convention): webhook responds immediately,
        // extraction failures land in FAILED status for the retry cron.
        this.processingService.processCallRecord(record.id).catch((error) => {
            this.logger.error(`Extraction kickoff failed for ${record.id}: ${error}`);
        });

        return { duplicate: false, callRecordId: record.id };
    }
}
