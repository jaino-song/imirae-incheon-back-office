import { Inject, Injectable, Logger } from "@nestjs/common";

import { EformsignDocumentMirrorService } from "application/services/eformsign-document-mirror.service";
import { documentCustomerNameValue } from "application/utils/eformsign-document-customer-name";
import { EFORMSIGN_DOCUMENT_KIND } from "domain/entities/eformsign-doc.entity";
import { CLIENT_REPOSITORY, IClientRepository } from "domain/repositories/client.repository.interface";
import { eformsignExpiryDateFromRemainingDays } from "domain/utils/eformsign-expiry-date";
import { normalizeEformsignStatusCode } from "domain/utils/eformsign-status-code";

import { CreateEformsignDocResult, CreateEformsignDocUsecase } from "./create-eformsign-doc.usecase";
import { FetchEformsignDocFromApiUsecase } from "./fetch-eformsign-doc-from-api.usecase";
import { GetEformsignAccessTokenUsecase } from "./get-eformsign-access-token.usecase";

export interface AdoptEformsignDocParams {
    documentId: string;
    clientId?: number;
}

@Injectable()
export class AdoptEformsignDocUsecase {
    private readonly logger = new Logger(AdoptEformsignDocUsecase.name);

    constructor(
        private readonly getAccessTokenUsecase: GetEformsignAccessTokenUsecase,
        private readonly fetchEformsignDocFromApiUsecase: FetchEformsignDocFromApiUsecase,
        private readonly createEformsignDocUsecase: CreateEformsignDocUsecase,
        @Inject(CLIENT_REPOSITORY) private readonly clientRepository: IClientRepository,
        private readonly documentMirrorService: EformsignDocumentMirrorService,
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

        const result = await this.createEformsignDocUsecase.execute(branchId, {
            documentId: remote.id || params.documentId,
            clientId,
            statusType: normalizeEformsignStatusCode(remote.current_status.status_type),
            statusDetail: remote.current_status.status_doc_detail || remote.current_status.step_name || "진행중",
            stepType: remote.current_status.step_type || "01",
            stepIndex: remote.current_status.step_index || "1",
            stepName: remote.current_status.step_name || "서명 요청",
            stepRecipientType: recipient?.recipient_type || "01",
            stepRecipientName: recipient?.name || remote.document_name || "수신자",
            stepRecipientSms: recipient?.id || "미확인",
            expiredDate: eformsignExpiryDateFromRemainingDays(
                remote.current_status.expired_date,
                Date.now(),
            ),
            linkToClient: true,
            // Existing ready detail/PDFs describe the stored projection. Assign
            // ownership first, but let the fenced mirror sync below publish the
            // newly fetched vendor projection only after its artifacts are ready.
            preserveExistingMirrorProjection: true,
            documentKind: EFORMSIGN_DOCUMENT_KIND.CONTRACT,
            templateId: remote.template?.id ?? null,
            documentName: remote.document_name,
            templateName: remote.template?.name ?? null,
            customerName: documentCustomerNameValue(remote),
            creatorName: remote.creator?.name ?? null,
            lastEditorName: remote.last_editor?.name ?? null,
            stepRecipientTypes: remote.current_status.step_recipients
                ?.map((item) => item.recipient_type)
                ?? null,
        });

        try {
            await this.documentMirrorService.syncDocumentWithToken(
                token.oauth_token.access_token,
                remote.id || params.documentId,
                { expectedUpdatedDate: remote.updated_date },
            );
        } catch {
            // Ownership and client linkage were committed above. Returning a failure
            // here would tell the caller to retry an adoption that already succeeded.
            // Keep the row non-ready and expose a machine-readable warning so callers
            // cannot report the local detail/PDF mirror as complete. The durable failed
            // state remains eligible for an operational reconciliation without claiming
            // that a scheduler or distributed lock is currently available.
            this.logger.warn(
                "Eformsign adoption committed, but the local mirror remains incomplete",
            );
            return Object.assign(result, {
                warnings: [
                    ...(result.warnings ?? []),
                    "mirror_sync_failed" as const,
                ],
            });
        }

        return result;
    }
}
