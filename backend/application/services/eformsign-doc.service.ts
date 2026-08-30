import { Injectable, Logger, Optional } from "@nestjs/common";
import {
    FindEformsignDocByIdUsecase,
    FindEformsignDocByDocumentIdUsecase,
    FindEformsignDocsByClientIdUsecase,
    ListEformsignDocsUsecase,
    ListOtherBranchDocumentIdsUsecase,
    ListEformsignDocDisplayFieldsUsecase,
    FetchAllEformsignDocsFromApiUsecase,
    FetchEformsignDocFromApiUsecase,
    CreateEformsignDocUsecase,
    CreateEformsignDocParams,
    UpdateEformsignDocStatusUsecase,
    CreateAndSendContractUsecase,
    CreateAndSendContractParams,
    CreateAndSendContractResult,
    LinkDocumentToClientUsecase,
} from "application/usecases/eformsign-doc";
import { EformsignDocEntity } from "domain/entities/eformsign-doc.entity";
import { EformsignApiDocumentResponse } from "domain/repositories/eformsign.client.interface";
import { EformsignDocDisplayFields } from "domain/repositories/eformsign-doc.repository.interface";
import { normalizeEformsignStatusCode } from "domain/utils/eformsign-status-code";
import { EformsignDocumentSnapshotService } from "./eformsign-document-snapshot.service";
import { sanitizeEformsignErrorMessage } from "application/utils/eformsign-error-message";
import { EformsignProviderPrincipal } from "./eformsign-credential-boundary.service";

const COMPLETED_STATUS_CODES = new Set(["003", "012", "022", "032", "050", "062", "072", "092"]);
const REJECTED_STATUS_CODES = new Set(["011", "021", "031", "040", "042", "045", "047", "049", "061", "071", "080"]);

@Injectable()
export class EformsignDocService {
    private readonly logger = new Logger(EformsignDocService.name);

    constructor(
        // Local DB use cases
        private readonly findEformsignDocByIdUsecase: FindEformsignDocByIdUsecase,
        private readonly findEformsignDocByDocumentIdUsecase: FindEformsignDocByDocumentIdUsecase,
        private readonly findEformsignDocsByClientIdUsecase: FindEformsignDocsByClientIdUsecase,
        private readonly listEformsignDocsUsecase: ListEformsignDocsUsecase,
        private readonly listOtherBranchDocumentIdsUsecase: ListOtherBranchDocumentIdsUsecase,
        private readonly listEformsignDocDisplayFieldsUsecase: ListEformsignDocDisplayFieldsUsecase,
        private readonly createEformsignDocUsecase: CreateEformsignDocUsecase,
        private readonly updateEformsignDocStatusUsecase: UpdateEformsignDocStatusUsecase,
        private readonly linkDocumentToClientUsecase: LinkDocumentToClientUsecase,
        // External API use cases (all credentialed calls are made by an
        // application boundary that owns the server-side provider identity)
        private readonly fetchAllEformsignDocsFromApiUsecase: FetchAllEformsignDocsFromApiUsecase,
        private readonly fetchEformsignDocFromApiUsecase: FetchEformsignDocFromApiUsecase,
        // Contract creation
        private readonly createAndSendContractUsecase: CreateAndSendContractUsecase,
        @Optional()
        private readonly documentSnapshotService?: EformsignDocumentSnapshotService,
    ) {}

    // ============ Local DB Operations ============

    /**
     * Create a new eformsign doc record in local DB
     * @param params - document creation parameters
     */
    async create(branchid: string, params: CreateEformsignDocParams): Promise<EformsignDocEntity> {
        this.logger.log(`Creating eformsign doc record: documentId=${params.documentId}, clientId=${params.clientId}, linkToClient=${params.linkToClient}`);
        const result = await this.createEformsignDocUsecase.execute(branchid, params);
        await this.bumpDocumentSnapshotVersion(branchid);
        this.logger.log(`Successfully created eformsign doc record: id=${result.id}, documentId=${result.documentId}`);
        return result;
    }

    private async bumpDocumentSnapshotVersion(branchId: string): Promise<void> {
        if (!branchId) return;

        try {
            await this.documentSnapshotService?.bumpVersion(branchId);
        } catch {
            // 캐시 무효화 실패가 계약 생성 성공을 되돌리면 안 된다.
        }
    }

    /**
     * Find a stored eformsign doc by its DB id
     */
    findById(branchid: string, id: number): Promise<EformsignDocEntity | null> {
        return this.findEformsignDocByIdUsecase.execute(branchid, id);
    }

    /**
     * Find a stored eformsign doc by the eformsign documentId
     */
    findByDocumentId(branchid: string, documentId: string): Promise<EformsignDocEntity | null> {
        return this.findEformsignDocByDocumentIdUsecase.execute(branchid, documentId);
    }

    findByDocumentIdIncludingPurgePending(
        branchid: string,
        documentId: string,
    ): Promise<EformsignDocEntity | null> {
        return this.findEformsignDocByDocumentIdUsecase.executeIncludingPurgePending(
            branchid,
            documentId,
        );
    }

    /**
     * Find all stored eformsign docs linked to a client
     */
    findByClientId(branchid: string, clientId: number): Promise<EformsignDocEntity[]> {
        return this.findEformsignDocsByClientIdUsecase.execute(branchid, clientId);
    }

    /** Same rows serialized with the contract end date the client panel's status rule needs. */
    findByClientIdWithContractEndDates(branchid: string, clientId: number) {
        return this.findEformsignDocsByClientIdUsecase.executeWithContractEndDates(branchid, clientId);
    }

    /**
     * List all stored eformsign docs
     */
    findAll(branchid: string): Promise<EformsignDocEntity[]> {
        return this.listEformsignDocsUsecase.execute(branchid);
    }

    findAllForHeadquarters(branchid: string): Promise<EformsignDocEntity[]> {
        return this.listEformsignDocsUsecase.executeForHeadquarters(branchid);
    }

    /**
     * List documentIds owned by branches OTHER than the given one
     * (branchId set and != branchid). Lets the 인천(HQ) branch list its own +
     * unmapped docs while excluding other branches' contracts.
     */
    findDocumentIdsForOtherBranches(branchid: string): Promise<string[]> {
        return this.listOtherBranchDocumentIdsUsecase.execute(branchid);
    }

    findDisplayFieldsByDocumentIds(
        branchid: string,
        documentIds: string[],
    ): Promise<EformsignDocDisplayFields[]> {
        return this.listEformsignDocDisplayFieldsUsecase.execute(branchid, documentIds);
    }

    // ============ External API Operations ============

    /**
     * Fetch all documents from eformsign API
     * @param accessToken - valid access token
     */
    fetchAllFromApi(accessToken: string): Promise<EformsignApiDocumentResponse[]> {
        return this.fetchAllEformsignDocsFromApiUsecase.execute(accessToken);
    }

    /**
     * Fetch a single document from eformsign API
     * @param accessToken - valid access token
     * @param documentId - the eformsign document id
     */
    fetchFromApi(accessToken: string, documentId: string): Promise<EformsignApiDocumentResponse> {
        return this.fetchEformsignDocFromApiUsecase.execute(accessToken, documentId);
    }

    async syncStatusFromApi(
        branchid: string,
        accessToken: string,
        documentId: string
    ): Promise<EformsignDocEntity> {
        const document = await this.fetchEformsignDocFromApiUsecase.execute(accessToken, documentId);
        const currentStatus = document.current_status;
        const statusType = normalizeEformsignStatusCode(currentStatus?.status_type);

        const updatedDoc = await this.updateEformsignDocStatusUsecase.execute(branchid, {
            documentId,
            statusType,
            statusDetail: this.statusDetail(statusType, currentStatus?.step_name),
            stepType: currentStatus?.step_type,
            stepIndex: currentStatus?.step_index,
            stepName: currentStatus?.step_name,
            expired: currentStatus?._expired,
        });
        await this.linkDocumentToClientBestEffort(branchid, documentId);
        return updatedDoc;
    }

    createAndSendContract(
        branchid: string,
        params: CreateAndSendContractParams,
        principal: EformsignProviderPrincipal,
    ): Promise<CreateAndSendContractResult> {
        return this.createAndSendContractUsecase.execute(branchid, params, principal);
    }

    private statusDetail(statusType: string, stepName: string | null | undefined): string {
        if (COMPLETED_STATUS_CODES.has(statusType)) {
            return "완료";
        }
        if (REJECTED_STATUS_CODES.has(statusType)) {
            return "거부";
        }
        return stepName?.trim() || "진행중";
    }

    private async linkDocumentToClientBestEffort(branchid: string, documentId: string): Promise<void> {
        try {
            await this.linkDocumentToClientUsecase.execute(branchid, documentId);
        } catch (error) {
            this.logger.warn(
                `Failed to link eformsign doc ${documentId} to client: ${sanitizeEformsignErrorMessage(error)}`,
            );
        }
    }
}
