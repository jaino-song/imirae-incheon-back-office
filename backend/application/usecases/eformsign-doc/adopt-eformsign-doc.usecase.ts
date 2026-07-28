import { Inject, Injectable } from "@nestjs/common";

import { EFORMSIGN_DOCUMENT_KIND } from "domain/entities/eformsign-doc.entity";
import { CLIENT_REPOSITORY, IClientRepository } from "domain/repositories/client.repository.interface";

import { CreateEformsignDocResult, CreateEformsignDocUsecase } from "./create-eformsign-doc.usecase";
import { FetchEformsignDocFromApiUsecase } from "./fetch-eformsign-doc-from-api.usecase";
import { GetEformsignAccessTokenUsecase } from "./get-eformsign-access-token.usecase";

const DEFAULT_DOCUMENT_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;

export interface AdoptEformsignDocParams {
    documentId: string;
    clientId?: number;
}

@Injectable()
export class AdoptEformsignDocUsecase {
    constructor(
        private readonly getAccessTokenUsecase: GetEformsignAccessTokenUsecase,
        private readonly fetchEformsignDocFromApiUsecase: FetchEformsignDocFromApiUsecase,
        private readonly createEformsignDocUsecase: CreateEformsignDocUsecase,
        @Inject(CLIENT_REPOSITORY) private readonly clientRepository: IClientRepository,
    ) {}

    async execute(branchId: string, params: AdoptEformsignDocParams): Promise<CreateEformsignDocResult> {
        const token = await this.getAccessTokenUsecase.execute(Date.now());
        const remote = await this.fetchEformsignDocFromApiUsecase.execute(
            token.oauth_token.access_token,
            params.documentId,
        );
        const recipient = remote.current_status.step_recipients?.[0];

        const clientId = params.clientId ?? (recipient?.id
            ? (await this.clientRepository.findByPhone(branchId, recipient.id))?.id
            : undefined);
        if (!clientId) {
            throw new Error("clientId가 필요합니다.");
        }

        return this.createEformsignDocUsecase.execute(branchId, {
            documentId: remote.id || params.documentId,
            clientId,
            statusType: remote.current_status.status_type || "000",
            statusDetail: remote.current_status.status_doc_detail || remote.current_status.step_name || "진행중",
            stepType: remote.current_status.step_type || "01",
            stepIndex: remote.current_status.step_index || "1",
            stepName: remote.current_status.step_name || "서명 요청",
            stepRecipientType: recipient?.recipient_type || "01",
            stepRecipientName: recipient?.name || remote.document_name || "수신자",
            stepRecipientSms: recipient?.id || "미확인",
            expiredDate: remote.current_status.expired_date
                ? new Date(remote.current_status.expired_date)
                : new Date(Date.now() + DEFAULT_DOCUMENT_EXPIRY_MS),
            linkToClient: true,
            documentKind: EFORMSIGN_DOCUMENT_KIND.CONTRACT,
            templateId: remote.template?.id ?? null,
            documentName: remote.document_name,
        });
    }
}
