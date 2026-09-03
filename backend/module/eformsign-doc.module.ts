import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
    FindEformsignDocByIdUsecase,
    FindEformsignDocByDocumentIdUsecase,
    FindEformsignDocsByClientIdUsecase,
    ListEformsignDocsUsecase,
    ListOtherBranchDocumentIdsUsecase,
    ListEformsignDocDisplayFieldsUsecase,
    FetchAllEformsignDocsFromApiUsecase,
    FetchEformsignDocFromApiUsecase,
    UpdateEformsignDocStatusUsecase,
    LinkDocumentToClientUsecase,
    CreateEformsignDocUsecase,
    CreateAndSendContractUsecase,
    ListClientNamesByBranchUsecase,
    ListReviewStageContractsUsecase,
    SyncClientEndDateUsecase,
    DispatchDocumentHeadlessUsecase,
    FinalizeDocumentHeadlessUsecase,
    AdoptEformsignDocUsecase,
    MirrorUnassignedEformsignDocUsecase,
    BackfillEformsignDocsUsecase,
    LinkMirroredEformsignDocByPhoneUsecase,
    GetContractClientCandidateUsecase,
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
import { EformsignCredentialBoundary } from "application/services/eformsign-credential-boundary.service";
import { EformsignDocsEventBus } from "application/services/eformsign-docs-event-bus.service";
import { EformsignHeadlessProgressService } from "application/services/eformsign-headless-progress.service";
import { EformsignHeadlessService } from "infrastructure/automation/eformsign-headless.service";
import { AreaTemplateModule } from "module/area-template.module";
import { MessageModule } from "module/message.module";
import { SystemSettingModule } from "module/system-setting.module";
import { EformsignDocController } from "interface/controllers/eformsign-doc.controller";
import { CreateAndSendServiceRecordSnapshotUsecase } from "application/usecases/eformsign-doc/create-and-send-service-record-snapshot.usecase";
import { ContractClientAssignmentGuardService } from "application/services/contract-client-assignment-guard.service";
import { EformsignDocumentSnapshotService } from "application/services/eformsign-document-snapshot.service";
import { EformsignDocReconcileSchedulerService } from "application/services/eformsign-doc-reconcile-scheduler.service";
import { EformsignWebhookEventWriter } from "application/services/eformsign-webhook-event.service";
import { EFORMSIGN_WEBHOOK_EVENT_REPOSITORY } from "domain/repositories/eformsign-webhook-event.repository.interface";
import { SbEformsignWebhookEventRepository } from "infrastructure/database/repositories/sb.eformsign-webhook-event.repository";
import { ContractAutoFinalizeSchedulerService } from "application/services/contract-auto-finalize-scheduler.service";
import { NotificationModule } from "module/notification.module";
import { EformsignDocumentMirrorService } from "application/services/eformsign-document-mirror.service";
import { EFORMSIGN_DOCUMENT_MIRROR_REPOSITORY } from "domain/repositories/eformsign-document-mirror.repository.interface";
import { SbEformsignDocumentMirrorRepository } from "infrastructure/database/repositories/sb.eformsign-document-mirror.repository";
import {
    createEformsignBackfillRedisClient,
    EFORMSIGN_BACKFILL_REDIS_CLIENT,
    EformsignBackfillLockService,
} from "infrastructure/locking/eformsign-backfill-lock.service";
import { EformsignOperationLockService } from "infrastructure/locking/eformsign-operation-lock.service";
import { ServiceRecordLifecycleService } from "application/services/service-record-lifecycle.service";
import { EformsignMirrorReadinessService } from "application/services/eformsign-mirror-readiness.service";
import { ReconcileCompletedMirroredEformsignDocUsecase } from "application/usecases/eformsign-doc/reconcile-completed-mirrored-eformsign-doc.usecase";
import { EformsignAgentCapabilitiesProvider } from "application/usecases/eformsign-doc/eformsign-agent-capabilities.provider";
import { ContractExternalAgentCapabilitiesProvider } from "application/usecases/eformsign-doc/contract-external-agent-capabilities.provider";
import { FindClientByIdUsecase } from "application/usecases/client/find-client-by-id.usecase";
import { CreateEmployeeUsecase } from "application/usecases/employee/create-employee.usecase";
import { EformsignDocumentJobService } from "application/services/eformsign-document-job.service";
import { EformsignDocumentJobWorkerService } from "application/services/eformsign-document-job-worker.service";
import { EformsignDocumentJobReconciliationService } from "application/services/eformsign-document-job-reconciliation.service";
import { EFORMSIGN_DOCUMENT_JOB_REPOSITORY } from "domain/repositories/eformsign-document-job.repository.interface";
import { EMPLOYEE_REPOSITORY } from "domain/repositories/employee.repository.interface";
import { SbEformsignDocumentJobRepository } from "infrastructure/database/repositories/sb.eformsign-document-job.repository";
import { SbEmployeeRepository } from "infrastructure/database/repositories/sb.employee.repository";
import { EFORMSIGN_DISPATCH_INTENT_REPOSITORY } from "domain/repositories/eformsign-dispatch-intent.repository.interface";
import { SbEformsignDispatchIntentRepository } from "infrastructure/database/repositories/sb.eformsign-dispatch-intent.repository";
import { EformsignDispatchBoundaryService } from "application/services/eformsign-dispatch-boundary.service";

@Module({
    imports: [
        DatabaseModule,
        AreaTemplateModule,
        MessageModule,
        SystemSettingModule,
        NotificationModule,
    ],
    controllers: [EformsignDocController],
    providers: [
        CreateEmployeeUsecase,
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
        ListReviewStageContractsUsecase,
        FindClientByIdUsecase,
        SyncClientEndDateUsecase,
        // Use cases - External API
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
        LinkMirroredEformsignDocByPhoneUsecase,
        GetContractClientCandidateUsecase,
        ReconcileCompletedMirroredEformsignDocUsecase,
        BackfillEformsignDocsUsecase,
        // Services
        EformsignDocService,
        EformsignService,
        EformsignCredentialBoundary,
        EformsignHeadlessService,
        EformsignDocsEventBus,
        EformsignHeadlessProgressService,
        ContractClientAssignmentGuardService,
        EformsignDocumentSnapshotService,
        EformsignBackfillLockService,
        EformsignOperationLockService,
        EformsignDocReconcileSchedulerService,
        // The scheduler owns the ledger's retention sweep; the writer itself is
        // also provided by the webhook module, which has its own instance.
        EformsignWebhookEventWriter,
        {
            provide: EFORMSIGN_WEBHOOK_EVENT_REPOSITORY,
            useClass: SbEformsignWebhookEventRepository,
        },
        ContractAutoFinalizeSchedulerService,
        EformsignDocumentMirrorService,
        ServiceRecordLifecycleService,
        EformsignMirrorReadinessService,
        EformsignAgentCapabilitiesProvider,
        ContractExternalAgentCapabilitiesProvider,
        EformsignDocumentJobService,
        EformsignDocumentJobWorkerService,
        EformsignDocumentJobReconciliationService,
        EformsignDispatchBoundaryService,
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
            provide: EFORMSIGN_DOCUMENT_MIRROR_REPOSITORY,
            useClass: SbEformsignDocumentMirrorRepository,
        },
        {
            provide: CLIENT_REPOSITORY,
            useClass: SbClientRepository,
        },
        {
            provide: EMPLOYEE_REPOSITORY,
            useClass: SbEmployeeRepository,
        },
        {
            provide: EFORMSIGN_DOCUMENT_JOB_REPOSITORY,
            useClass: SbEformsignDocumentJobRepository,
        },
        {
            provide: EFORMSIGN_DISPATCH_INTENT_REPOSITORY,
            useClass: SbEformsignDispatchIntentRepository,
        },
        {
            provide: EFORMSIGN_BACKFILL_REDIS_CLIENT,
            inject: [ConfigService],
            useFactory: createEformsignBackfillRedisClient,
        },
    ],
    exports: [
        EformsignDocService,
        EformsignCredentialBoundary,
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
        EformsignDocumentMirrorService,
        EformsignMirrorReadinessService,
        ReconcileCompletedMirroredEformsignDocUsecase,
        LinkMirroredEformsignDocByPhoneUsecase,
        GetContractClientCandidateUsecase,
        EformsignDocumentJobService,
        EformsignDispatchBoundaryService,
    ],
})
export class EformsignDocModule {}
