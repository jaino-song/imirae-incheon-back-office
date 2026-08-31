import { Body, Controller, Get, Post, Req, Res, UseGuards, Logger } from "@nestjs/common";
import { Request, Response } from "express";
import { CallIngestionService } from "application/services/call-ingestion.service";
import { CallTranscriptWebhookDto } from "interface/dto/call-inbox.dto";
import { CallIngestGuard } from "infrastructure/auth/call-ingest.guard";
import { CALL_VOCABULARY } from "domain/constants/call-vocabulary";

/**
 * n8n posts corrected call transcripts here. Branch identity comes ONLY from
 * the ingest token (CallIngestGuard). 202 fresh / 200 duplicate (idempotent).
 */
@Controller("webhooks/call-transcripts")
@UseGuards(CallIngestGuard)
export class CallTranscriptWebhookController {
    private readonly logger = new Logger(CallTranscriptWebhookController.name);

    constructor(private readonly ingestionService: CallIngestionService) {}

    @Post()
    async handleWebhook(
        @Req() request: Request & { callIngestBranchId?: string },
        @Body() payload: CallTranscriptWebhookDto,
        @Res({ passthrough: true }) response: Response,
    ) {
        const branchId = request.callIngestBranchId as string;
        this.logger.log(`Received call transcript ${payload.driveFileId} for branch ${branchId}`);

        const result = await this.ingestionService.ingest(branchId, payload);
        response.status(result.duplicate ? 200 : 202);
        return { accepted: true, duplicate: result.duplicate, callRecordId: result.callRecordId };
    }

    /**
     * Serves the repo-versioned vocabulary n8n biases Gemini 3.5 Transcribe's
     * `custom_vocabulary` with (spec §4.5). Branch-agnostic in v1 — the
     * ingest token still gates access, but its resolved branchId is unused.
     */
    @Get("vocabulary")
    getVocabulary() {
        return { version: CALL_VOCABULARY.version, phrases: CALL_VOCABULARY.phrases };
    }
}
