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
                const message = `End date fields missing or empty on document ${documentId}; skipping client.endDate sync.`;
                this.logger.warn(message);
                if (options.throwOnError) throw new Error(message);
                return;
            }

            const rawYear = Number(yearStr);
            // Regional contract templates print `20` outside the input field and
            // therefore persist a two-digit year (some vendor responses pad it as
            // `026`). Treat any 0-99 numeric value as 2000-2099.
            const year = Number.isInteger(rawYear) && rawYear >= 0 && rawYear <= 99
                ? 2000 + rawYear
                : rawYear;
            const month = Number(monthStr);
            const day = Number(dayStr);

            if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
                const message = `Could not parse end date numeric values on document ${documentId}; skipping client.endDate sync.`;
                this.logger.warn(message);
                if (options.throwOnError) throw new Error(message);
                return;
            }

            const endDate = new Date(Date.UTC(year, month - 1, day));
            const isSameDate =
                endDate.getUTCFullYear() === year &&
                endDate.getUTCMonth() === month - 1 &&
                endDate.getUTCDate() === day;

            if (!isSameDate) {
                const message = `Invalid end date values on document ${documentId}; skipping client.endDate sync.`;
                this.logger.warn(message);
                if (options.throwOnError) throw new Error(message);
                return;
            }

            const doc = await this.eformsignDocRepository.findByDocumentId(branchId, documentId);
            if (!doc) {
                const message = `eformsign_doc not found for ${documentId}; cannot sync client.endDate.`;
                this.logger.warn(message);
                if (options.throwOnError) throw new Error(message);
                return;
            }
            if (doc.clientId === null) {
                this.logger.log(`Document ${documentId} belongs to a deleted client; skipping endDate sync.`);
                return;
            }

            const client = await this.clientRepository.findById(branchId, doc.clientId);
            if (!client) {
                const message = `Client ${doc.clientId} not found for document ${documentId}; cannot sync endDate.`;
                this.logger.warn(message);
                if (options.throwOnError) throw new Error(message);
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
