import { BadRequestException, Injectable, Logger, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";

import { MessageTriggerService } from "application/services/message-trigger.service";
import { persistClientMessageAutomationIntent, persistScheduleMessageAutomationIntent } from "application/services/message-automation-intent-writer";
import { fulfillClientMessageAutomationIntent } from "application/services/client-message-automation-intent-fulfiller";
import { ServiceRecordLifecycleService } from "application/services/service-record-lifecycle.service";
import { SystemSettingService } from "application/services/system-setting.service";
import {
    EformsignContractClientCandidate,
    extractEformsignContractClientCandidate,
    formatNormalizedKoreanPhone,
    toEformsignDocumentDetail,
} from "application/utils/eformsign-contract-client-candidate";
import {
    assertRequiredPhone,
    assertValidPhone,
    extractPhoneCandidates,
    InvalidPhoneError,
    normalizePhone,
} from "application/utils/normalize-phone";
import {
    configuredServiceRecordTemplateIds,
    isServiceRecordEformsignDocument,
} from "application/utils/eformsign-document-kind";
import { EFORMSIGN_DOCUMENT_KIND } from "domain/entities/eformsign-doc.entity";
import { DEFAULT_EMPLOYEE_GRADE } from "domain/constants/employee-grade.constants";
import { EformsignApiDocumentResponse } from "domain/repositories/eformsign.client.interface";
import { normalizeClientPricing } from "domain/services/client-pricing";
import { computeServiceStatus } from "domain/value-objects/service-status.vo";
import {
    assertClientDurationMatchesDates,
    deriveClientDuration,
} from "application/usecases/client/client-write-validation";
import { PrismaService } from "infrastructure/database/prisma.service";

const AUTO_REGISTRATION_ELIGIBLE_STATUS_CODES = new Set([
    // 001 is only a temporary save. Start from the first durable document state.
    "002",
    "003",
    "010",
    "012",
    "020",
    "022",
    "030",
    "032",
    "043",
    "050",
    "060",
    "062",
    "063",
    "064",
    "070",
    "072",
    "092",
]);
const PHONE_LOOKUP_SUFFIX_LENGTH = 4;
const MAX_TRANSACTION_ATTEMPTS = 3;

export type LinkMirroredEformsignDocResult =
    | "created"
    | "linked"
    | "already_linked"
    | "ambiguous"
    | "no_match"
    | "no_branch"
    | "disabled"
    | "not_completed"
    | "mirror_not_ready"
    | "skipped";

export interface LinkMirroredEformsignDocOptions {
    /**
     * Initial historical imports still link/create clients, but must not enqueue
     * greeting or catch-up message jobs for records that predate the cutover.
     */
    suppressOutboundAutomation?: boolean;
    /**
     * The mirror generation is not ready yet. Only let an already registered
     * client claim the document; never create a client from this attempt.
     */
    linkExistingOnly?: boolean;
}

/**
 * Internal fence carried by the mirror reconciler. Callers that do not originate
 * from a durable mirror reconciliation deliberately omit it to retain their
 * existing direct-webhook behavior.
 */
export interface ExpectedEformsignMirrorGeneration {
    detailSourceUpdatedDate: Date;
    detailSyncedAt: Date;
    readiness?: "complete" | "detail";
}

interface TransactionResult {
    status: LinkMirroredEformsignDocResult;
    createdClientId?: number;
    createdBranchId?: string;
}

/**
 * Reconciles a locally mirrored contract with its client.
 *
 * Existing clients can claim an unassigned document because their branch already
 * supplies the tenant boundary. A new client is created from the first durable
 * document state when its document has an owning branch and that branch policy
 * explicitly allows automatic registration. Temporary saves and terminal-
 * negative documents never create clients.
 */
@Injectable()
export class LinkMirroredEformsignDocByPhoneUsecase {
    private readonly logger = new Logger(LinkMirroredEformsignDocByPhoneUsecase.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly configService: ConfigService,
        private readonly systemSettingService: SystemSettingService,
        @Optional()
        private readonly messageTriggerService?: MessageTriggerService,
        @Optional()
        private readonly serviceRecordLifecycleService?: ServiceRecordLifecycleService,
    ) {}

    async execute(
        documentId: string,
        options: LinkMirroredEformsignDocOptions = {},
        expectedMirrorGeneration?: ExpectedEformsignMirrorGeneration,
    ): Promise<LinkMirroredEformsignDocResult> {
        const document = await this.prisma.eformsign_doc.findUnique({
            where: { documentId },
            select: {
                id: true,
                documentId: true,
                documentKind: true,
                serviceRecordCaseId: true,
                templateId: true,
                templateName: true,
                stepRecipientSms: true,
                customerPhone: true,
                detailPayload: true,
                statusType: true,
                branchId: true,
                clientId: true,
                createdDate: true,
            },
        });
        if (!document) {
            return "no_match";
        }
        if (this.isServiceRecord(document)) {
            return "skipped";
        }
        const assignedClientId = document.clientId;
        if (assignedClientId !== null) {
            const result = await this.repairAssignedDocument({
                id: document.id,
                documentId: document.documentId,
                branchId: document.branchId,
                clientId: assignedClientId,
                createdDate: document.createdDate,
            }, expectedMirrorGeneration);
            if (result !== "mirror_not_ready" && !options.linkExistingOnly) {
                const postLinkApplied = await this.applyPostLinkEffects({
                    documentId,
                    clientId: assignedClientId,
                    expectedMirrorGeneration,
                });
                if (!postLinkApplied) return "mirror_not_ready";
            }
            return result;
        }

        const detail = toEformsignDocumentDetail(document.detailPayload);
        const candidate = detail
            ? extractEformsignContractClientCandidate(detail)
            : null;
        const phone = document.customerPhone
            ?? candidate?.phone
            ?? singleLegacyPhone(document.stepRecipientSms, detail !== null);
        if (!phone) {
            return "no_match";
        }
        try {
            assertValidPhone(phone);
        } catch (error) {
            if (error instanceof InvalidPhoneError) {
                throw new BadRequestException("customerPhone must be a valid Korean phone number");
            }
            throw error;
        }

        if (
            candidate?.startDate
            && candidate.endDate
            && candidate.startDate > candidate.endDate
        ) {
            this.logger.warn(
                `[EFORMSIGN_CLIENT_INVALID_PERIOD] 문서 ${documentId}의 서비스 시작일이 종료일보다 늦어 자동등록을 건너뜁니다.`,
            );
            return "skipped";
        }

        const creationBranchId = options.linkExistingOnly
            ? null
            : AUTO_REGISTRATION_ELIGIBLE_STATUS_CODES.has(document.statusType)
                && candidate?.phone === phone
                ? await this.resolveAutoRegistrationBranch(
                    document.branchId,
                    detail,
                )
                : null;
        const canCreate = creationBranchId !== null;
        const suppressGreetingSms =
            options.suppressOutboundAutomation
            || (
                canCreate
                    ? !await this.systemSettingService
                        .getGreetingOnAutoRegistrationEnabled(creationBranchId)
                    : true
            );

        const result = await this.runTransactionWithRetry({
            documentId,
            phone,
            canCreate,
            creationBranchId,
            suppressGreetingSms,
            applyMessageAutomation: !options.suppressOutboundAutomation,
            intentAt: new Date(),
            expectedMirrorGeneration,
        });
        if (
            result.status === "created"
            && result.createdClientId !== undefined
            && result.createdBranchId !== undefined
        ) {
            const postLinkApplied = await this.applyPostLinkEffects({
                documentId,
                clientId: result.createdClientId,
                expectedMirrorGeneration,
                creation: {
                    branchId: result.createdBranchId,
                    suppressGreetingSms,
                    suppressOutboundAutomation: Boolean(options.suppressOutboundAutomation),
                },
            });
            if (!postLinkApplied) return "mirror_not_ready";
        }
        return result.status;
    }

    private async applyPostLinkEffects(params: {
        documentId: string;
        clientId: number;
        expectedMirrorGeneration?: ExpectedEformsignMirrorGeneration;
        creation?: {
            branchId: string;
            suppressGreetingSms: boolean;
            suppressOutboundAutomation: boolean;
        };
    }): Promise<boolean> {
        if (!params.expectedMirrorGeneration) {
            await this.ensureServiceRecordLifecycle(params.clientId);
            if (params.creation && !params.creation.suppressOutboundAutomation) {
                await this.applyClientCreationAutomation(
                    params.creation.branchId,
                    params.clientId,
                    params.creation.suppressGreetingSms,
                );
            }
            return true;
        }

        return this.prisma.$transaction(async (transaction) => {
            if (!await this.lockExpectedMirrorGeneration(
                transaction,
                params.documentId,
                params.expectedMirrorGeneration,
            )) {
                return false;
            }
            await this.ensureServiceRecordLifecycle(
                params.clientId,
                transaction,
                true,
            );
            if (params.creation && !params.creation.suppressOutboundAutomation) {
                await this.applyClientCreationAutomation(
                    params.creation.branchId,
                    params.clientId,
                    params.creation.suppressGreetingSms,
                );
            }
            return true;
        });
    }

    private async runTransactionWithRetry(params: {
        documentId: string;
        phone: string;
        canCreate: boolean;
        creationBranchId: string | null;
        suppressGreetingSms: boolean;
        applyMessageAutomation: boolean;
        intentAt: Date;
        expectedMirrorGeneration?: ExpectedEformsignMirrorGeneration;
    }): Promise<TransactionResult> {
        let lastError: unknown;
        for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
            try {
                return await this.prisma.$transaction(
                    async (transaction) => {
                        await transaction.$executeRaw`
                            SELECT pg_advisory_xact_lock(
                                hashtextextended(
                                    ${`eformsign-client:${params.phone}`},
                                    0
                                )
                            )
                        `;

                        if (!await this.lockExpectedMirrorGeneration(
                            transaction,
                            params.documentId,
                            params.expectedMirrorGeneration,
                        )) {
                            return { status: "mirror_not_ready" };
                        }

                        const document = await transaction.eformsign_doc.findUnique({
                            where: { documentId: params.documentId },
                            select: {
                                id: true,
                                documentId: true,
                                documentKind: true,
                                serviceRecordCaseId: true,
                                templateId: true,
                                templateName: true,
                                stepRecipientSms: true,
                                customerPhone: true,
                                detailPayload: true,
                                statusType: true,
                                branchId: true,
                                clientId: true,
                                createdDate: true,
                            },
                        });
                        if (!document) return { status: "no_match" };
                        if (this.isServiceRecord(document)) return { status: "skipped" };
                        if (document.clientId !== null) return { status: "already_linked" };

                        const detail = toEformsignDocumentDetail(document.detailPayload);
                        const candidate = detail
                            ? extractEformsignContractClientCandidate(detail)
                            : null;
                        const currentPhone = document.customerPhone
                            ?? candidate?.phone
                            ?? singleLegacyPhone(document.stepRecipientSms, detail !== null);
                        if (!currentPhone || currentPhone !== params.phone) {
                            return { status: "no_match" };
                        }
                        try {
                            assertRequiredPhone(currentPhone);
                        } catch (error) {
                            if (error instanceof InvalidPhoneError) {
                                throw new BadRequestException("customerPhone must be a valid Korean phone number");
                            }
                            throw error;
                        }

                        const phoneSuffix = params.phone.slice(-PHONE_LOOKUP_SUFFIX_LENGTH);
                        const clients = await transaction.client.findMany({
                            where: {
                                phone: { not: null },
                                branchId: document.branchId ?? { not: null },
                                OR: [{ phone: { endsWith: phoneSuffix } }],
                            },
                            select: {
                                id: true,
                                branchId: true,
                                phone: true,
                                eDocId: true,
                            },
                        });
                        const matches = clients.filter((client) =>
                            client.branchId !== null
                            && normalizePhone(client.phone) === params.phone,
                        );
                        if (matches.length > 1) {
                            return { status: "ambiguous" };
                        }
                        if (matches.length === 1) {
                            return {
                                status: await this.linkExistingClient(
                                    transaction,
                                    document,
                                    matches[0]!,
                                ),
                            };
                        }

                        const creationBranchId = document.branchId
                            ?? params.creationBranchId;
                        if (!creationBranchId) {
                            return { status: "no_branch" };
                        }
                        if (!AUTO_REGISTRATION_ELIGIBLE_STATUS_CODES.has(document.statusType)) {
                            return { status: "not_completed" };
                        }
                        if (!candidate || candidate.phone !== params.phone) {
                            return { status: "no_match" };
                        }
                        assertRequiredPhone(candidate.phone);
                        if (
                            !params.canCreate
                            || params.creationBranchId !== creationBranchId
                        ) {
                            return { status: "disabled" };
                        }

                        let duration = candidate.duration;
                        try {
                            const derivedDuration = deriveClientDuration(
                                candidate.startDate,
                                candidate.endDate,
                            );
                            // The provider payload has no duration field for
                            // some completed contracts; null here means
                            // "not supplied", so derive it from the dates.
                            if (candidate.duration !== null && candidate.duration !== undefined) {
                                assertClientDurationMatchesDates(candidate.duration, derivedDuration);
                            }
                            if (derivedDuration !== null) duration = derivedDuration;
                        } catch (error) {
                            if (error instanceof BadRequestException) {
                                this.logger.warn(
                                    `[EFORMSIGN_CLIENT_INVALID_DURATION] 문서 ${params.documentId}의 서비스 기간이 `
                                    + "한국 영업일 계산과 일치하지 않아 자동등록을 건너뜁니다.",
                                );
                                return { status: "skipped" };
                            }
                            throw error;
                        }

                        const pricing = normalizeClientPricing({
                            voucherClient: candidate.voucherClient,
                            type: candidate.type,
                            fullPrice: candidate.fullPrice,
                            grant: candidate.grant,
                            actualPrice: candidate.actualPrice,
                        });
                        const areaId = params.creationBranchId
                            ? await this.resolveTemplateAreaId(
                                transaction,
                                params.creationBranchId,
                                document.templateName,
                            )
                            : null;
                        const client = await transaction.client.create({
                            data: {
                                name: candidate.name,
                                address: candidate.address,
                                phone: formatNormalizedKoreanPhone(candidate.phone),
                                phoneNormalized: normalizePhone(candidate.phone),
                                suppressGreetingSms: params.suppressGreetingSms,
                                type: pricing.type,
                                duration,
                                fullPrice: pricing.fullPrice,
                                grant: pricing.grant,
                                actualPrice: pricing.actualPrice,
                                startDate: candidate.startDate,
                                endDate: candidate.endDate,
                                careCenter: candidate.careCenter,
                                voucherClient: candidate.voucherClient,
                                birthday: candidate.birthday,
                                dueDate: candidate.dueDate,
                                serviceStatus: computeServiceStatus(
                                    null,
                                    candidate.startDate,
                                    candidate.endDate,
                                ),
                                breastPump: candidate.breastPump,
                                eDocId: document.documentId,
                                branchId: creationBranchId,
                                areaId,
                            },
                            select: { id: true },
                        });
                        const claimed = await transaction.eformsign_doc.updateMany({
                            where: {
                                id: document.id,
                                branchId: document.branchId,
                                clientId: null,
                            },
                            data: {
                                branchId: creationBranchId,
                                clientId: client.id,
                                autoRegisteredClient: true,
                                documentKind: EFORMSIGN_DOCUMENT_KIND.CONTRACT,
                                customerPhone: candidate.phone,
                            },
                        });
                        if (claimed.count !== 1) {
                            throw new Error(
                                `Eformsign document ${document.documentId} was claimed concurrently`,
                            );
                        }
                        const scheduleId = await this.assignInitialScheduleFromContract(
                            transaction,
                            {
                                branchId: creationBranchId,
                                clientId: client.id,
                                candidate,
                            },
                        );
                        if (params.applyMessageAutomation) {
                            await persistClientMessageAutomationIntent(transaction, {
                                branchId: creationBranchId,
                                clientId: client.id,
                                includePast: true,
                                suppressGreeting: params.suppressGreetingSms,
                                intentAt: params.intentAt,
                            });
                            if (scheduleId !== null) {
                                // The 5-minute reconciliation cron fulfils this intent:
                                // assignment SMS rules + service-record link scheduling.
                                await persistScheduleMessageAutomationIntent(transaction, {
                                    branchId: creationBranchId,
                                    clientId: client.id,
                                    scheduleId,
                                    includePast: true,
                                    intentAt: params.intentAt,
                                });
                            }
                        }
                        return {
                            status: "created",
                            createdClientId: client.id,
                            createdBranchId: creationBranchId,
                        };
                    },
                    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
                );
            } catch (error) {
                lastError = error;
                if (!isRetryableTransactionError(error) || attempt === MAX_TRANSACTION_ATTEMPTS) {
                    throw error;
                }
            }
        }
        throw lastError;
    }

    /**
     * The contract template name carries the district (e.g. "인천 아이미래로
     * 남동구 계약서" → 남동구). Match it against the branch's (or global)
     * area names; an unmatched template keeps the previous behaviour of
     * registering the client without an area.
     */
    private async resolveTemplateAreaId(
        transaction: Prisma.TransactionClient,
        branchId: string,
        templateName: string | null,
    ): Promise<string | null> {
        const normalizedTemplateName = templateName?.trim() ?? "";
        if (!normalizedTemplateName) return null;
        const areas = await transaction.area.findMany({
            where: { OR: [{ branchId }, { branchId: null }] },
            select: { id: true, koreanName: true, branchId: true },
        });
        const matches = areas
            .map((area) => ({ area, koreanName: area.koreanName.trim() }))
            .filter(({ koreanName }) => koreanName.length > 0 && normalizedTemplateName.includes(koreanName))
            .sort((left, right) => {
                const branchScore = (entry: typeof left) => (entry.area.branchId === branchId ? 0 : 1);
                return branchScore(left) - branchScore(right)
                    || right.koreanName.length - left.koreanName.length;
            });
        return matches[0]?.area.id ?? null;
    }

    /**
     * Assigns the caretakers named in the contract (제공인력 1·2) to the newly
     * created client. A provider is reused when its phone matches exactly one
     * branch employee (falling back to a unique exact name match); otherwise a
     * minimal employee is created from the name + phone the contract provides.
     * Without both service dates no assignment is made — employee_schedule
     * requires them and inventing dates could misplace the service.
     */
    private async assignInitialScheduleFromContract(
        transaction: Prisma.TransactionClient,
        params: {
            branchId: string;
            clientId: number;
            candidate: EformsignContractClientCandidate;
        },
    ): Promise<number | null> {
        const { startDate, endDate } = params.candidate;
        if (!startDate || !endDate) return null;

        const primaryEmployeeId = await this.resolveOrCreateEmployee(
            transaction,
            params.branchId,
            {
                name: params.candidate.primaryProviderName,
                phone: params.candidate.primaryProviderPhone,
            },
        );
        if (primaryEmployeeId === null) return null;

        let secondaryEmployeeId = await this.resolveOrCreateEmployee(
            transaction,
            params.branchId,
            {
                name: params.candidate.secondaryProviderName,
                phone: params.candidate.secondaryProviderPhone,
            },
        );
        if (secondaryEmployeeId === primaryEmployeeId) secondaryEmployeeId = null;

        const schedule = await transaction.employee_schedule.create({
            data: {
                primaryEmployeeId,
                secondaryEmployeeId,
                workAddress: params.candidate.address ?? "",
                startDate,
                endDate,
                clientId: params.clientId,
                branchId: params.branchId,
            },
            select: { id: true },
        });
        return schedule.id;
    }

    private async resolveOrCreateEmployee(
        transaction: Prisma.TransactionClient,
        branchId: string,
        provider: { name: string | null; phone: string | null },
    ): Promise<number | null> {
        const phone = provider.phone === null ? null : normalizePhone(provider.phone);
        if (!phone) return null;
        const employees = await transaction.employee.findMany({
            where: {
                branchId,
                deletedAt: null,
                openToNextWork: true,
            },
            select: { id: true, name: true, phone: true },
        });
        const phoneMatches = employees.filter(
            (employee) => normalizePhone(employee.phone) === phone,
        );
        if (phoneMatches.length === 1) return phoneMatches[0]!.id;
        if (phoneMatches.length > 1) {
            this.logger.warn(
                `[EFORMSIGN_EMPLOYEE_AMBIGUOUS_PHONE] 지점 ${branchId}에서 전화번호가 겹치는 제공인력이 `
                + `${phoneMatches.length}명이라 계약서 자동 배정을 건너뜁니다.`,
            );
            return null;
        }

        const providerName = provider.name?.trim() ?? "";
        if (providerName) {
            const nameMatches = employees.filter(
                (employee) => employee.name.trim() === providerName,
            );
            if (nameMatches.length === 1) return nameMatches[0]!.id;
        }

        if (!providerName) return null;
        // A unique-constraint loss means a concurrent registration created the
        // same employee first; the serializable retry re-runs the lookup and
        // takes the existing row.
        const created = await transaction.employee.create({
            data: {
                name: providerName,
                phone: formatNormalizedKoreanPhone(phone),
                workArea: ["미지정"],
                grade: DEFAULT_EMPLOYEE_GRADE,
                openToNextWork: true,
                branchId,
            },
            select: { id: true },
        });
        return created.id;
    }

    private repairAssignedDocument(document: {
        id: number;
        documentId: string;
        branchId: string | null;
        clientId: number;
        createdDate: Date;
    }, expectedMirrorGeneration?: ExpectedEformsignMirrorGeneration): Promise<LinkMirroredEformsignDocResult> {
        return this.prisma.$transaction(async (transaction) => {
            if (!await this.lockExpectedMirrorGeneration(
                transaction,
                document.documentId,
                expectedMirrorGeneration,
            )) {
                return "mirror_not_ready";
            }
            const client = await transaction.client.findUnique({
                where: { id: document.clientId },
                select: {
                    id: true,
                    branchId: true,
                    eDocId: true,
                },
            });
            if (
                !client
                || client.branchId === null
                || (
                    document.branchId !== null
                    && document.branchId !== client.branchId
                )
            ) {
                return "ambiguous";
            }
            return this.linkExistingClient(transaction, document, client);
        });
    }

    private async lockExpectedMirrorGeneration(
        transaction: Prisma.TransactionClient,
        documentId: string,
        expectedMirrorGeneration?: ExpectedEformsignMirrorGeneration,
    ): Promise<boolean> {
        if (!expectedMirrorGeneration) return true;
        const readinessFence = expectedMirrorGeneration.readiness === "detail"
            ? Prisma.sql`AND doc.detail_payload IS NOT NULL`
            : Prisma.sql`
                AND doc.sync_status = 'ready'
                AND EXISTS (
                    SELECT 1
                    FROM eformsign_doc_file AS document_file
                    WHERE document_file.eformsign_doc_id = doc.id
                      AND document_file.file_type = 'document'
                      AND document_file.source_updated_date = doc.detail_source_updated_date
                )
                AND EXISTS (
                    SELECT 1
                    FROM eformsign_doc_file AS audit_trail_file
                    WHERE audit_trail_file.eformsign_doc_id = doc.id
                      AND audit_trail_file.file_type = 'audit_trail'
                      AND audit_trail_file.source_updated_date = doc.detail_source_updated_date
                )
            `;
        const locked = await transaction.$queryRaw<Array<{ id: number }>>(Prisma.sql`
            SELECT doc.id
            FROM eformsign_doc AS doc
            WHERE doc.document_id = ${documentId}
              AND doc.detail_source_updated_date = ${expectedMirrorGeneration.detailSourceUpdatedDate}
              AND doc.detail_synced_at = ${expectedMirrorGeneration.detailSyncedAt}
              AND doc.permanent_purge_requested_at IS NULL
              ${readinessFence}
            FOR UPDATE
        `);
        return locked.length === 1;
    }

    private async linkExistingClient(
        transaction: Prisma.TransactionClient,
        document: {
            id: number;
            documentId: string;
            branchId: string | null;
            clientId: number | null;
            createdDate: Date;
        },
        client: {
            id: number;
            branchId: string | null;
            eDocId: string | null;
        },
    ): Promise<"linked" | "already_linked" | "ambiguous"> {
        const clientBranchId = client.branchId;
        if (!clientBranchId) {
            return "ambiguous";
        }
        const wasAlreadyLinked =
            document.branchId === clientBranchId
            && document.clientId === client.id
            && client.eDocId === document.documentId;
        const claimed = await transaction.eformsign_doc.updateMany({
            where: {
                id: document.id,
                AND: [
                    {
                        OR: [
                            { branchId: document.branchId },
                            { branchId: null },
                        ],
                    },
                    {
                        OR: [
                            { clientId: null },
                            { clientId: client.id },
                        ],
                    },
                ],
            },
            data: {
                branchId: clientBranchId,
                clientId: client.id,
                documentKind: EFORMSIGN_DOCUMENT_KIND.CONTRACT,
            },
        });
        if (claimed.count === 0) {
            return "ambiguous";
        }

        let shouldPointToMirroredDocument = client.eDocId === null
            || client.eDocId === document.documentId;
        if (!shouldPointToMirroredDocument && client.eDocId) {
            const currentDocument = await transaction.eformsign_doc.findUnique({
                where: { documentId: client.eDocId },
                select: { createdDate: true },
            });
            shouldPointToMirroredDocument =
                currentDocument === null
                || document.createdDate >= currentDocument.createdDate;
        }
        if (shouldPointToMirroredDocument) {
            await transaction.client.updateMany({
                where: {
                    id: client.id,
                    branchId: clientBranchId,
                    eDocId: client.eDocId,
                },
                data: { eDocId: document.documentId },
            });
        }
        return wasAlreadyLinked ? "already_linked" : "linked";
    }

    private isServiceRecord(document: {
        documentKind: string | null;
        serviceRecordCaseId: string | null;
        templateId: string | null;
    }): boolean {
        return isServiceRecordEformsignDocument(
            document,
            configuredServiceRecordTemplateIds(this.configService),
        );
    }

    private async resolveAutoRegistrationBranch(
        documentBranchId: string | null,
        detail: EformsignApiDocumentResponse | null,
    ): Promise<string | null> {
        if (documentBranchId) {
            return await this.systemSettingService
                .getClientAutoRegistrationEnabled(documentBranchId)
                ? documentBranchId
                : null;
        }

        const creatorEmail = detail?.creator?.id?.trim();
        if (creatorEmail) {
            const creator = await this.prisma.user.findFirst({
                where: {
                    email: {
                        equals: creatorEmail,
                        mode: "insensitive",
                    },
                },
                select: {
                    ownedBranches: {
                        where: {
                            isActive: true,
                        },
                        select: { id: true },
                    },
                    userBranches: {
                        where: {
                            branch: {
                                isActive: true,
                            },
                        },
                        select: {
                            branch: {
                                select: { id: true },
                            },
                        },
                    },
                },
            });
            if (creator) {
                const creatorBranchIds = [
                    ...creator.ownedBranches.map((branch) => branch.id),
                    ...creator.userBranches.map(({ branch }) => branch.id),
                ];
                // A known creator establishes the tenant candidate set, including
                // the empty set. Never fall through to an unrelated global branch.
                return this.singleEnabledBranch(creatorBranchIds);
            }
        }

        const activeBranches = await this.prisma.branch.findMany({
            where: {
                isActive: true,
            },
            select: { id: true },
        });
        return this.singleEnabledBranch(
            activeBranches.map((branch) => branch.id),
        );
    }

    private async singleEnabledBranch(
        candidateBranchIds: string[],
    ): Promise<string | null> {
        const enabledBranchIds: string[] = [];
        for (const branchId of new Set(candidateBranchIds)) {
            if (
                await this.systemSettingService
                    .getClientAutoRegistrationEnabled(branchId)
            ) {
                enabledBranchIds.push(branchId);
                if (enabledBranchIds.length > 1) {
                    return null;
                }
            }
        }
        return enabledBranchIds[0] ?? null;
    }

    private async ensureServiceRecordLifecycle(
        clientId: number,
        transaction?: Prisma.TransactionClient,
        rethrow = false,
    ): Promise<void> {
        if (!this.serviceRecordLifecycleService) return;
        try {
            if (transaction) {
                await this.serviceRecordLifecycleService.ensureForClient(clientId, transaction);
            } else {
                await this.serviceRecordLifecycleService.ensureForClient(clientId);
            }
        } catch (error) {
            const errorType = error instanceof Error ? error.name : "UnknownError";
            this.logger.error(
                `[EFORMSIGN_CLIENT_LIFECYCLE_FAILED] 고객 ${clientId} 제공기록지 라이프사이클 동기화 실패 (${errorType})`,
            );
            if (rethrow) throw error;
        }
    }

    private async applyClientCreationAutomation(
        branchId: string,
        clientId: number,
        suppressGreetingSms: boolean,
    ): Promise<void> {
        if (!this.messageTriggerService) return;
        try {
            await fulfillClientMessageAutomationIntent({
                prisma: this.prisma,
                triggerService: this.messageTriggerService,
                branchId,
                clientId,
                includePast: true,
                suppressGreeting: suppressGreetingSms,
            });
        } catch (error) {
            const errorType = error instanceof Error ? error.name : "UnknownError";
            this.logger.error(
                `[EFORMSIGN_CLIENT_AUTOMATION_FAILED] 고객 ${clientId} 후속 자동화 실패 (${errorType})`,
            );
        }
    }

}

function singleLegacyPhone(value: string, hasDetail: boolean): string | null {
    if (hasDetail) return null;
    const phones = extractPhoneCandidates(value);
    return phones.length === 1 ? phones[0]! : null;
}

function isRetryableTransactionError(error: unknown): boolean {
    if (typeof error !== "object" || error === null || !("code" in error)) {
        return false;
    }
    return error.code === "P2002" || error.code === "P2034";
}
