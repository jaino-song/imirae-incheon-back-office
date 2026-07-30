import { Inject, Injectable, Logger, Optional } from "@nestjs/common";

import { EformsignDocumentSnapshotService } from "application/services/eformsign-document-snapshot.service";
import { documentCustomerNameValue } from "application/utils/eformsign-document-customer-name";
import { eformsignDocumentTemplateId } from "application/utils/eformsign-document-template-id";
import {
    EFORMSIGN_EXPIRED_STATUS_CODE,
    EFORMSIGN_TERMINAL_STATUS_DETAILS,
    TERMINAL_STATUS_CODES,
} from "domain/constants/eformsign-doc-status.constants";
import { EformsignDocEntity } from "domain/entities/eformsign-doc.entity";
import {
    EFORMSIGN_DOC_REPOSITORY,
    IEformsignDocRepository,
} from "domain/repositories/eformsign-doc.repository.interface";
import { EformsignApiDocumentResponse } from "domain/repositories/eformsign.client.interface";
import { eformsignExpiryDateFromRemainingDays } from "domain/utils/eformsign-expiry-date";
import { normalizeEformsignStatusCode } from "domain/utils/eformsign-status-code";

import { FetchEformsignDocFromApiUsecase } from "./fetch-eformsign-doc-from-api.usecase";
import { GetEformsignAccessTokenUsecase } from "./get-eformsign-access-token.usecase";

export interface MirrorRemoteEformsignDocumentOptions {
    allowAssignedUpdate?: boolean;
    fallbackDocumentId?: string;
    now?: number;
}

@Injectable()
export class MirrorUnassignedEformsignDocUsecase {
    private readonly logger = new Logger(MirrorUnassignedEformsignDocUsecase.name);

    constructor(
        private readonly getAccessTokenUsecase: GetEformsignAccessTokenUsecase,
        private readonly fetchEformsignDocFromApiUsecase: FetchEformsignDocFromApiUsecase,
        @Inject(EFORMSIGN_DOC_REPOSITORY)
        private readonly eformsignDocRepository: IEformsignDocRepository,
        @Optional()
        private readonly documentSnapshotService?: EformsignDocumentSnapshotService,
    ) {}

    async execute(documentId: string): Promise<EformsignDocEntity> {
        const now = Date.now();
        const token = await this.getAccessTokenUsecase.execute(now);
        const remote = await this.fetchEformsignDocFromApiUsecase.execute(
            token.oauth_token.access_token,
            documentId,
        );
        return this.mirrorRemoteDocument(remote, {
            fallbackDocumentId: documentId,
            now,
        });
    }

    async mirrorRemoteDocument(
        remote: EformsignApiDocumentResponse,
        options: MirrorRemoteEformsignDocumentOptions = {},
    ): Promise<EformsignDocEntity> {
        const now = options.now ?? Date.now();
        const fallbackDocumentId = options.fallbackDocumentId ?? remote.id;
        const recipient = remote.current_status.step_recipients?.[0];
        const statusType = normalizeEformsignStatusCode(remote.current_status.status_type);
        // The list schema has no _expired, so a document that expired before we ever
        // mirrored it would be created as not-expired while its own status says otherwise.
        // The status still tells us, but only in one direction: 080 means expired, and
        // anything else means the list simply did not say.
        const expiredFromStatus = statusType === EFORMSIGN_EXPIRED_STATUS_CODE;
        const hasRemoteExpiredState = remote.current_status._expired !== undefined;
        // A terminal status settles the question both ways: 080 means expired, and any
        // other ending — completed, rejected, revoked — means it is not. Only the open
        // states leave it genuinely unknown. Without the negative direction, a row the
        // hourly expiry pass guessed wrong about would keep expired=true even after this
        // sweep learned the document had actually completed, and nothing would clear it.
        const knowsExpiredState = hasRemoteExpiredState
            || TERMINAL_STATUS_CODES.has(statusType);
        // A list response carries no detail, so a document whose ending we only learn
        // from this sweep would otherwise keep whatever it read while it was open. The
        // status code says plainly what happened for the endings we can name.
        const terminalStatusDetail = EFORMSIGN_TERMINAL_STATUS_DETAILS[statusType];
        const remoteUpdatedDate = new Date(remote.updated_date);
        const updatedDate = Number.isNaN(remoteUpdatedDate.getTime())
            ? new Date(now)
            : remoteUpdatedDate;
        if (Number.isNaN(remoteUpdatedDate.getTime())) {
            this.logger.warn(
                `Invalid remote updated_date for eformsign document ${remote.id || fallbackDocumentId}; using current time`,
            );
        }

        const remoteCreatedDate = new Date(remote.created_date);
        const hasRemoteCreatedDate = !Number.isNaN(remoteCreatedDate.getTime());
        const createdDate = hasRemoteCreatedDate
            ? remoteCreatedDate
            : new Date(updatedDate);
        if (Number.isNaN(remoteCreatedDate.getTime())) {
            this.logger.warn(
                `Invalid remote created_date for eformsign document ${remote.id || fallbackDocumentId}; using updated_date`,
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
                `Remote updated_date precedes created_date for eformsign document ${remote.id || fallbackDocumentId}; clamping to created_date`,
            );
        }

        const doc = EformsignDocEntity.create({
            documentId: remote.id || fallbackDocumentId,
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
            statusType,
            statusDetail:
                remote.current_status.status_doc_detail
                || terminalStatusDetail
                || remote.current_status.step_name
                || "진행중",
            stepType: remote.current_status.step_type.trim() || "01",
            stepIndex: remote.current_status.step_index.trim() || "1",
            stepName: remote.current_status.step_name.trim() || "서명 요청",
            stepRecipientType: recipient?.recipient_type.trim() || "01",
            stepRecipientName: recipient?.name.trim() || remote.document_name || "수신자",
            stepRecipientSms: recipient?.sms?.trim() || recipient?.id.trim() || "미확인",
            expiredDate: eformsignExpiryDateFromRemainingDays(
                remote.current_status.expired_date,
                now,
            ),
            expired: remote.current_status._expired ?? expiredFromStatus,
            clientId: null,
            documentKind: null,
            employeeScheduleId: null,
            templateId: eformsignDocumentTemplateId(remote),
        });

        const mirrored = await this.eformsignDocRepository.upsertUnassignedByDocumentId(doc, {
            ...(options.allowAssignedUpdate ? { allowAssignedUpdate: true } : {}),
            updateListDisplayFields: true,
            ...(knowsExpiredState ? {} : { updateExpired: false }),
            // A detail derived from the step name must not replace one a webhook wrote —
            // but one derived from a terminal status code must, because the stored detail
            // describes a state the document has already left.
            ...(remote.current_status.status_doc_detail === undefined
                && terminalStatusDetail === undefined
                ? { updateStatusDetail: false }
                : {}),
            // The list has no expired_date either, so what we computed is only a fallback.
            ...(remote.current_status.expired_date === undefined
                ? { updateExpiredDate: false }
                : {}),
            // Creation time is the list's sort key. The create and adopt paths store the
            // moment we wrote the row, so a document adopted long after it was created
            // sorts in the wrong place forever unless a response that really carries
            // created_date puts it right. Only a clamped-away value is not worth writing.
            ...(hasRemoteCreatedDate ? {} : { updateCreatedDate: false }),
        });
        await this.invalidateDocumentSnapshots(doc.documentId);
        return mirrored;
    }

    private async invalidateDocumentSnapshots(documentId: string): Promise<void> {
        if (!this.documentSnapshotService) {
            return;
        }

        try {
            const branchId =
                await this.eformsignDocRepository.findBranchIdByDocumentId(documentId);
            if (branchId) {
                await this.documentSnapshotService.bumpVersion(branchId);
            } else {
                await this.documentSnapshotService.bumpCompanyEpoch();
            }
        } catch {
            // The database write is authoritative. A cache-version failure must not
            // turn a successful webhook/sweep/backfill mirror into a retryable failure.
            this.logger.warn(
                `Failed to invalidate document snapshots after mirroring ${documentId}`,
            );
        }
    }
}
