import { Inject, Injectable, Logger } from "@nestjs/common";
import { CLIENT_REPOSITORY, IClientRepository } from "domain/repositories/client.repository.interface";
import { EFORMSIGN_CLIENT_REPOSITORY, IEformsignClientRepository } from "domain/repositories/eformsign.client.interface";
import { EFORMSIGN_DOC_REPOSITORY, IEformsignDocRepository } from "domain/repositories/eformsign-doc.repository.interface";
import { sanitizeEformsignErrorMessage } from "application/utils/eformsign-error-message";
import { EFORMSIGN_END_DATE_FIELD_IDS } from "./eformsign-end-date-field-ids";

export interface SyncedClientEndDate {
    clientId: number;
    endDate: Date;
}

export interface SyncClientEndDateOptions {
    persist?: (target: SyncedClientEndDate) => Promise<void>;
    /** Re-throw repository/lifecycle failures after logging for strict webhook reconciliation. */
    throwOnError?: boolean;
}

@Injectable()
export class SyncClientEndDateUsecase {
    private readonly logger = new Logger(SyncClientEndDateUsecase.name);

    constructor(
        @Inject(EFORMSIGN_CLIENT_REPOSITORY)
        private readonly eformsignClient: IEformsignClientRepository,
        @Inject(EFORMSIGN_DOC_REPOSITORY)
        private readonly eformsignDocRepository: IEformsignDocRepository,
        @Inject(CLIENT_REPOSITORY)
        private readonly clientRepository: IClientRepository,
    ) {}

    async execute(
        branchId: string,
        documentId: string,
        accessToken: string,
        options: SyncClientEndDateOptions = {},
    ): Promise<SyncedClientEndDate | undefined> {
        try {
            const document = await this.eformsignClient.getDocument(accessToken, documentId);
            return await this.executeFromDocument(
                branchId,
                documentId,
                document,
                options,
            );
        } catch (error) {
            this.logger.error(
                `Failed to sync client endDate for document ${documentId}: ${sanitizeEformsignErrorMessage(error)}`,
            );
            if (options.throwOnError) {
                throw error;
            }
            return undefined;
        }
    }

    async executeFromDocument(
        branchId: string,
        documentId: string,
        document: Awaited<ReturnType<IEformsignClientRepository["getDocument"]>>,
        options: SyncClientEndDateOptions = {},
    ): Promise<SyncedClientEndDate | undefined> {
        try {
            const fields = document.fields ?? [];

            const findValue = (fieldId: string) => fields.find((field) => field.id === fieldId)?.value;
            const yearStr = findValue(EFORMSIGN_END_DATE_FIELD_IDS.year);
            const monthStr = findValue(EFORMSIGN_END_DATE_FIELD_IDS.month);
            const dayStr = findValue(EFORMSIGN_END_DATE_FIELD_IDS.day);

            if (!yearStr || !monthStr || !dayStr) {
                this.logger.warn(
                    `End date fields missing or empty on document ${documentId}; skipping client.endDate sync.`
                );
                return;
            }

            const year = Number(yearStr);
            const month = Number(monthStr);
            const day = Number(dayStr);

            if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
                this.logger.warn(
                    `Could not parse end date numeric values on document ${documentId}; skipping client.endDate sync.`
                );
                return;
            }

            const endDate = new Date(Date.UTC(year, month - 1, day));
            const isSameDate =
                endDate.getUTCFullYear() === year &&
                endDate.getUTCMonth() === month - 1 &&
                endDate.getUTCDate() === day;

            if (!isSameDate) {
                this.logger.warn(`Invalid end date values on document ${documentId}; skipping client.endDate sync.`);
                return;
            }

            const doc = await this.eformsignDocRepository.findByDocumentId(branchId, documentId);
            if (!doc) {
                this.logger.warn(`eformsign_doc not found for ${documentId}; cannot sync client.endDate.`);
                return;
            }
            if (doc.clientId === null) {
                this.logger.log(`Document ${documentId} belongs to a deleted client; skipping endDate sync.`);
                return;
            }

            const client = await this.clientRepository.findById(branchId, doc.clientId);
            if (!client) {
                this.logger.warn(`Client ${doc.clientId} not found for document ${documentId}; cannot sync endDate.`);
                return;
            }

            const target = { clientId: doc.clientId, endDate };
            if (options.persist) {
                await options.persist(target);
            } else {
                client.update({ endDate });
                await this.clientRepository.update(branchId, client);
            }

            this.logger.log(`Synced client ${doc.clientId} endDate from document ${documentId}.`);
            return target;
        } catch (error) {
            this.logger.error(
                `Failed to sync client endDate for document ${documentId}: ${sanitizeEformsignErrorMessage(error)}`,
            );
            if (options.throwOnError) {
                throw error;
            }
            return undefined;
        }
    }
}
