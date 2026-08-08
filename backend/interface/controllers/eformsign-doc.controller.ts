import { Body, Controller, Get, Logger, MessageEvent, Post, Query, Sse, UseGuards } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Observable, filter, interval, map, merge } from "rxjs";
import { EformsignDocService } from "application/services/eformsign-doc.service";
import { EformsignDocsEventBus } from "application/services/eformsign-docs-event-bus.service";
import { EformsignHeadlessProgressService } from "application/services/eformsign-headless-progress.service";
import { ListClientNamesByBranchUsecase } from "application/usecases/eformsign-doc/list-client-names-by-branch.usecase";
import { ListReviewStageContractsUsecase } from "application/usecases/eformsign-doc/list-review-stage-contracts.usecase";
import { DispatchDocumentHeadlessUsecase } from "application/usecases/eformsign-doc/dispatch-document-headless.usecase";
import { FinalizeDocumentHeadlessUsecase } from "application/usecases/eformsign-doc/finalize-document-headless.usecase";
import { AdoptEformsignDocUsecase } from "application/usecases/eformsign-doc/adopt-eformsign-doc.usecase";
import type { CreateEformsignDocResult } from "application/usecases/eformsign-doc/create-eformsign-doc.usecase";
import { SERVICE_RECORD_TEMPLATE_TIER_ENV_KEYS } from "application/usecases/eformsign-doc/service-record-field-ids";
import {
    GetAccessTokenDto,
    RefreshAccessTokenDto,
    CreateEformsignDocLocalDto,
    DispatchHeadlessRequestDto,
    DispatchHeadlessResponseDto,
    FinalizeHeadlessRequestDto,
    FinalizeHeadlessResponseDto,
    AdoptEformsignDocDto,
    ReviewNeededContractDto,
} from "interface/dto/eformsign-doc.dto";
import { CurrentTenant, TenantGuard } from "infrastructure/tenant";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { parseInteger } from "interface/parse-integer";

@Controller("eformsign-docs")
@UseGuards(JwtGuard, TenantGuard)
export class EformsignDocController {
    private readonly logger = new Logger(EformsignDocController.name);

    constructor(
        private readonly eformsignDocService: EformsignDocService,
        private readonly listClientNamesByBranchUsecase: ListClientNamesByBranchUsecase,
        private readonly listReviewStageContractsUsecase: ListReviewStageContractsUsecase,
        private readonly dispatchHeadlessUsecase: DispatchDocumentHeadlessUsecase,
        private readonly finalizeHeadlessUsecase: FinalizeDocumentHeadlessUsecase,
        private readonly adoptEformsignDocUsecase: AdoptEformsignDocUsecase,
        private readonly eventBus: EformsignDocsEventBus,
        private readonly headlessProgressService: EformsignHeadlessProgressService,
        private readonly configService: ConfigService,
    ) {}

    /**
     * GET /eformsign-docs/feedback-template-id
     * Exposes the 제공기록지 template id(s) so the UI can split service-record documents
     * from contract documents by template — never by (renamable) template name.
     * `templateId` stays the base (5회) id for backward compatibility; `templateIds`
     * lists every configured tier (base, then 10/15/20회 in that order) so the UI can
     * match documents created on any tier's template (BJJ-multi-tier).
     */
    @Get("feedback-template-id")
    getServiceRecordTemplateId(): { templateId: string | null; templateIds: string[] } {
        const templateId = this.configService.get<string>("EFORMSIGN_SERVICE_RECORD_TEMPLATE_ID")?.trim();
        const templateIds = SERVICE_RECORD_TEMPLATE_TIER_ENV_KEYS
            .map(({ envKey }) => this.configService.get<string>(envKey)?.trim())
            .filter((id): id is string => Boolean(id));
        return { templateId: templateId || null, templateIds };
    }

    /**
     * GET /eformsign-docs/review-needed-contracts
     * Provider-review-stage (070) contracts for the dashboard card: the branch's
     * own plus unclaimed ones (documents often reach the review stage before any
     * branch adopts them), with the nightly auto-finalize bookkeeping so the UI
     * can badge 대기 / 재시도 / 수동 확인 필요.
     */
    @Get("review-needed-contracts")
    async getReviewNeededContracts(
        @CurrentTenant() tenant: { branchId?: string },
    ): Promise<ReviewNeededContractDto[]> {
        const branchId = tenant.branchId ?? "";
        const contracts = await this.listReviewStageContractsUsecase.execute();
        return contracts
            .filter((contract) => contract.branchId === branchId || contract.branchId === null)
            .sort((a, b) => (a.contractEndDate ?? "9999-99-99").localeCompare(b.contractEndDate ?? "9999-99-99"))
            .map((contract) => ({
                documentId: contract.documentId,
                customerName: contract.customerName,
                contractEndDate: contract.contractEndDate,
                autoFinalizeAttempts: contract.autoFinalizeAttempts,
                autoFinalizeLastError: contract.autoFinalizeLastError,
                autoFinalizeLastAttemptAt:
                    contract.autoFinalizeLastAttemptAt?.toISOString() ?? null,
            }));
    }

    /**
     * GET /eformsign-docs/events
     * Server-Sent Events stream of doc-list mutations for the current branch.
     * Emits a `docs-changed` event after each webhook completes; sends a `ping`
     * every 30s to keep proxies + clients honest.
     */
    @Sse("events")
    events(@CurrentTenant() tenant: { branchId?: string }): Observable<MessageEvent> {
        const branchId = tenant.branchId ?? "";

        const docs = this.eventBus.events$.pipe(
            filter((e) => e.branchId === branchId),
            map((e) => ({ data: e, type: "docs-changed" } as MessageEvent)),
        );

        const heartbeat = interval(30000).pipe(
            map(() => ({ data: { at: Date.now() }, type: "ping" } as MessageEvent)),
        );

        return merge(docs, heartbeat);
    }

    @Sse("dispatch-headless/progress")
    dispatchHeadlessProgress(@Query("progressId") progressId: string): Observable<MessageEvent> {
        const progress = this.headlessProgressService.events$.pipe(
            filter((event) => event.progressId === progressId),
            map((event) => ({ data: event, type: "progress" } as MessageEvent)),
        );

        const heartbeat = interval(30000).pipe(
            map(() => ({ data: { at: Date.now() }, type: "ping" } as MessageEvent)),
        );

        return merge(progress, heartbeat);
    }

    @Sse("finalize-headless/progress")
    finalizeHeadlessProgress(@Query("progressId") progressId: string): Observable<MessageEvent> {
        const progress = this.headlessProgressService.events$.pipe(
            filter((event) => event.progressId === progressId),
            map((event) => ({ data: event, type: "progress" } as MessageEvent)),
        );

        const heartbeat = interval(30000).pipe(
            map(() => ({ data: { at: Date.now() }, type: "ping" } as MessageEvent)),
        );

        return merge(progress, heartbeat);
    }

    // ============ Local DB Endpoints ============

    /**
     * POST /eformsign-docs
     * Create a new eformsign document record in local DB
     * Called by frontend after document is created in eformsign
     */
    @Post()
    async create(@CurrentTenant() tenant: { branchId?: string }, @Body() dto: CreateEformsignDocLocalDto) {
        this.logger.log(`[POST /eformsign-docs] Received request to create doc record: documentId=${dto.documentId}, clientId=${dto.clientId}`);
        try {
            const result = await this.eformsignDocService.create(tenant.branchId ?? "", {
                documentId: dto.documentId,
                clientId: dto.clientId,
                statusType: dto.statusType,
                statusDetail: dto.statusDetail,
                stepType: dto.stepType,
                stepIndex: dto.stepIndex,
                stepName: dto.stepName,
                stepRecipientType: dto.stepRecipientType,
                stepRecipientName: dto.stepRecipientName,
                stepRecipientSms: dto.stepRecipientSms,
                expiredDate: new Date(dto.expiredDate),
                linkToClient: dto.linkToClient,
                documentKind: dto.documentKind,
                employeeScheduleId: dto.employeeScheduleId,
                templateId: dto.templateId,
            });
            this.logger.log(`[POST /eformsign-docs] Successfully created record id=${result.id}`);
            const resultWithWarnings = result as CreateEformsignDocResult;
            return {
                ...result.toJSON(),
                ...(resultWithWarnings.warnings ? { warnings: resultWithWarnings.warnings } : {}),
            };
        } catch (error) {
            this.logger.error(`[POST /eformsign-docs] Failed to create record: ${error}`);
            throw error;
        }
    }

    /**
     * GET /eformsign-docs
     * List all stored eformsign documents from local DB
     */
    @Get()
    findAll(@CurrentTenant() tenant: { branchId?: string }) {
        return this.eformsignDocService.findAll(tenant.branchId ?? "");
    }

    /**
     * GET /eformsign-docs/id?id=123
     * Find a stored eformsign document by its DB id
     */
    @Get("id")
    findById(@CurrentTenant() tenant: { branchId?: string }, @Query("id") id: string) {
        return this.eformsignDocService.findById(tenant.branchId ?? "", parseInteger(id, "id", { min: 1 }));
    }

    /**
     * GET /eformsign-docs/document-id?documentId=abc123
     * Find a stored eformsign document by the eformsign documentId
     */
    @Get("document-id")
    findByDocumentId(
        @CurrentTenant() tenant: { branchId?: string },
        @Query("documentId") documentId: string
    ) {
        return this.eformsignDocService.findByDocumentId(tenant.branchId ?? "", documentId);
    }

    /**
     * GET /eformsign-docs/client-names
     * Returns documentId → clientName mapping for current branch.
     * Used by the contracts list to show the customer's name even after the
     * doc has progressed past step 1 (eformsign list_document loses outsider info).
     */
    @Get("client-names")
    listClientNames(@CurrentTenant() tenant: { branchId?: string }) {
        return this.listClientNamesByBranchUsecase.execute(tenant.branchId ?? "");
    }

    /**
     * GET /eformsign-docs/client?clientId=123
     * Find all stored eformsign documents linked to a client
     */
    @Get("client")
    findByClientId(
        @CurrentTenant() tenant: { branchId?: string },
        @Query("clientId") clientId: string
    ) {
        return this.eformsignDocService.findByClientIdWithContractEndDates(
            tenant.branchId ?? "",
            parseInteger(clientId, "clientId", { min: 1 }),
        );
    }

    // ============ External API Endpoints ============

    /**
     * POST /eformsign-docs/access-token
     * Get access token from eformsign API
     */
    @Post("access-token")
    getAccessToken(@Body() dto: GetAccessTokenDto) {
        return this.eformsignDocService.getAccessToken(dto.executionTime, dto.memberEmail);
    }

    /**
     * POST /eformsign-docs/refresh-token
     * Refresh access token using refresh token
     */
    @Post("refresh-token")
    refreshAccessToken(@Body() dto: RefreshAccessTokenDto) {
        return this.eformsignDocService.refreshAccessToken(dto.executionTime, dto.refreshToken);
    }

    /** 원격 생성에는 성공했지만 로컬 저장에 실패한 문서를 현재 지점으로 복구한다. */
    @Post("adopt")
    async adopt(
        @CurrentTenant() tenant: { branchId?: string },
        @Body() dto: AdoptEformsignDocDto,
    ) {
        const result = await this.adoptEformsignDocUsecase.execute(tenant.branchId ?? "", dto);
        return {
            ...result.toJSON(),
            ...(result.warnings ? { warnings: result.warnings } : {}),
        };
    }

    /**
     * POST /eformsign-docs/dispatch-headless
     * Run the creation iframe gate sequence (mode:"01") off-screen via Playwright.
     * Returns { ok: false, fallbackHint: "iframe" } on any failure so the
     * frontend can fall back to the existing iframe modal automatically.
     */
    @Post("dispatch-headless")
    async dispatchHeadless(
        @CurrentTenant() tenant: { branchId?: string },
        @Body() dto: DispatchHeadlessRequestDto,
    ): Promise<DispatchHeadlessResponseDto> {
        this.logger.log(`[POST /eformsign-docs/dispatch-headless] clientId=${dto.clientId}`);
        const result = await this.dispatchHeadlessUsecase.execute(tenant.branchId ?? "", {
            contractData: dto.contractData,
            clientId: dto.clientId,
            progressId: dto.progressId,
            force: dto.force,
        });
        if (!result.ok) {
            this.logger.warn(`[dispatch-headless] failed: ${result.reason}`);
            return {
                ok: false,
                durationMs: result.durationMs,
                reason: result.reason,
                failedStep: result.failedStep,
                fallbackHint: result.fallbackHint,
                remoteDocumentId: result.remoteDocumentId,
                existingDocumentId: result.existingDocumentId,
            };
        }
        return {
            ok: true,
            documentId: result.documentId,
            durationMs: result.durationMs,
        };
    }

    /**
     * POST /eformsign-docs/finalize-headless
     * Run the staff-finalize iframe gate sequence (mode:"02") off-screen.
     */
    @Post("finalize-headless")
    async finalizeHeadless(@Body() dto: FinalizeHeadlessRequestDto): Promise<FinalizeHeadlessResponseDto> {
        this.logger.log(`[POST /eformsign-docs/finalize-headless] documentId=${dto.documentId}`);
        const result = await this.finalizeHeadlessUsecase.execute({
            documentId: dto.documentId,
            prefillEndDate: dto.prefillEndDate,
            progressId: dto.progressId,
        });
        if (!result.ok) {
            this.logger.warn(
                `[finalize-headless] failed: ${result.reason} (fallback: ${result.fallbackHint})`,
            );
            return {
                ok: false,
                durationMs: result.durationMs,
                reason: result.reason,
                fallbackHint: result.fallbackHint,
            };
        }
        return { ok: true, durationMs: result.durationMs };
    }
}
