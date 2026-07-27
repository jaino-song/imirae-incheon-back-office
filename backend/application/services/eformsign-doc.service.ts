import { Injectable, Logger, Optional } from "@nestjs/common";
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
    CreateEformsignDocUsecase,
    CreateEformsignDocParams,
    UpdateEformsignDocStatusUsecase,
    CreateAndSendContractUsecase,
    CreateAndSendContractParams,
    CreateAndSendContractResult,
    LinkDocumentToClientUsecase,
} from "application/usecases/eformsign-doc";
import { EformsignDocEntity } from "domain/entities/eformsign-doc.entity";
import {
    EformsignTokenResponse,
    EformsignApiDocumentResponse,
} from "domain/repositories/eformsign.client.interface";
import { EformsignDocDisplayFields } from "domain/repositories/eformsign-doc.repository.interface";
import { EformsignDocumentSnapshotService } from "./eformsign-document-snapshot.service";

const COMPLETED_STATUS_CODES = new Set(["003", "012", "022", "032", "050", "062", "072", "092"]);
const REJECTED_STATUS_CODES = new Set(["011", "021", "031", "040", "042", "045", "047", "049", "061", "071", "080"]);
const STATUS_NAME_TO_CODE: Record<string, string> = {
    doc_tempsave: "001",
    doc_create: "002",
    doc_complete: "003",
    doc_request_approval: "010",
    doc_reject_approval: "011",
    doc_accept_approval: "012",
    doc_request_reception: "020",
    doc_reject_reception: "021",
    doc_accept_reception: "022",
    doc_request_outsider: "030",
    doc_reject_outsider: "031",
    doc_accept_outsider: "032",
    doc_request_revoke: "040",
    doc_revoke: "042",
    doc_update: "043",
    doc_request_reject: "045",
    doc_request_delete: "047",
    doc_delete: "049",
    doc_request_participant: "060",
    doc_reject_participant: "061",
    doc_accept_participant: "062",
    doc_rerequest_participant: "063",
    doc_open_participant: "064",
    doc_request_reviewer: "070",
    doc_reject_reviewer: "071",
    doc_accept_reviewer: "072",
    doc_expired: "080",
    face_signature_complete: "092",
};

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
        // External API use cases
        private readonly getEformsignAccessTokenUsecase: GetEformsignAccessTokenUsecase,
        private readonly refreshEformsignAccessTokenUsecase: RefreshEformsignAccessTokenUsecase,
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

    /**
     * Find all stored eformsign docs linked to a client
     */
    async findByClientId(branchid: string, clientId: number): Promise<EformsignDocEntity[]> {
        const docs = await this.findEformsignDocsByClientIdUsecase.execute(branchid, clientId);
        return this.refreshDocsFromApiBestEffort(branchid, docs);
    }

    /**
     * List all stored eformsign docs
     */
    findAll(branchid: string): Promise<EformsignDocEntity[]> {
        return this.listEformsignDocsUsecase.execute(branchid);
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
     * Get access token from eformsign API
     * @param executionTime - timestamp used for signature generation
     * @param memberEmail - optional member email (uses default if not provided)
     */
    getAccessToken(executionTime: number, memberEmail?: string): Promise<EformsignTokenResponse> {
        return this.getEformsignAccessTokenUsecase.execute(executionTime, memberEmail);
    }

    /**
     * Refresh access token using refresh token
     * @param executionTime - timestamp used for signature generation
     * @param refreshToken - the refresh token from previous token response
     */
    refreshAccessToken(executionTime: number, refreshToken: string): Promise<EformsignTokenResponse> {
        return this.refreshEformsignAccessTokenUsecase.execute(executionTime, refreshToken);
    }

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
        const statusType = this.normalizeStatusCode(currentStatus?.status_type);

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
        params: CreateAndSendContractParams
    ): Promise<CreateAndSendContractResult> {
        return this.createAndSendContractUsecase.execute(branchid, params);
    }

    private normalizeStatusCode(statusType: string | null | undefined): string {
        const normalized = statusType?.trim().toLowerCase();
        if (!normalized) {
            return "000";
        }

        return STATUS_NAME_TO_CODE[normalized] ?? normalized.padStart(3, "0");
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

    private async refreshDocsFromApiBestEffort(
        branchid: string,
        docs: EformsignDocEntity[],
    ): Promise<EformsignDocEntity[]> {
        if (docs.length === 0) {
            return docs;
        }

        let accessToken: string;
        try {
            const tokenResponse = await this.getEformsignAccessTokenUsecase.execute(Date.now());
            accessToken = tokenResponse.oauth_token.access_token;
        } catch (error) {
            this.logger.warn(`Failed to get eformsign access token for client doc refresh: ${error}`);
            return docs;
        }

        return Promise.all(
            docs.map(async (doc) => {
                try {
                    return await this.syncStatusFromApi(branchid, accessToken, doc.documentId);
                } catch (error) {
                    this.logger.warn(`Failed to refresh eformsign doc ${doc.documentId}: ${error}`);
                    return doc;
                }
            }),
        );
    }

    private async linkDocumentToClientBestEffort(branchid: string, documentId: string): Promise<void> {
        try {
            await this.linkDocumentToClientUsecase.execute(branchid, documentId);
        } catch (error) {
            this.logger.warn(`Failed to link eformsign doc ${documentId} to client: ${error}`);
        }
    }
}
