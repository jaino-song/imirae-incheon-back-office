import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
    FindEformsignDocByIdUsecase,
    FindEformsignDocByDocumentIdUsecase,
    FindEformsignDocsByClientIdUsecase,
    ListEformsignDocsUsecase,
    ListOtherBranchDocumentIdsUsecase,
    ListEformsignDocDisplayFieldsUsecase,
    GetEformsignAccessTokenUsecase,
    RefreshEformsignAccessTokenUsecase,
    FetchAllEformsignDocsFromApiUsecase,
    FetchEformsignDocFromApiUsecase,
    UpdateEformsignDocStatusUsecase,
    LinkDocumentToClientUsecase,
    CreateEformsignDocUsecase,
    CreateAndSendContractUsecase,
    ListClientNamesByBranchUsecase,
    SyncClientEndDateUsecase,
    DispatchDocumentHeadlessUsecase,
    FinalizeDocumentHeadlessUsecase,
    AdoptEformsignDocUsecase,
    MirrorUnassignedEformsignDocUsecase,
    BackfillEformsignDocsUsecase,
} from "application/usecases/eformsign-doc";
import { EFORMSIGN_DOC_REPOSITORY } from "domain/repositories/eformsign-doc.repository.interface";
import { EFORMSIGN_CLIENT_REPOSITORY } from "domain/repositories/eformsign.client.interface";
import { CLIENT_REPOSITORY } from "domain/repositories/client.repository.interface";
import { DatabaseModule } from "infrastructure/database/database.module";
import { SbEformsignDocRepository } from "infrastructure/database/repositories/sb.eformsign-doc.repository";
import { SbClientRepository } from "infrastructure/database/repositories/sb.client.repository";
import { createEformsignClientRepository } from "infrastructure/vendor-stubs/e2e-vendor-stubs";
import { EformsignDocService } from "application/services/eformsign-doc.service";
import { EformsignService } from "application/services/eformsign.service";
import { EformsignDocsEventBus } from "application/services/eformsign-docs-event-bus.service";
import { EformsignHeadlessProgressService } from "application/services/eformsign-headless-progress.service";
import { EformsignHeadlessService } from "infrastructure/automation/eformsign-headless.service";
import { AreaTemplateModule } from "module/area-template.module";
import { EformsignDocController } from "interface/controllers/eformsign-doc.controller";
import { CreateAndSendServiceRecordSnapshotUsecase } from "application/usecases/eformsign-doc/create-and-send-service-record-snapshot.usecase";
import { ContractClientAssignmentGuardService } from "application/services/contract-client-assignment-guard.service";
import { EformsignDocumentSnapshotService } from "application/services/eformsign-document-snapshot.service";
import {
    createEformsignBackfillRedisClient,
    EFORMSIGN_BACKFILL_REDIS_CLIENT,
    EformsignBackfillLockService,
} from "infrastructure/locking/eformsign-backfill-lock.service";

@Module({
    imports: [DatabaseModule, AreaTemplateModule],
    controllers: [EformsignDocController],
    providers: [
        // Use cases - Local DB
        FindEformsignDocByIdUsecase,
        FindEformsignDocByDocumentIdUsecase,
        FindEformsignDocsByClientIdUsecase,
        ListEformsignDocsUsecase,
        ListOtherBranchDocumentIdsUsecase,
        ListEformsignDocDisplayFieldsUsecase,
        CreateEformsignDocUsecase,
        UpdateEformsignDocStatusUsecase,
        LinkDocumentToClientUsecase,
        ListClientNamesByBranchUsecase,
        SyncClientEndDateUsecase,
        // Use cases - External API
        GetEformsignAccessTokenUsecase,
        RefreshEformsignAccessTokenUsecase,
        FetchAllEformsignDocsFromApiUsecase,
        FetchEformsignDocFromApiUsecase,
        // Use cases - Contract creation
        CreateAndSendContractUsecase,
        // Use case - Service record snapshot (BJJ-247)
        CreateAndSendServiceRecordSnapshotUsecase,
        // Use cases - Headless dispatch (BJJ-90)
        DispatchDocumentHeadlessUsecase,
        FinalizeDocumentHeadlessUsecase,
        AdoptEformsignDocUsecase,
        MirrorUnassignedEformsignDocUsecase,
        BackfillEformsignDocsUsecase,
        // Services
        EformsignDocService,
        EformsignService,
        EformsignHeadlessService,
        EformsignDocsEventBus,
        EformsignHeadlessProgressService,
        ContractClientAssignmentGuardService,
        EformsignDocumentSnapshotService,
        EformsignBackfillLockService,
        // Repository bindings
        {
            provide: EFORMSIGN_DOC_REPOSITORY,
            useClass: SbEformsignDocRepository,
        },
        {
            provide: EFORMSIGN_CLIENT_REPOSITORY,
            inject: [ConfigService],
            useFactory: createEformsignClientRepository,
        },
        {
            provide: CLIENT_REPOSITORY,
            useClass: SbClientRepository,
        },
        {
            provide: EFORMSIGN_BACKFILL_REDIS_CLIENT,
            inject: [ConfigService],
            useFactory: createEformsignBackfillRedisClient,
        },
    ],
    exports: [
        EformsignDocService,
        SyncClientEndDateUsecase,
        EformsignDocsEventBus,
        EformsignHeadlessProgressService,
        EFORMSIGN_CLIENT_REPOSITORY,
        EFORMSIGN_DOC_REPOSITORY,
        CreateAndSendServiceRecordSnapshotUsecase,
        EformsignDocumentSnapshotService,
        MirrorUnassignedEformsignDocUsecase,
        BackfillEformsignDocsUsecase,
        EformsignBackfillLockService,
    ],
})
export class EformsignDocModule {}
