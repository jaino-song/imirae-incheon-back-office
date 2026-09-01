import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { DatabaseModule } from "infrastructure/database/database.module";
import { CALL_EXTRACTION_PORT } from "domain/ports/call-extraction.port";
import { CALL_REFINEMENT_PORT } from "domain/ports/call-refinement.port";
import {
    createCallExtractionAdapter,
    createCallRefinementAdapter,
} from "infrastructure/vendor-stubs/e2e-vendor-stubs";
import { CallIngestGuard } from "infrastructure/auth/call-ingest.guard";
import { CallIngestTokenService } from "application/services/call-ingest-token.service";
import { CallIngestionService } from "application/services/call-ingestion.service";
import { CallProcessingService } from "application/services/call-processing.service";
import { CallExtractionRetrySchedulerService } from "application/services/call-extraction-retry-scheduler.service";
import { CallInboxService } from "application/services/call-inbox.service";
import { CallTranscriptWebhookController } from "interface/controllers/call-transcript-webhook.controller";
import { CallIngestTokenController } from "interface/controllers/call-ingest-token.controller";
import { CallRecordController } from "interface/controllers/call-record.controller";
import { ClientDraftController } from "interface/controllers/client-draft.controller";
import { ClientModule } from "./client.module";

@Module({
    imports: [DatabaseModule, ConfigModule, ClientModule],
    controllers: [
        CallTranscriptWebhookController,
        CallIngestTokenController,
        CallRecordController,
        ClientDraftController,
    ],
    providers: [
        CallIngestGuard,
        CallIngestTokenService,
        CallIngestionService,
        CallProcessingService,
        CallExtractionRetrySchedulerService,
        CallInboxService,
        {
            provide: CALL_EXTRACTION_PORT,
            inject: [ConfigService],
            useFactory: createCallExtractionAdapter,
        },
        {
            provide: CALL_REFINEMENT_PORT,
            inject: [ConfigService],
            useFactory: createCallRefinementAdapter,
        },
    ],
    exports: [CallInboxService],
})
export class CallInboxModule {}
