import { Inject, Injectable, Logger } from "@nestjs/common";

import { documentCustomerNameValue } from "application/utils/eformsign-document-customer-name";
import { EformsignDocEntity } from "domain/entities/eformsign-doc.entity";
import {
    EFORMSIGN_DOC_REPOSITORY,
    IEformsignDocRepository,
} from "domain/repositories/eformsign-doc.repository.interface";

import { FetchEformsignDocFromApiUsecase } from "./fetch-eformsign-doc-from-api.usecase";
import { GetEformsignAccessTokenUsecase } from "./get-eformsign-access-token.usecase";

const DEFAULT_DOCUMENT_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;

@Injectable()
export class MirrorUnassignedEformsignDocUsecase {
    private readonly logger = new Logger(MirrorUnassignedEformsignDocUsecase.name);

    constructor(
        private readonly getAccessTokenUsecase: GetEformsignAccessTokenUsecase,
        private readonly fetchEformsignDocFromApiUsecase: FetchEformsignDocFromApiUsecase,
        @Inject(EFORMSIGN_DOC_REPOSITORY)
        private readonly eformsignDocRepository: IEformsignDocRepository,
    ) {}

    async execute(documentId: string): Promise<EformsignDocEntity> {
        const now = Date.now();
        const token = await this.getAccessTokenUsecase.execute(now);
        const remote = await this.fetchEformsignDocFromApiUsecase.execute(
            token.oauth_token.access_token,
            documentId,
        );
        const recipient = remote.current_status.step_recipients?.[0];
        const remoteUpdatedDate = new Date(remote.updated_date);
        const updatedDate = Number.isNaN(remoteUpdatedDate.getTime())
            ? new Date(now)
            : remoteUpdatedDate;
        if (Number.isNaN(remoteUpdatedDate.getTime())) {
            this.logger.warn(
                `Invalid remote updated_date for eformsign document ${remote.id || documentId}; using current time`,
            );
        }

        const remoteCreatedDate = new Date(remote.created_date);
        const createdDate = Number.isNaN(remoteCreatedDate.getTime())
            ? new Date(updatedDate)
            : remoteCreatedDate;
        if (Number.isNaN(remoteCreatedDate.getTime())) {
            this.logger.warn(
                `Invalid remote created_date for eformsign document ${remote.id || documentId}; using updated_date`,
            );
        }

        // The entity rejects updatedDate < createdDate, and a mirror failure is swallowed
        // by the caller so nothing would retry it — a document eformsign reports with the
        // two out of order would never make it into the mirror at all. The webhook path
        // clamps the same way.
        const clampedUpdatedDate = new Date(
            Math.max(updatedDate.getTime(), createdDate.getTime()),
        );
        if (clampedUpdatedDate.getTime() !== updatedDate.getTime()) {
            this.logger.warn(
                `Remote updated_date precedes created_date for eformsign document ${remote.id || documentId}; clamping to created_date`,
            );
        }

        const doc = EformsignDocEntity.create({
            documentId: remote.id || documentId,
            documentName: remote.document_name || null,
            documentNumber: remote.document_number || null,
            templateName: remote.template?.name?.trim() || null,
            customerName: documentCustomerNameValue(remote),
            creatorName: remote.creator?.name?.trim() || null,
            lastEditorName: remote.last_editor?.name?.trim() || null,
            stepRecipientTypes: remote.current_status.step_recipients?.length
                ? remote.current_status.step_recipients.map((item) => item.recipient_type)
                : null,
            createdDate,
            updatedDate: clampedUpdatedDate,
            statusType: remote.current_status.status_type || "000",
            statusDetail:
                remote.current_status.status_doc_detail
                || remote.current_status.step_name
                || "진행중",
            stepType: remote.current_status.step_type || "01",
            stepIndex: remote.current_status.step_index || "1",
            stepName: remote.current_status.step_name || "서명 요청",
            stepRecipientType: recipient?.recipient_type || "01",
            stepRecipientName: recipient?.name || remote.document_name || "수신자",
            stepRecipientSms: recipient?.id || "미확인",
            expiredDate: remote.current_status.expired_date
                ? new Date(remote.current_status.expired_date)
                : new Date(now + DEFAULT_DOCUMENT_EXPIRY_MS),
            expired: remote.current_status._expired ?? false,
            clientId: null,
            documentKind: null,
            employeeScheduleId: null,
            templateId: remote.template?.id ?? null,
        });

        return this.eformsignDocRepository.upsertUnassignedByDocumentId(doc, {
            updateListDisplayFields: true,
        });
    }
}
