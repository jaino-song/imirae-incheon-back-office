import { BadRequestException, ConflictException, Injectable, Inject, Logger, NotFoundException, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import { eformsignCustomerPhone, extractEformsignContractEndDate } from "application/utils/eformsign-contract-client-candidate";
import { resolveEformsignDocDisplayStatus } from "application/utils/eformsign-doc-display-status";
import { EformsignDocumentSnapshotService } from "application/services/eformsign-document-snapshot.service";
import {
    configuredServiceRecordTemplateIds,
    isServiceRecordEformsignDocument,
} from "application/utils/eformsign-document-kind";
import { extractPhoneCandidates, normalizePhone } from "application/utils/normalize-phone";
import {
    CreateClientUsecase,
    DeleteClientUsecase,
    FindClientByIdUsecase,
    ListClientsUsecase,
    ListClientsPaginatedUsecase,
    UpdateClientUsecase,
} from "application/usecases/client";
import { LinkMirroredEformsignDocByPhoneUsecase } from "application/usecases/eformsign-doc";
import {
    assertAllowedClientArea,
    assertAllowedServiceStatus,
    assertClientDurationMatchesDates,
    assertClientPhoneInput,
    deriveClientDuration,
    findClientByNormalizedPhone,
    mergeAndValidateClientServicePeriod,
    parseClientDate,
} from "application/usecases/client/client-write-validation";
import {
    assertEmployeeAssignmentEligibility,
    assertEmployeeAssignmentShape,
    type EmployeeAssignmentCandidate,
} from "application/policies/employee-assignment-eligibility.policy";
import {
    assertNoActiveEmployeeScheduleOverlap,
    employeeScheduleHandoverPeriod,
    employeeScheduleReplacementEndDate,
    lockClientForScheduleWrite,
    lockEmployeesForScheduleWrite,
} from "application/policies/employee-schedule-invariants.policy";
import { ClientEntity } from "domain/entities/client.entity";
import { EFORMSIGN_DOCUMENT_KIND } from "domain/entities/eformsign-doc.entity";
import { CLIENT_REPOSITORY, IClientRepository } from "domain/repositories/client.repository.interface";
import { EformsignApiDocumentResponse } from "domain/repositories/eformsign.client.interface";
import { normalizeClientPricing } from "domain/services/client-pricing";
import { addBusinessDaysKr, diffBusinessDaysKr, isoDateInKorea } from "domain/utils/business-days";
import { PrismaService } from "infrastructure/database/prisma.service";
import {
    computeServiceStatus,
    isAutomaticServiceStatusTransitionAllowed,
    SERVICE_STATUS,
    ServiceStatusType,
} from "domain/value-objects/service-status.vo";
import { MessageTriggerService } from "./message-trigger.service";
import { MessageAutomationIntentService } from "./message-automation-intent.service";
import { ServiceRecordLinkService } from "./service-record-link.service";
import { ServiceRecordLifecycleService } from "./service-record-lifecycle.service";
import { SystemSettingService } from "./system-setting.service";

const FILTER_DAYS_THRESHOLD = 7;
// Contract attention window, in KR business days before service start, within
// which a client with no active contract document is flagged as needing one sent.
// The badge and the action-required feeds all read this number.
const CONTRACT_SEND_BUSINESS_DAYS_THRESHOLD = 6;
const COMPLETED_DOCUMENT_STATUS_TYPES = new Set(["003", "012", "022", "032", "050", "062", "072", "092"]);
const REJECTED_DOCUMENT_STATUS_TYPES = new Set(["011", "021", "031", "061", "071", "080"]);
const REVOKED_DOCUMENT_STATUS_TYPES = new Set(["040", "042", "045", "090"]);
const DELETED_DOCUMENT_STATUS_TYPES = new Set(["047", "049", "099"]);
const OPENED_DOCUMENT_STATUS_TYPES = new Set(["020"]);
const CREATED_DOCUMENT_STATUS_TYPES = new Set(["001", "002", "010", "043"]);
const REQUESTED_DOCUMENT_STATUS_TYPES = new Set(["030", "060", "070"]);
const CONTRACT_AUTO_REGISTRATION_SOURCE = "contract_auto_registration";
const DEFAULT_SERVICE_PERIOD_MS = 365 * 24 * 60 * 60 * 1000;
const PHONE_LOOKUP_SUFFIX_LENGTH = 4;

// Document status type for eformsign documents
// Maps to eformsign_doc.statusType values:
// - 003/050: completed (완료)
// - 010: created (문서 생성됨)
// - 020: opened (서명 페이지 열림)
// - 060: requested (서명 요청됨/진행중)
// - 080: rejected (거부됨)
// - 090: revoked (철회됨)
// - 099: deleted (삭제됨)
export type DocumentStatusType = 'created' | 'opened' | 'completed' | 'requested' | 'rejected' | 'revoked' | 'deleted' | null;
// A document in one of these states is still "alive" — the client already has
// a contract in flight (or finished), so the "계약서 필요" signal must not fire
// even if it is unsigned. Everything else (rejected/revoked/deleted/no document
// at all) is a dead document and falls back to the "발송 필요" check.
const ACTIVE_DOCUMENT_STATUSES = new Set<DocumentStatusType>(["created", "requested", "opened", "completed"]);
export type ClientBadgeKey = "contract_required" | "breast_pump" | "service_status" | "care_center";
export type ClientBadgeTone = "danger" | "success" | "primary" | "warning" | "neutral";
export type ClientBadgeStatus =
    | "active"
    | "preBooking"
    | "pending"
    | "review"
    | "terminated"
    | "expired"
    | "completed"
    | "signed"
    | "breastPump"
    | "careCenter";

export interface ClientBadge {
    key: ClientBadgeKey;
    status: ClientBadgeStatus;
    label: string;
    tone: ClientBadgeTone;
    priority: number;
}

export interface PendingScheduleChange {
    id: string;
    sessionIndex: number;
    fromDate: string;
    toDate: string;
    oldEndDate: string;
    newEndDate: string;
}

// Response type that includes employee information
export interface ClientWithEmployees {
    id: number;
    name: string;
    createdAt: Date | null;
    address: string | null;
    phone: string | null;
    type: string | null;
    duration: number | null;
    fullPrice: string | null;
    grant: string | null;
    actualPrice: string | null;
    startDate: Date | null;
    endDate: Date | null;
    careCenter: boolean | null;
    voucherClient: boolean;
    birthday: string | null;
    dueDate: Date | null;
    birthDate: Date | null;
    serviceStatus: string | null;
    breastPump: boolean;
    eDocId: string | null;
    areaId: string | null;
    hasSigned: boolean;
    documentStatus: DocumentStatusType;
    badges: ClientBadge[];
    actionRequired: ClientActionRequired | null;
    primaryEmployee: { id: number; name: string; phone: string | null } | null;
    secondaryEmployee: { id: number; name: string; phone: string | null } | null;
    pendingScheduleChange?: PendingScheduleChange | null;
}

export interface PaginatedClientWithEmployees {
    data: ClientWithEmployees[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

export type ActionRequiredReason = "교체 요청" | "서명 필요" | "발송 필요";

export interface ClientActionRequired {
    reason: ActionRequiredReason;
    priority: 1 | 2 | 3;
}

/** The latest contract signal the document-status/active-document checks read. */
interface LatestContractSignal {
    statusType: string;
    permanentPurgeRequestedAt: Date | null;
    documentId: string;
    stepType: string | null;
    stepName: string | null;
    detailPayload: unknown;
}

export interface ClientActionRequiredAlert extends ClientActionRequired {
    id: number;
    name: string;
    createdAt: Date | null;
}

export interface DashboardOverview {
    stats: {
        activeClients: number;
        contractsNotSent: number;
        contractsPendingSignature: number;
        upcomingThisMonth: number;
        upcomingNextMonth: number;
    };
    clients: PaginatedClientWithEmployees;
}

@Injectable()
export class ClientService {
    private readonly logger = new Logger(ClientService.name);

    constructor(
        private readonly createClientUsecase: CreateClientUsecase,
        private readonly findClientByIdUsecase: FindClientByIdUsecase,
        private readonly listClientsUsecase: ListClientsUsecase,
        private readonly listClientsPaginatedUsecase: ListClientsPaginatedUsecase,
        private readonly updateClientUsecase: UpdateClientUsecase,
        private readonly deleteClientUsecase: DeleteClientUsecase,
        private readonly prismaService: PrismaService,
        @Inject(CLIENT_REPOSITORY)
        private readonly clientRepository: IClientRepository,
        private readonly systemSettingService: SystemSettingService,
        private readonly documentSnapshotService: EformsignDocumentSnapshotService,
        private readonly messageAutomationIntentService: MessageAutomationIntentService,
        @Optional() private readonly triggerService?: MessageTriggerService,
        @Optional() private readonly serviceRecordLinkService?: ServiceRecordLinkService,
        @Optional() private readonly serviceRecordLifecycleService?: ServiceRecordLifecycleService,
        @Optional() private readonly configService?: ConfigService,
        @Optional() private readonly linkMirroredDocumentByPhoneUsecase?: LinkMirroredEformsignDocByPhoneUsecase,
    ) {}

    private async revokeServiceRecordLinkAfterCommit(clientId: number, scheduleId: number): Promise<void> {
        try {
            await this.serviceRecordLinkService?.revoke(scheduleId);
        } catch (error) {
            this.logger.error(
                `[SERVICE_RECORD_LINK_REVOKE_FAILED] 제공기록지 링크 폐기 실패 — 고객 ${clientId}, ` +
                `스케줄 ${scheduleId} 수동 확인 필요: ${error}`,
            );
        }
    }

    private async linkContractDocumentsByPhone(
        branchid: string,
        client: ClientEntity,
        normalizedPhone: string,
    ): Promise<void> {
        const phoneLookupSuffix = normalizedPhone.slice(-PHONE_LOOKUP_SUFFIX_LENGTH);

        try {
            const candidateDocs = await this.prismaService.eformsign_doc.findMany({
                where: {
                    serviceRecordCaseId: null,
                    permanentPurgeRequestedAt: null,
                    statusType: { notIn: [...DELETED_DOCUMENT_STATUS_TYPES] },
                    syncStatus: "ready",
                    detailSourceUpdatedDate: { not: null },
                    detailSyncedAt: { not: null },
                    OR: [
                        { customerPhone: normalizedPhone },
                        {
                            customerPhone: null,
                            stepRecipientSms: { contains: phoneLookupSuffix },
                        },
                    ],
                    AND: [
                        {
                            OR: [
                                { branchId: branchid },
                                { branchId: null, clientId: null },
                            ],
                        },
                        {
                            OR: [
                                { documentKind: EFORMSIGN_DOCUMENT_KIND.CONTRACT },
                                { documentKind: null },
                            ],
                        },
                    ],
                },
                orderBy: [
                    { createdDate: "desc" },
                    { id: "desc" },
                ],
                select: {
                    id: true,
                    documentId: true,
                    clientId: true,
                    branchId: true,
                    documentKind: true,
                    serviceRecordCaseId: true,
                    templateId: true,
                    stepRecipientSms: true,
                    customerPhone: true,
                    detailPayload: true,
                    detailSourceUpdatedDate: true,
                    detailSyncedAt: true,
                },
            });
            const serviceRecordTemplateIds =
                configuredServiceRecordTemplateIds(this.configService);
            let matchingDocs = candidateDocs.filter((doc) =>
                isMatchingContractPhoneCandidate(
                    doc,
                    normalizedPhone,
                    serviceRecordTemplateIds,
                ));
            if (matchingDocs.some((doc) => doc.branchId === null)) {
                const samePhoneClients = await this.prismaService.client.findMany({
                    where: {
                        phone: { not: null },
                        branchId: { not: null },
                        OR: [{ phone: { endsWith: phoneLookupSuffix } }],
                    },
                    select: {
                        id: true,
                        branchId: true,
                        phone: true,
                    },
                });
                const exactMatches = samePhoneClients.filter((candidate) =>
                    candidate.branchId !== null
                    && normalizePhone(candidate.phone) === normalizedPhone,
                );
                const uniquelyIdentifiesCurrentClient = exactMatches.length === 1
                    && exactMatches[0]!.id === client.id
                    && exactMatches[0]!.branchId === branchid;
                if (!uniquelyIdentifiesCurrentClient) {
                    matchingDocs = matchingDocs.filter((doc) => doc.branchId === branchid);
                }
            }
            const documentIdsToReassign = matchingDocs
                .filter((doc) => doc.clientId !== client.id)
                .map((doc) => doc.id);
            const latestContract = matchingDocs[0];
            const shouldUpdateClientDocument = latestContract !== undefined
                && client.eDocId !== latestContract.documentId;

            if (documentIdsToReassign.length === 0 && !shouldUpdateClientDocument) {
                await this.linkNotReadyContractDocumentsByPhone(
                    branchid,
                    client,
                    normalizedPhone,
                    phoneLookupSuffix,
                );
                return;
            }

            await this.prismaService.$transaction(async (transaction) => {
                const documentIdsToLock = Array.from(new Set([
                    ...documentIdsToReassign,
                    ...(shouldUpdateClientDocument && latestContract ? [latestContract.id] : []),
                ])).sort((left, right) => left - right);
                const lockedDocuments = await transaction.$queryRaw<Array<{ id: number }>>(Prisma.sql`
                    SELECT doc.id
                    FROM eformsign_doc AS doc
                    WHERE doc.id IN (${Prisma.join(documentIdsToLock)})
                      AND (
                          doc.branch_id = ${branchid}::uuid
                          OR (doc.branch_id IS NULL AND doc.client_id IS NULL)
                      )
                      AND doc.status_type NOT IN ('047', '049', '099')
                      AND doc.permanent_purge_requested_at IS NULL
                      AND doc.sync_status = 'ready'
                      AND doc.detail_payload IS NOT NULL
                      AND doc.detail_source_updated_date IS NOT NULL
                      AND doc.detail_synced_at IS NOT NULL
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
                    ORDER BY doc.id
                    FOR UPDATE
                `);
                const lockedDocumentIds = new Set(lockedDocuments.map(({ id }) => id));
                if (documentIdsToLock.some((id) => !lockedDocumentIds.has(id))) {
                    throw new Error("Contract document mirror generation changed");
                }

                // The row lock protects the re-read below from a concurrent mirror
                // write. Do not act on the pre-lock phone projection: a recipient
                // update may have moved this document to another client or branch.
                const lockedCandidates = await transaction.eformsign_doc.findMany({
                    where: { id: { in: documentIdsToLock } },
                    select: {
                        id: true,
                        documentKind: true,
                        serviceRecordCaseId: true,
                        templateId: true,
                        stepRecipientSms: true,
                        customerPhone: true,
                        detailPayload: true,
                        detailSourceUpdatedDate: true,
                        detailSyncedAt: true,
                    },
                });
                const lockedCandidateById = new Map(
                    lockedCandidates.map((candidate) => [candidate.id, candidate]),
                );
                const initialCandidateById = new Map(
                    matchingDocs.map((candidate) => [candidate.id, candidate]),
                );
                const changedCandidate = documentIdsToLock.some((id) => {
                    const initial = initialCandidateById.get(id);
                    const locked = lockedCandidateById.get(id);
                    return !initial
                        || !locked
                        || !isMatchingContractPhoneCandidate(
                            locked,
                            normalizedPhone,
                            serviceRecordTemplateIds,
                        )
                        || !sameMirrorGeneration(
                            initial.detailSourceUpdatedDate,
                            initial.detailSyncedAt,
                            locked.detailSourceUpdatedDate,
                            locked.detailSyncedAt,
                        );
                });
                if (changedCandidate) {
                    throw new Error("Contract document candidate changed while locking");
                }

                if (documentIdsToReassign.length > 0) {
                    const reassigned = await transaction.eformsign_doc.updateMany({
                        where: {
                            id: { in: documentIdsToReassign },
                            permanentPurgeRequestedAt: null,
                            statusType: { notIn: [...DELETED_DOCUMENT_STATUS_TYPES] },
                            syncStatus: "ready",
                            detailSourceUpdatedDate: { not: null },
                            detailSyncedAt: { not: null },
                            OR: [
                                { branchId: branchid },
                                { branchId: null, clientId: null },
                            ],
                        },
                        data: {
                            branchId: branchid,
                            clientId: client.id,
                            documentKind: EFORMSIGN_DOCUMENT_KIND.CONTRACT,
                        },
                    });
                    if (reassigned.count !== documentIdsToReassign.length) {
                        throw new Error("Contract document reassignment was incomplete");
                    }
                }

                if (shouldUpdateClientDocument) {
                    const updated = await transaction.client.updateMany({
                        where: {
                            id: client.id,
                            branchId: branchid,
                        },
                        data: { eDocId: latestContract.documentId },
                    });
                    if (updated.count !== 1) {
                        throw new Error("Client contract pointer update failed");
                    }
                }
            });

            if (shouldUpdateClientDocument) {
                client.update({ eDocId: latestContract.documentId });
            }
            if (documentIdsToReassign.length > 0) {
                await this.invalidateContractDocumentSnapshots(
                    branchid,
                    matchingDocs.some((doc) => doc.branchId === null),
                );
            }
            await this.linkNotReadyContractDocumentsByPhone(
                branchid,
                client,
                normalizedPhone,
                phoneLookupSuffix,
            );
        } catch (error) {
            const errorType = error instanceof Error ? error.name : "UnknownError";
            this.logger.error(
                `[CLIENT_CONTRACT_PHONE_LINK_FAILED] 고객 ${client.id} 계약서 자동 연결 실패 (${errorType})`,
            );
        }
    }

    private async linkNotReadyContractDocumentsByPhone(
        branchId: string,
        client: ClientEntity,
        normalizedPhone: string,
        phoneLookupSuffix: string,
    ): Promise<void> {
        if (!this.linkMirroredDocumentByPhoneUsecase) return;

        const candidates = await this.prismaService.eformsign_doc.findMany({
            where: {
                serviceRecordCaseId: null,
                permanentPurgeRequestedAt: null,
                statusType: { notIn: [...DELETED_DOCUMENT_STATUS_TYPES] },
                syncStatus: { not: "ready" },
                OR: [
                    { customerPhone: normalizedPhone },
                    {
                        customerPhone: null,
                        stepRecipientSms: { contains: phoneLookupSuffix },
                    },
                ],
                AND: [
                    {
                        OR: [
                            { branchId },
                            { branchId: null, clientId: null },
                        ],
                    },
                    {
                        OR: [
                            { documentKind: EFORMSIGN_DOCUMENT_KIND.CONTRACT },
                            { documentKind: null },
                        ],
                    },
                ],
            },
            orderBy: [
                { createdDate: "desc" },
                { id: "desc" },
            ],
            select: {
                documentId: true,
                branchId: true,
            },
        });

        let ownershipChanged = false;
        let includesUnassignedDocument = false;
        for (const candidate of candidates) {
            const result = await this.linkMirroredDocumentByPhoneUsecase.execute(
                candidate.documentId,
                { linkExistingOnly: true },
            );
            if (result === "linked") {
                ownershipChanged = true;
                includesUnassignedDocument ||= candidate.branchId === null;
            }
        }
        if (!ownershipChanged) return;

        const persistedClient = await this.prismaService.client.findUnique({
            where: { id: client.id },
            select: { eDocId: true },
        });
        if (persistedClient) {
            client.update({ eDocId: persistedClient.eDocId });
        }
        await this.invalidateContractDocumentSnapshots(
            branchId,
            includesUnassignedDocument,
        );
    }

    private async invalidateContractDocumentSnapshots(
        branchId: string,
        includesUnassignedDocument: boolean,
    ): Promise<void> {
        await Promise.all([
            this.documentSnapshotService.bumpVersion(branchId).catch(() => {
                this.logger.warn(
                    `Failed to invalidate eformsign snapshots for branch ${branchId}`,
                );
            }),
            ...(includesUnassignedDocument
                ? [this.documentSnapshotService.bumpCompanyEpoch().catch(() => {
                    this.logger.warn(
                        "Failed to invalidate headquarters eformsign snapshots",
                    );
                })]
                : []),
        ]);
    }

    private mapServiceStatusToBadge(status: string | null): {
        status: ClientBadgeStatus;
        label: string;
        tone: ClientBadgeTone;
    } {
        switch (status) {
            case SERVICE_STATUS.PRE_BOOKING:
                return { status: "preBooking", label: "예약 전", tone: "neutral" };
            case SERVICE_STATUS.ACTIVE:
                return { status: "active", label: "진행중", tone: "primary" };
            case SERVICE_STATUS.WAITING:
                return { status: "pending", label: "대기", tone: "warning" };
            case SERVICE_STATUS.REPLACEMENT_REQUESTED:
                return { status: "terminated", label: "교체 요청", tone: "danger" };
            case SERVICE_STATUS.TERMINATED:
                return { status: "terminated", label: "중단", tone: "danger" };
            case SERVICE_STATUS.COMPLETED:
                return { status: "completed", label: "완료", tone: "success" };
            default:
                return { status: "pending", label: "-", tone: "warning" };
        }
    }

    /** Latest non-service-record contract document per client. */
    private async findLatestContractByClientId(
        clientIds: number[],
    ): Promise<Map<number, LatestContractSignal>> {
        const latestContractMap = new Map<number, LatestContractSignal>();
        if (clientIds.length === 0) return latestContractMap;

        const serviceRecordTemplateIds =
            configuredServiceRecordTemplateIds(this.configService);
        const contractDocs = await this.prismaService.eformsign_doc.findMany({
            where: {
                clientId: { in: clientIds },
                serviceRecordCaseId: null,
                // Contract lifecycle status is an indexed projection that commits before
                // detail/PDF artifacts finish. Do not filter it by artifact syncStatus:
                // doing so can hide the newest contract and fall back to an older one.
                OR: [
                    { documentKind: EFORMSIGN_DOCUMENT_KIND.CONTRACT },
                    { documentKind: null },
                ],
            },
            orderBy: [
                { createdDate: "desc" },
                { id: "desc" },
            ],
            select: {
                clientId: true,
                documentId: true,
                statusType: true,
                stepType: true,
                stepName: true,
                detailPayload: true,
                permanentPurgeRequestedAt: true,
                documentKind: true,
                serviceRecordCaseId: true,
                templateId: true,
            },
        });

        for (const doc of contractDocs) {
            if (doc.clientId === null) continue;
            if (isServiceRecordEformsignDocument(doc, serviceRecordTemplateIds)) {
                continue;
            }
            if (!latestContractMap.has(doc.clientId)) {
                latestContractMap.set(doc.clientId, {
                    statusType: doc.statusType,
                    permanentPurgeRequestedAt: doc.permanentPurgeRequestedAt,
                    documentId: doc.documentId,
                    stepType: doc.stepType,
                    stepName: doc.stepName,
                    detailPayload: doc.detailPayload,
                });
            }
        }

        return latestContractMap;
    }

    /** Whether a client's latest contract document is still active (see `ACTIVE_DOCUMENT_STATUSES`). */
    private async findHasActiveContractDocumentByClientId(
        clientIds: number[],
    ): Promise<Map<number, boolean>> {
        const latestContractMap = await this.findLatestContractByClientId(clientIds);

        return new Map(
            [...latestContractMap].map(([clientId, contract]) => [
                clientId,
                contract.permanentPurgeRequestedAt == null
                && !DELETED_DOCUMENT_STATUS_TYPES.has(contract.statusType.trim().padStart(3, "0"))
                && ACTIVE_DOCUMENT_STATUSES.has(this.mapStatusTypeToDocumentStatus(contract.statusType)),
            ]),
        );
    }

    /**
     * Single source of truth for "this client's contract needs attention".
     * The `contract_required` badge, the dashboard list and the
     * `/clients/alerts` sidebar feed all read this, so every surface agrees.
     *
     * An active document (created/requested/opened/completed — see
     * `ACTIVE_DOCUMENT_STATUSES`) already means a contract exists, so no action
     * is required even if the customer has not signed yet. Only a client with
     * no active document — none at all, or the latest one rejected/revoked/
     * deleted — needs a contract sent, and only within the send window. Windows
     * are counted in KR business days, so a weekend or holiday does not
     * silently eat the warning time.
     *
     * Deliberately excludes 교체 요청: a replacement is unrelated to whether a
     * contract exists, so it must not suppress the contract badge.
     */
    private computeContractActionRequired(params: {
        serviceStatus: string | null;
        startDate: Date | null;
        hasActiveContractDocument: boolean;
    }): ClientActionRequired | null {
        if (
            params.serviceStatus === SERVICE_STATUS.PRE_BOOKING ||
            params.serviceStatus === SERVICE_STATUS.COMPLETED ||
            params.serviceStatus === SERVICE_STATUS.TERMINATED
        ) {
            return null;
        }

        if (!params.startDate) return null;

        const businessDaysUntilStart = diffBusinessDaysKr(
            params.startDate.toISOString().slice(0, 10),
        );
        if (businessDaysUntilStart === null) return null;

        if (params.hasActiveContractDocument) return null;

        if (businessDaysUntilStart <= CONTRACT_SEND_BUSINESS_DAYS_THRESHOLD) {
            return { reason: "발송 필요", priority: 3 };
        }

        return null;
    }

    /** Contract attention plus the non-contract 교체 요청 alert, which outranks it. */
    private computeActionRequired(params: {
        serviceStatus: string | null;
        startDate: Date | null;
        hasActiveContractDocument: boolean;
    }): ClientActionRequired | null {
        if (params.serviceStatus === SERVICE_STATUS.REPLACEMENT_REQUESTED) {
            return { reason: "교체 요청", priority: 1 };
        }

        return this.computeContractActionRequired(params);
    }

    private buildClientBadges(params: {
        contractActionRequired: ClientActionRequired | null;
        serviceStatus: string | null;
        breastPump: boolean;
        careCenter: boolean | null;
    }): ClientBadge[] {
        const badges: ClientBadge[] = [];

        if (params.contractActionRequired) {
            badges.push({
                key: "contract_required",
                status: "terminated",
                label: "계약서 필요",
                tone: "danger",
                priority: 10,
            });
        }

        if (params.breastPump) {
            badges.push({
                key: "breast_pump",
                status: "breastPump",
                label: "유축기 대여",
                tone: "primary",
                priority: 20,
            });
        }

        const serviceBadge = this.mapServiceStatusToBadge(params.serviceStatus);
        badges.push({
            key: "service_status",
            status: serviceBadge.status,
            label: serviceBadge.label,
            tone: serviceBadge.tone,
            priority: 30,
        });

        if (params.careCenter) {
            badges.push({
                key: "care_center",
                status: "careCenter",
                label: "조리원 이용",
                tone: "primary",
                priority: 40,
            });
        }

        return badges.sort((left, right) => left.priority - right.priority);
    }

    private async assertAllowedEmployees(
        branchid: string,
        primaryEmployeeId: number | null,
        secondaryEmployeeId: number | null,
        transaction: Prisma.TransactionClient,
        retainedEmployeeIds?: ReadonlySet<number>,
    ): Promise<void> {
        assertEmployeeAssignmentShape(primaryEmployeeId, secondaryEmployeeId);
        if (primaryEmployeeId === null) return;

        const employeeIds = [primaryEmployeeId, secondaryEmployeeId].filter(
            (employeeId): employeeId is number => employeeId !== null,
        );
        await lockEmployeesForScheduleWrite(
            transaction,
            branchid,
            [...employeeIds, ...(retainedEmployeeIds ? [...retainedEmployeeIds] : [])],
        );
        const employees: EmployeeAssignmentCandidate[] = await transaction.employee.findMany({
            where: {
                id: { in: employeeIds },
                branchId: branchid,
            },
            select: {
                id: true,
                branchId: true,
                deletedAt: true,
                openToNextWork: true,
            },
        });
        assertEmployeeAssignmentEligibility(
            branchid,
            primaryEmployeeId,
            secondaryEmployeeId,
            employees,
            retainedEmployeeIds,
        );
    }

    private async syncEmployeeAssignment(branchid: string, params: {
        clientId: number;
        primaryEmployeeId?: number;
        secondaryEmployeeId?: number | null;
        workAddress: string;
        startDate: Date;
        endDate: Date;
        applyMessageAutomation: boolean;
    }): Promise<{ createdScheduleId: number | null; replacedScheduleId: number | null }> {
        const intentAt = new Date();
        const newSchedule = await this.prismaService.$transaction(async (transaction) => {
            await lockClientForScheduleWrite(transaction, branchid, params.clientId);
            const currentSchedule = await transaction.employee_schedule.findFirst({
                where: { clientId: params.clientId, branchId: branchid, replaced: false },
                orderBy: { id: "desc" },
            });
            const currentPrimaryEmployeeId = currentSchedule?.primaryEmployeeId ?? null;
            const currentSecondaryEmployeeId = currentSchedule?.secondaryEmployeeId ?? null;
            const newPrimaryEmployeeId = params.primaryEmployeeId ?? currentPrimaryEmployeeId;
            const newSecondaryEmployeeId = params.secondaryEmployeeId !== undefined
                ? params.secondaryEmployeeId
                : currentSecondaryEmployeeId;

            if (
                newPrimaryEmployeeId === currentPrimaryEmployeeId &&
                newSecondaryEmployeeId === currentSecondaryEmployeeId
            ) {
                return null;
            }

            assertEmployeeAssignmentShape(newPrimaryEmployeeId, newSecondaryEmployeeId);
            if (newPrimaryEmployeeId === null) {
                throw new BadRequestException("primary employee is required to create an assignment");
            }

            const retainedEmployeeIds = new Set(
                [currentPrimaryEmployeeId, currentSecondaryEmployeeId]
                    .filter((employeeId): employeeId is number => employeeId !== null),
            );
            await this.assertAllowedEmployees(
                branchid,
                newPrimaryEmployeeId,
                newSecondaryEmployeeId,
                transaction,
                retainedEmployeeIds,
            );
            // One handover instant for the whole transaction. The outgoing row has to
            // end on exactly the day the incoming row starts, so the clock is read
            // once here rather than per write, where the two could straddle midnight.
            const handover = currentSchedule
                ? ((): { outgoingEndDate: Date; startDate: Date; endDate: Date } => {
                    const outgoingEndDate = employeeScheduleReplacementEndDate(
                        new Date(),
                        currentSchedule.startDate,
                    );
                    return {
                        outgoingEndDate,
                        ...employeeScheduleHandoverPeriod({
                            replacementAt: outgoingEndDate,
                            contractStartDate: params.startDate,
                            contractEndDate: params.endDate,
                        }),
                    };
                })()
                : null;
            // A first assignment keeps the contract period; only a handover moves the start.
            const incomingStartDate = handover?.startDate ?? params.startDate;
            const incomingEndDate = handover?.endDate ?? params.endDate;
            await assertNoActiveEmployeeScheduleOverlap(transaction, {
                branchId: branchid,
                clientId: params.clientId,
                primaryEmployeeId: newPrimaryEmployeeId,
                secondaryEmployeeId: newSecondaryEmployeeId,
                startDate: incomingStartDate,
                endDate: incomingEndDate,
                replaced: false,
                excludeScheduleId: currentSchedule?.id,
            });
            if (currentSchedule && handover) {
                await transaction.employee_schedule.update({
                    where: { id: currentSchedule.id },
                    data: {
                        replaced: true,
                        endDate: handover.outgoingEndDate,
                    },
                });
            }
            const newSchedule = await transaction.employee_schedule.create({
                data: {
                    clientId: params.clientId,
                    branchId: branchid,
                    primaryEmployeeId: newPrimaryEmployeeId,
                    secondaryEmployeeId: newSecondaryEmployeeId,
                    workAddress: params.workAddress,
                    startDate: incomingStartDate,
                    endDate: incomingEndDate,
                    replaced: false,
                },
            });
            if (params.applyMessageAutomation) {
                await this.messageAutomationIntentService.persistScheduleIntent(transaction, {
                    branchId: branchid,
                    clientId: params.clientId,
                    scheduleId: newSchedule.id,
                    includePast: true,
                    intentAt,
                });
            }
            return {
                schedule: newSchedule,
                replacedScheduleId: currentSchedule?.id ?? null,
            };
        });

        if (newSchedule === null) {
            return { createdScheduleId: null, replacedScheduleId: null };
        }

        return {
            createdScheduleId: newSchedule.schedule.id,
            replacedScheduleId: newSchedule.replacedScheduleId,
        };
    }

    async create(branchid: string, params: {
        name: string;
        primaryEmployeeId?: number | null;
        secondaryEmployeeId?: number | null;
        address?: string | null;
        phone?: string | null;
        type?: string | null;
        duration?: number | null;
        fullPrice?: string | null;
        grant?: string | null;
        actualPrice?: string | null;
        startDate?: string | null;
        endDate?: string | null;
        careCenter: boolean | null;
        voucherClient: boolean;
        birthday?: string | null;
        dueDate?: string | null;
        birthDate?: string | null;
        serviceStatus?: string | null;
        breastPump: boolean;
        eDocId?: string | null;
        areaId?: string | null;
        suppressGreetingSms?: boolean;
        applyMessageAutomation?: boolean;
        reuseExistingClient?: boolean;
        source?: string;
    }): Promise<ClientEntity> {
        // Reject malformed identity input before settings lookups, duplicate
        // checks, automation, or any other write/provider side effect.
        assertClientPhoneInput(params.phone);
        const startDate = parseClientDate(params.startDate) ?? null;
        const endDate = parseClientDate(params.endDate) ?? null;
        const dueDate = parseClientDate(params.dueDate) ?? null;
        const birthDate = parseClientDate(params.birthDate) ?? null;
        mergeAndValidateClientServicePeriod(null, { startDate, endDate });
        const derivedDuration = deriveClientDuration(startDate, endDate);
        // On create there is no prior duration to clear, so an explicit null
        // carries the same "no opinion" as an omitted field and the count is
        // derived from the dates. Only a supplied number is checked against
        // them. Update keeps null's distinct explicit-clear meaning.
        assertClientDurationMatchesDates(params.duration ?? undefined, derivedDuration);
        // A supplied duration is authoritative; the date-derived count is
        // only a fallback when the caller does not supply one.
        const duration = params.duration ?? derivedDuration ?? null;
        assertAllowedServiceStatus(params.serviceStatus);
        await assertAllowedClientArea(this.prismaService, branchid, params.areaId);

        let suppressGreetingSms = params.suppressGreetingSms ?? false;
        const applyMessageAutomation = params.applyMessageAutomation ?? true;
        if (params.source === CONTRACT_AUTO_REGISTRATION_SOURCE) {
            const autoRegistrationEnabled = await this.systemSettingService
                .getClientAutoRegistrationEnabled(branchid);
            if (!autoRegistrationEnabled) {
                throw new ConflictException("자동 고객 등록이 꺼져 있습니다. 고객을 먼저 등록한 뒤 계약서를 생성해 주세요.");
            }
            const greetingEnabled = await this.systemSettingService
                .getGreetingOnAutoRegistrationEnabled(branchid);
            suppressGreetingSms = !greetingEnabled;
        }

        const { normalizedPhone, existingClient: existing } = await findClientByNormalizedPhone(
            this.clientRepository,
            branchid,
            params.phone,
        );
        if (existing && normalizedPhone) {
            if (params.reuseExistingClient !== true) {
                throw new ConflictException({
                    statusCode: 409,
                    error: "Conflict",
                    message: "이미 같은 전화번호의 고객이 있습니다.",
                    clientId: existing.id,
                });
            }
            this.logger.log(`[Client] Reusing existing client ${existing.id} for duplicate phone in branch ${branchid}`);
            if (params.primaryEmployeeId !== undefined || params.secondaryEmployeeId !== undefined) {
                const assignment = await this.syncEmployeeAssignment(branchid, {
                    clientId: existing.id,
                    primaryEmployeeId: params.primaryEmployeeId ?? undefined,
                    secondaryEmployeeId: params.secondaryEmployeeId,
                    workAddress: params.address ?? existing.address ?? "",
                    startDate: startDate ?? existing.startDate ?? new Date(),
                    endDate: endDate ?? existing.endDate ?? new Date(Date.now() + DEFAULT_SERVICE_PERIOD_MS),
                    applyMessageAutomation,
                });
                if (assignment.replacedScheduleId !== null) {
                    await this.revokeServiceRecordLinkAfterCommit(
                        existing.id,
                        assignment.replacedScheduleId,
                    );
                }
                if (assignment.createdScheduleId !== null) {
                    if (applyMessageAutomation) {
                        await this.messageAutomationIntentService.fulfillScheduleIntent({
                            branchId: branchid,
                            scheduleId: assignment.createdScheduleId,
                            includePast: true,
                        }).catch((error) => {
                            this.logger.error(`Failed to fulfill assignment message intent: ${error}`);
                        });
                    }
                }
            }
            await this.linkContractDocumentsByPhone(branchid, existing, normalizedPhone);
            await this.serviceRecordLifecycleService?.ensureForClient(existing.id);
            return existing;
        }

        const normalizedPricing = normalizeClientPricing({
            voucherClient: params.voucherClient,
            type: params.type ?? null,
            fullPrice: params.fullPrice ?? null,
            grant: params.grant ?? null,
            actualPrice: params.actualPrice ?? null,
        });

        const createParams = {
            name: params.name,
            address: params.address ?? null,
            phone: params.phone ?? null,
            type: normalizedPricing.type,
            duration,
            fullPrice: normalizedPricing.fullPrice,
            grant: normalizedPricing.grant,
            actualPrice: normalizedPricing.actualPrice,
            startDate: startDate,
            endDate: endDate,
            careCenter: params.careCenter,
            voucherClient: params.voucherClient,
            birthday: params.birthday ?? null,
            dueDate,
            birthDate,
            serviceStatus: params.serviceStatus ?? null,
            breastPump: params.breastPump,
            eDocId: params.eDocId ?? null,
            areaId: params.areaId ?? null,
            suppressGreetingSms,
        };

        const primaryEmployeeId = params.primaryEmployeeId ?? null;
        const secondaryEmployeeId = params.secondaryEmployeeId ?? null;
        assertEmployeeAssignmentShape(primaryEmployeeId, secondaryEmployeeId);

        let client: ClientEntity;
        let createdScheduleId: number | null = null;
        const automationIntentAt = new Date();
        if (primaryEmployeeId !== null) {
            const result = await this.prismaService.$transaction(async (transaction) => {
                await this.assertAllowedEmployees(
                    branchid,
                    primaryEmployeeId,
                    secondaryEmployeeId,
                    transaction,
                );
                const initialScheduleStartDate = startDate ?? new Date();
                const initialScheduleEndDate = endDate ?? new Date(Date.now() + DEFAULT_SERVICE_PERIOD_MS);
                await assertNoActiveEmployeeScheduleOverlap(transaction, {
                    branchId: branchid,
                    primaryEmployeeId,
                    secondaryEmployeeId,
                    startDate: initialScheduleStartDate,
                    endDate: initialScheduleEndDate,
                    replaced: false,
                });
                const created = await this.createClientUsecase.executeWithInitialSchedule(branchid, createParams, {
                    primaryEmployeeId,
                    secondaryEmployeeId,
                    workAddress: params.address ?? "",
                    startDate: initialScheduleStartDate,
                    endDate: initialScheduleEndDate,
                }, transaction);
                if (applyMessageAutomation) {
                    await this.messageAutomationIntentService.persistClientIntent(transaction, {
                        branchId: branchid,
                        clientId: created.client.id,
                        includePast: true,
                        suppressGreeting: suppressGreetingSms,
                        intentAt: automationIntentAt,
                    });
                    await this.messageAutomationIntentService.persistScheduleIntent(transaction, {
                        branchId: branchid,
                        clientId: created.client.id,
                        scheduleId: created.scheduleId,
                        includePast: true,
                        intentAt: automationIntentAt,
                    });
                }
                return created;
            });
            client = result.client;
            createdScheduleId = result.scheduleId;
        } else {
            client = await this.prismaService.$transaction(async (transaction) => {
                const created = await this.createClientUsecase.execute(branchid, createParams, transaction);
                if (applyMessageAutomation) {
                    await this.messageAutomationIntentService.persistClientIntent(transaction, {
                        branchId: branchid,
                        clientId: created.id,
                        includePast: true,
                        suppressGreeting: suppressGreetingSms,
                        intentAt: automationIntentAt,
                    });
                }
                return created;
            });
        }

        if (normalizedPhone) {
            await this.linkContractDocumentsByPhone(branchid, client, normalizedPhone);
        }
        await this.serviceRecordLifecycleService?.ensureForClient(client.id);

        if (applyMessageAutomation) {
            await this.messageAutomationIntentService.fulfillClientIntent({
                branchId: branchid,
                clientId: client.id,
                includePast: true,
                suppressGreeting: suppressGreetingSms,
            }).catch((error) => {
                this.logger.error(`Failed to fulfill client message intent: ${error}`);
            });
        }
        if (createdScheduleId !== null && applyMessageAutomation) {
            await this.messageAutomationIntentService.fulfillScheduleIntent({
                branchId: branchid,
                scheduleId: createdScheduleId,
                includePast: true,
            }).catch((error) => {
                this.logger.error(`Failed to fulfill assignment message intent: ${error}`);
            });
        }

        return client;
    }

    async findAll(branchid: string): Promise<ClientWithEmployees[]> {
        const clients = await this.listClientsUsecase.execute(branchid);
        return this.attachEmployeesToClients(clients, branchid);
    }

    async findAllPaginated(
        branchid: string,
        page: number,
        limit: number,
        search?: string
    ): Promise<PaginatedClientWithEmployees> {
        const result = await this.listClientsPaginatedUsecase.execute(
            branchid,
            page,
            limit,
            search
        );
        const clientsWithEmployees = await this.attachEmployeesToClients(result.data, branchid);
        return {
            data: clientsWithEmployees,
            total: result.total,
            page: result.page,
            limit: result.limit,
            totalPages: result.totalPages,
        };
    }

    async checkPhoneExists(branchid: string, phone: string | null | undefined): Promise<boolean> {
        const normalizedPhone = normalizePhone(phone);
        if (!normalizedPhone) return false;

        const existing = await this.clientRepository.findByPhone(branchid, normalizedPhone);
        return existing !== null;
    }

    async findById(branchid: string, id: number): Promise<ClientWithEmployees | null> {
        const client = await this.findClientByIdUsecase.execute(branchid, id);
        if (!client) return null;

        const [withEmployees] = await this.attachEmployeesToClients([client], branchid);
        return withEmployees ?? null;
    }

    async findByFilter(branchid: string, filter: string): Promise<ClientWithEmployees[]> {
        let clients: ClientEntity[];

        switch (filter) {
            case 'starting-soon':
                clients = await this.clientRepository.findStartingWithinDays(
                    branchid,
                    FILTER_DAYS_THRESHOLD
                );
                break;
            case 'ending-soon':
                clients = await this.clientRepository.findEndingWithinDays(
                    branchid,
                    FILTER_DAYS_THRESHOLD
                );
                break;
            case 'incomplete-contracts':
                clients = await this.clientRepository.findWithIncompleteContractsStartingWithinDays(
                    branchid,
                    FILTER_DAYS_THRESHOLD
                );
                break;
            case 'no-contract':
                clients = await this.clientRepository.findWithoutContractSentStartingWithinDays(
                    branchid,
                    FILTER_DAYS_THRESHOLD
                );
                break;
            default:
                this.logger.warn(`Unknown filter: ${filter}`);
                clients = [];
        }

        return this.attachEmployeesToClients(clients, branchid);
    }

    /**
     * Helper method to attach employee info to clients and compute service status
     * Implements lazy update: computes status on access and updates DB if changed
     */
    private async attachEmployeesToClients(
        clients: ClientEntity[],
        branchid: string,
    ): Promise<ClientWithEmployees[]> {
        if (clients.length === 0) return [];

        const clientIds = clients.map(c => c.id);

        // Get all active schedules for these clients with employee info
        const schedules = await this.prismaService.employee_schedule.findMany({
            where: {
                clientId: { in: clientIds },
                replaced: false,
            },
            include: {
                primaryEmployee: true,
                secondaryEmployee: true,
            },
        });

        // Create a map of clientId to schedule
        const scheduleMap = new Map(schedules.map(s => [s.clientId, s]));

        const pendingScheduleChanges = await this.prismaService.schedule_change_request.findMany({
            where: { clientId: { in: clientIds }, status: "pending" },
            select: {
                id: true,
                clientId: true,
                sessionIndex: true,
                fromDate: true,
                toDate: true,
                oldEndDate: true,
                newEndDate: true,
            },
        });
        const pendingScheduleChangeMap = new Map(pendingScheduleChanges.map(change => [change.clientId, change]));

        // 현재 페이지 고객의 계약 문서만 한 번에 조회하고, 고객별 최신 상태를 사용한다.
        const latestContractMap = await this.findLatestContractByClientId(clientIds);

        // Compute and update service status for each client (lazy update strategy)
        const clientsNeedingUpdate: {
            id: number;
            expectedServiceStatus: string | null;
            newStatus: ServiceStatusType;
        }[] = [];

        const result = clients.map(client => {
            const schedule = scheduleMap.get(client.id);
            const pendingScheduleChange = pendingScheduleChangeMap.get(client.id);

            // Compute current service status based on dates
            const computedStatus = computeServiceStatus(
                client.serviceStatus,
                client.startDate,
                client.endDate,
            );

            // Track clients that need status update in DB
            if (isAutomaticServiceStatusTransitionAllowed(client.serviceStatus, computedStatus)) {
                clientsNeedingUpdate.push({
                    id: client.id,
                    expectedServiceStatus: client.serviceStatus,
                    newStatus: computedStatus,
                });
            }
            const latestContract = latestContractMap.get(client.id);
            const documentStatus = latestContract?.permanentPurgeRequestedAt != null
                ? "deleted"
                : this.mapStatusTypeToDocumentStatus(latestContract?.statusType);
            const hasActiveContractDocument = ACTIVE_DOCUMENT_STATUSES.has(documentStatus);
            const contractSignals = {
                serviceStatus: computedStatus,
                startDate: client.startDate,
                hasActiveContractDocument,
            };
            const badges = this.buildClientBadges({
                contractActionRequired: this.computeContractActionRequired(contractSignals),
                serviceStatus: computedStatus,
                breastPump: client.breastPump,
                careCenter: client.careCenter,
            });
            const actionRequired = this.computeActionRequired(contractSignals);

                return {
                    id: client.id,
                    name: client.name,
                    createdAt: client.createdAt,
                    address: client.address,
                    phone: client.phone,
                    type: client.type,
                    duration: client.duration,
                    fullPrice: client.fullPrice,
                    grant: client.grant,
                    actualPrice: client.actualPrice,
                    startDate: client.startDate,
                    endDate: client.endDate,
                    careCenter: client.careCenter,
                    voucherClient: client.voucherClient,
                    birthday: client.birthday,
                    dueDate: client.dueDate,
                    birthDate: client.birthDate,
                    serviceStatus: computedStatus, // Return computed status, not stored one
                    breastPump: client.breastPump,
                    eDocId: client.eDocId,
                    areaId: client.areaId,
                    hasSigned: client.eDocId !== null,
                    documentStatus,
                    badges,
                    actionRequired,
                    primaryEmployee: schedule?.primaryEmployee
                        ? {
                            id: schedule.primaryEmployee.id,
                            name: schedule.primaryEmployee.name,
                            phone: schedule.primaryEmployee.phone ?? null,
                        }
                        : null,
                    secondaryEmployee: schedule?.secondaryEmployee
                        ? {
                            id: schedule.secondaryEmployee.id,
                            name: schedule.secondaryEmployee.name,
                            phone: schedule.secondaryEmployee.phone ?? null,
                        }
                        : null,
                    // Guard against legacy rows whose date columns are null at the DB
                    // level even though the schema now types them non-null — calling
                    // toISOString() on such a null throws and 500s the whole overview.
                    pendingScheduleChange:
                        pendingScheduleChange
                        && pendingScheduleChange.fromDate
                        && pendingScheduleChange.toDate
                        && pendingScheduleChange.oldEndDate
                        && pendingScheduleChange.newEndDate
                        ? {
                            id: pendingScheduleChange.id,
                            sessionIndex: pendingScheduleChange.sessionIndex,
                            fromDate: pendingScheduleChange.fromDate.toISOString().slice(0, 10),
                            toDate: pendingScheduleChange.toDate.toISOString().slice(0, 10),
                            oldEndDate: pendingScheduleChange.oldEndDate.toISOString().slice(0, 10),
                            newEndDate: pendingScheduleChange.newEndDate.toISOString().slice(0, 10),
                        }
                        : null,
                };
            });

        // Batch update clients whose status changed (non-blocking)
        if (clientsNeedingUpdate.length > 0) {
            this.updateServiceStatusesInBackground(branchid, clientsNeedingUpdate);
        }

        return result;
    }

    /**
     * Background update of service statuses (fire-and-forget)
     * Does not block the main response
     */
    private updateServiceStatusesInBackground(
        branchid: string,
        updates: {
            id: number;
            expectedServiceStatus: string | null;
            newStatus: ServiceStatusType;
        }[],
    ): void {
        // Use Promise.allSettled to handle each update independently
        Promise.allSettled(
            updates.map(async ({ id, expectedServiceStatus, newStatus }) => {
                try {
                    const result = await this.clientRepository.updateServiceStatusIfCurrent(
                        branchid,
                        id,
                        expectedServiceStatus,
                        newStatus,
                    );
                    if (result === "updated") {
                        this.logger.debug(`Updated client ${id} service status to ${newStatus}`);
                    } else {
                        this.logger.debug(`Skipped stale client ${id} service status update`);
                    }
                } catch (error) {
                    this.logger.warn(`Failed to update client ${id} service status: ${error}`);
                }
            })
        ).catch(error => {
            this.logger.error(`Error in background status updates: ${error}`);
        });
    }

    /**
     * Keep client-name assignment refreshes durable when the immediate rebuild
     * cannot complete. The intent writer owns branch/schedule deduplication;
     * this helper only selects the active schedules in the caller's branch and
     * persists their existing schedule intents in one transaction.
     */
    private async persistEmployeeAssignmentRefreshIntents(
        branchId: string,
        clientId: number,
    ): Promise<void> {
        try {
            const activeSchedules = await this.prismaService.employee_schedule.findMany({
                where: { branchId, clientId, replaced: false },
                select: { id: true },
                orderBy: { id: "asc" },
            });
            const scheduleIds = [...new Set(activeSchedules.map(({ id }) => id))]
                .sort((left, right) => left - right);
            if (scheduleIds.length === 0) return;

            const intentAt = new Date();
            await this.prismaService.$transaction(async (transaction) => {
                for (const scheduleId of scheduleIds) {
                    await this.messageAutomationIntentService.persistScheduleIntent(transaction, {
                        branchId,
                        clientId,
                        scheduleId,
                        includePast: true,
                        intentAt,
                        replaceExisting: true,
                    });
                }
            });
        } catch (error) {
            this.logger.error(
                `Failed to persist employee assignment refresh retries for client ${clientId}: ` +
                `${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    private mapStatusTypeToDocumentStatus(statusType?: string): DocumentStatusType {
        const normalized = statusType?.trim().padStart(3, "0");
        if (!normalized) return null;

        if (COMPLETED_DOCUMENT_STATUS_TYPES.has(normalized)) return "completed";
        if (REJECTED_DOCUMENT_STATUS_TYPES.has(normalized)) return "rejected";
        if (REVOKED_DOCUMENT_STATUS_TYPES.has(normalized)) return "revoked";
        if (DELETED_DOCUMENT_STATUS_TYPES.has(normalized)) return "deleted";
        if (OPENED_DOCUMENT_STATUS_TYPES.has(normalized)) return "opened";
        if (CREATED_DOCUMENT_STATUS_TYPES.has(normalized)) return "created";
        if (REQUESTED_DOCUMENT_STATUS_TYPES.has(normalized)) return "requested";
        return null;
    }

    async update(branchid: string, id: number, params: {
        name?: string;
        primaryEmployeeId?: number;
        secondaryEmployeeId?: number | null;
        address?: string | null;
        phone?: string | null;
        type?: string | null;
        duration?: number | null;
        fullPrice?: string | null;
        grant?: string | null;
        actualPrice?: string | null;
        startDate?: string | null;
        endDate?: string | null;
        careCenter?: boolean | null;
        voucherClient?: boolean;
        birthday?: string | null;
        dueDate?: string | null;
        birthDate?: string | null;
        serviceStatus?: string | null;
        breastPump?: boolean;
        eDocId?: string | null;
        areaId?: string | null;
    }): Promise<ClientEntity> {
        // Keep invalid phone input from reaching lifecycle/provider work or a
        // transaction that could partially mutate schedule state.
        assertClientPhoneInput(params.phone);
        // Get existing client
        const existingClient = await this.findClientByIdUsecase.execute(branchid, id);
        if (!existingClient) {
            throw new NotFoundException(`Client with id ${id} not found`);
        }

        for (const field of ["name", "voucherClient", "breastPump"] as const) {
            if (Object.prototype.hasOwnProperty.call(params, field) && params[field] === null) {
                throw new BadRequestException(`${field} cannot be null`);
            }
        }

        const hasRequestedUpdate = Object.values(params).some((value) => value !== undefined);
        if (!hasRequestedUpdate) {
            const existingPhone = normalizePhone(existingClient.phone);
            if (existingPhone) {
                await this.linkContractDocumentsByPhone(branchid, existingClient, existingPhone);
            }
            return existingClient;
        }

        const hasPricingUpdate = params.voucherClient !== undefined
            || params.type !== undefined
            || params.duration !== undefined
            || params.fullPrice !== undefined
            || params.grant !== undefined
            || params.actualPrice !== undefined;
        const normalizedPricing = hasPricingUpdate
            ? normalizeClientPricing({
                voucherClient: params.voucherClient ?? existingClient.voucherClient,
                type: params.type === undefined ? existingClient.type : params.type,
                fullPrice: params.fullPrice === undefined ? existingClient.fullPrice : params.fullPrice,
                grant: params.grant === undefined ? existingClient.grant : params.grant,
                actualPrice: params.actualPrice === undefined ? existingClient.actualPrice : params.actualPrice,
            })
            : null;
        assertAllowedServiceStatus(params.serviceStatus);
        await assertAllowedClientArea(this.prismaService, branchid, params.areaId);
        const startDateUpdate = params.startDate === undefined ? undefined : parseClientDate(params.startDate);
        const endDateUpdate = params.endDate === undefined ? undefined : parseClientDate(params.endDate);
        // Parsed the same way as the service period above and as create() does,
        // rather than with a raw `new Date`: that reads "2026-08" as 1 August
        // and hands anything it cannot parse to Prisma as an Invalid Date. Both
        // become a 400 here instead, and before the transaction opens.
        const dueDateUpdate = params.dueDate === undefined ? undefined : parseClientDate(params.dueDate);
        const birthDateUpdate = params.birthDate === undefined ? undefined : parseClientDate(params.birthDate);
        const { existingClient: clientWithPhone } = await findClientByNormalizedPhone(
            this.clientRepository,
            branchid,
            params.phone,
        );
        if (clientWithPhone && clientWithPhone.id !== id) {
            throw new ConflictException({ statusCode: 409, code: "P2002", error: "Conflict", field: "phone" });
        }

        // Keep the display value untouched while persisting the canonical
        // identity key used by branch-scoped uniqueness and lookups.
        const normalizedPhoneUpdate = params.phone === undefined
            ? undefined
            : normalizePhone(params.phone);

        const mergedServicePeriod = mergeAndValidateClientServicePeriod(existingClient, {
            startDate: startDateUpdate,
            endDate: endDateUpdate,
        });
        const hasDateUpdate = params.startDate !== undefined || params.endDate !== undefined;
        const derivedDuration = deriveClientDuration(
            mergedServicePeriod.startDate,
            mergedServicePeriod.endDate,
        );
        assertClientDurationMatchesDates(params.duration, derivedDuration);
        if (hasDateUpdate && params.duration === null && derivedDuration !== null) {
            throw new BadRequestException(
                `duration cannot exceed the Korean business-day count (${derivedDuration}) for the submitted service period`,
            );
        }
        if (hasDateUpdate && derivedDuration === null && params.duration !== undefined && params.duration !== null) {
            throw new BadRequestException("duration requires a complete service period");
        }
        // duration is the contracted session count and is authoritative once
        // set: a supplied value always wins and is never overwritten by the
        // date-derived count. When the caller omits duration it is left
        // untouched (undefined => no column update), except to fill a null
        // duration once the service period becomes complete, so a client
        // created without dates still ends up with a persisted count.
        const duration = params.duration !== undefined
            ? params.duration
            : existingClient.duration === null && derivedDuration !== null
                ? derivedDuration
                : undefined;
        await this.serviceRecordLifecycleService?.validatePeriodChange({
            clientId: id,
            startDate: startDateUpdate,
            endDate: endDateUpdate,
            duration,
        });
        const startDate = mergedServicePeriod.startDate ?? new Date();
        const endDate = mergedServicePeriod.endDate ?? new Date(startDate.getTime() + DEFAULT_SERVICE_PERIOD_MS);

        // Check if employee assignment is being changed
        const employeeChanged = params.primaryEmployeeId !== undefined || params.secondaryEmployeeId !== undefined;
        const clientNameSupplied = params.name !== undefined;

        let createdScheduleId: number | null = null;
        let replacedScheduleId: number | null = null;

        await this.prismaService.$transaction(async (transaction) => {
            if (employeeChanged) {
                await lockClientForScheduleWrite(transaction, branchid, id);
                const currentSchedule = await transaction.employee_schedule.findFirst({
                    where: { clientId: id, branchId: branchid, replaced: false },
                    orderBy: { id: "desc" },
                });
                const currentPrimaryEmployeeId = currentSchedule?.primaryEmployeeId ?? null;
                const currentSecondaryEmployeeId = currentSchedule?.secondaryEmployeeId ?? null;
                const primaryEmployeeId = params.primaryEmployeeId ?? currentPrimaryEmployeeId;
                const secondaryEmployeeId = params.secondaryEmployeeId !== undefined
                    ? params.secondaryEmployeeId
                    : currentSecondaryEmployeeId;
                assertEmployeeAssignmentShape(primaryEmployeeId, secondaryEmployeeId);
                const assignmentChanged = primaryEmployeeId !== currentPrimaryEmployeeId
                    || secondaryEmployeeId !== currentSecondaryEmployeeId;
                if (assignmentChanged) {
                    if (primaryEmployeeId === null) {
                        throw new BadRequestException("primary employee is required to create an assignment");
                    }
                    const retainedEmployeeIds = new Set(
                        [currentPrimaryEmployeeId, currentSecondaryEmployeeId]
                            .filter((employeeId): employeeId is number => employeeId !== null),
                    );
                    await this.assertAllowedEmployees(
                        branchid,
                        primaryEmployeeId,
                        secondaryEmployeeId,
                        transaction,
                        retainedEmployeeIds,
                    );
                    // One handover instant for the whole transaction. The outgoing row has to
                    // end on exactly the day the incoming row starts, so the clock is read
                    // once here rather than per write, where the two could straddle midnight.
                    const handover = currentSchedule
                        ? ((): { outgoingEndDate: Date; startDate: Date; endDate: Date } => {
                            const outgoingEndDate = employeeScheduleReplacementEndDate(
                                new Date(),
                                currentSchedule.startDate,
                            );
                            return {
                                outgoingEndDate,
                                ...employeeScheduleHandoverPeriod({
                                    replacementAt: outgoingEndDate,
                                    contractStartDate: startDate,
                                    contractEndDate: endDate,
                                }),
                            };
                        })()
                        : null;
                    // A first assignment keeps the contract period; only a handover moves the start.
                    const incomingStartDate = handover?.startDate ?? startDate;
                    const incomingEndDate = handover?.endDate ?? endDate;
                    await assertNoActiveEmployeeScheduleOverlap(transaction, {
                        branchId: branchid,
                        clientId: id,
                        primaryEmployeeId,
                        secondaryEmployeeId,
                        startDate: incomingStartDate,
                        endDate: incomingEndDate,
                        replaced: false,
                        excludeScheduleId: currentSchedule?.id,
                    });
                    if (currentSchedule && handover) {
                        await transaction.employee_schedule.update({
                            where: { id: currentSchedule.id },
                            data: {
                                replaced: true,
                                endDate: handover.outgoingEndDate,
                            },
                        });
                        replacedScheduleId = currentSchedule.id;
                    }
                    const schedule = await transaction.employee_schedule.create({
                        data: {
                            clientId: id,
                            branchId: branchid,
                            primaryEmployeeId,
                            secondaryEmployeeId,
                            workAddress: params.address ?? existingClient.address ?? "",
                            startDate: incomingStartDate,
                            endDate: incomingEndDate,
                            replaced: false,
                        },
                    });
                    createdScheduleId = schedule.id;
                }
            }

            const result = await transaction.client.updateMany({
                where: { id, branchId: branchid },
                data: {
                    name: params.name,
                    address: params.address === undefined ? undefined : params.address,
                    phone: params.phone === undefined ? undefined : params.phone,
                    phoneNormalized: normalizedPhoneUpdate,
                    type: normalizedPricing?.type,
                    duration: duration === undefined ? undefined : duration,
                    fullPrice: normalizedPricing?.fullPrice,
                    grant: normalizedPricing?.grant,
                    actualPrice: normalizedPricing?.actualPrice,
                    startDate: startDateUpdate,
                    endDate: endDateUpdate,
                    careCenter: params.careCenter === undefined ? undefined : params.careCenter,
                    voucherClient: params.voucherClient,
                    birthday: params.birthday === undefined ? undefined : params.birthday,
                    dueDate: dueDateUpdate,
                    birthDate: birthDateUpdate,
                    serviceStatus: params.serviceStatus === undefined ? undefined : params.serviceStatus,
                    breastPump: params.breastPump,
                    eDocId: params.eDocId === undefined ? undefined : params.eDocId,
                    areaId: params.areaId === undefined ? undefined : params.areaId,
                },
            });
            if (result.count === 0) {
                throw new NotFoundException(`Client with id ${id} not found`);
            }
        });

        if (replacedScheduleId !== null) {
            await this.revokeServiceRecordLinkAfterCommit(id, replacedScheduleId);
        }
        const updatedClient = await this.findClientByIdUsecase.execute(branchid, id);
        if (!updatedClient) {
            throw new NotFoundException(`Client with id ${id} not found`);
        }
        const updatedPhone = normalizePhone(updatedClient.phone);
        if (updatedPhone) {
            await this.linkContractDocumentsByPhone(branchid, updatedClient, updatedPhone);
        }
        await this.serviceRecordLifecycleService?.ensureForClient(id);
        if (this.triggerService) {
            await this.triggerService.syncClientRulesForClient(branchid, id, false).catch((error) => {
                this.logger.error(`Failed to sync client trigger rules: ${error}`);
            });
            if (clientNameSupplied) {
                try {
                    const refreshed = await this.triggerService.syncEmployeeAssignmentRulesForClient(branchid, id);
                    if (refreshed === false) {
                        await this.persistEmployeeAssignmentRefreshIntents(branchid, id);
                    }
                } catch (error) {
                    this.logger.error(`Failed to sync employee assignment triggers for client ${id}: ${error}`);
                    await this.persistEmployeeAssignmentRefreshIntents(branchid, id);
                }
            }
        }
        if (createdScheduleId !== null) {
            if (!clientNameSupplied) {
                await this.triggerService
                    ?.syncEmployeeAssignmentRulesForSchedule(branchid, createdScheduleId, true)
                    ?.catch((error) => {
                        this.logger.error(`Failed to sync employee assignment triggers: ${error}`);
                    });
            }
            await this.serviceRecordLinkService
                ?.scheduleForServiceStart(createdScheduleId)
                ?.catch((error) => {
                    this.logger.error(`Failed to schedule service-record link SMS: ${error}`);
                });
        }
        return updatedClient;
    }

    /**
     * Terminate a client's service (manual status change)
     * Sets serviceStatus to 'terminated' and ends the service immediately
     * @param clientId - The client ID
     * @param reason - Optional termination reason for logging
     */
    async terminateService(
        branchid: string,
        clientId: number,
        reason?: string
    ): Promise<ClientEntity> {
        const client = await this.findClientByIdUsecase.execute(branchid, clientId);
        if (!client) {
            throw new NotFoundException(`Client with id ${clientId} not found`);
        }
        this.logger.log(
            `Terminating service for client ${clientId}` +
            (reason ? `: ${reason}` : "")
        );

        await this.serviceRecordLifecycleService?.validatePeriodChange({
            clientId,
            endDate: new Date(),
        });

        // Update client with terminated status and set endDate to today
        const updatedClient = await this.updateClientUsecase.execute(branchid, clientId, {
            serviceStatus: SERVICE_STATUS.TERMINATED,
            endDate: new Date(),
        });
        if (this.triggerService) {
            await this.triggerService.syncClientRulesForClient(branchid, clientId, false).catch((error) => {
                this.logger.error(`Failed to sync client trigger rules: ${error}`);
            });
        }

        // Also mark the current schedules as terminated. This records the termination
        // on its own column rather than overwriting end_date: the contracted period
        // stays readable, and a service terminated before it started can no longer
        // produce start_date > end_date. Readers that ask "is this assignment live"
        // filter on terminatedAt, not on the dates.
        await this.prismaService.employee_schedule.updateMany({
            where: { clientId, branchId: branchid, replaced: false, terminatedAt: null },
            data: { terminatedAt: new Date() },
        });

        // Revoke any outstanding service-record links for this client's active assignments
        const activeSchedules = await this.prismaService.employee_schedule.findMany({
            where: { clientId, branchId: branchid, replaced: false },
            select: { id: true },
        });
        for (const activeSchedule of activeSchedules) {
            await this.revokeServiceRecordLinkAfterCommit(clientId, activeSchedule.id);
        }
        await this.serviceRecordLifecycleService?.markTerminated(clientId);

        return updatedClient;
    }

    /**
     * Request a provider replacement for a client
     * Sets serviceStatus to 'replacement_requested' to indicate pending change
     * @param clientId - The client ID
     * @param newPrimaryEmployeeId - The new primary employee to assign
     * @param newSecondaryEmployeeId - Optional new secondary employee
     */
    async requestReplacement(
        branchid: string,
        clientId: number,
        newPrimaryEmployeeId: number,
        newSecondaryEmployeeId?: number | null,
    ): Promise<ClientEntity> {
        const client = await this.findClientByIdUsecase.execute(branchid, clientId);
        if (!client) {
            throw new NotFoundException(`Client with id ${clientId} not found`);
        }
        assertEmployeeAssignmentShape(newPrimaryEmployeeId, newSecondaryEmployeeId ?? null);

        mergeAndValidateClientServicePeriod(client, {});
        const replacementStartDate = new Date();
        const replacementEndDate = client.endDate && client.endDate.getTime() >= replacementStartDate.getTime()
            ? client.endDate
            : new Date(replacementStartDate.getTime() + DEFAULT_SERVICE_PERIOD_MS);

        this.logger.log(
            `Replacement requested for client ${clientId}: ` +
            `new primary=${newPrimaryEmployeeId}, secondary=${newSecondaryEmployeeId ?? "none"}`
        );

        let replacedScheduleId: number | null = null;
        const replacementSchedule = await this.prismaService.$transaction(async (transaction) => {
            await lockClientForScheduleWrite(transaction, branchid, clientId);
            const currentSchedule = await transaction.employee_schedule.findFirst({
                where: { clientId, branchId: branchid, replaced: false },
                orderBy: { id: "desc" },
            });
            const retainedEmployeeIds = new Set(
                [currentSchedule?.primaryEmployeeId ?? null, currentSchedule?.secondaryEmployeeId ?? null]
                    .filter((employeeId): employeeId is number => employeeId !== null),
            );
            await this.assertAllowedEmployees(
                branchid,
                newPrimaryEmployeeId,
                newSecondaryEmployeeId ?? null,
                transaction,
                retainedEmployeeIds,
            );
            await assertNoActiveEmployeeScheduleOverlap(transaction, {
                branchId: branchid,
                clientId,
                primaryEmployeeId: newPrimaryEmployeeId,
                secondaryEmployeeId: newSecondaryEmployeeId ?? null,
                startDate: replacementStartDate,
                endDate: replacementEndDate,
                replaced: false,
                excludeScheduleId: currentSchedule?.id,
            });
            const updateResult = await transaction.client.updateMany({
                where: { id: clientId, branchId: branchid },
                data: { serviceStatus: SERVICE_STATUS.REPLACEMENT_REQUESTED },
            });
            if (updateResult.count === 0) {
                throw new NotFoundException(`Client with id ${clientId} not found`);
            }

            if (currentSchedule) {
                await transaction.employee_schedule.update({
                    where: { id: currentSchedule.id },
                    data: {
                        replaced: true,
                        endDate: employeeScheduleReplacementEndDate(replacementStartDate, currentSchedule.startDate),
                    },
                });
                replacedScheduleId = currentSchedule.id;
            }

            return transaction.employee_schedule.create({
                data: {
                    clientId,
                    branchId: branchid,
                    primaryEmployeeId: newPrimaryEmployeeId,
                    secondaryEmployeeId: newSecondaryEmployeeId ?? null,
                    workAddress: client.address ?? "",
                    startDate: replacementStartDate,
                    endDate: replacementEndDate,
                    replaced: false,
                },
            });
        });
        if (replacedScheduleId !== null) {
            await this.revokeServiceRecordLinkAfterCommit(clientId, replacedScheduleId);
        }
        await this.triggerService
            ?.syncEmployeeAssignmentRulesForSchedule(branchid, replacementSchedule.id, true)
            ?.catch((error) => {
                this.logger.error(`Failed to sync replacement assignment triggers: ${error}`);
            });
        await this.serviceRecordLifecycleService?.ensureForClient(clientId);
        await this.serviceRecordLinkService
            ?.scheduleForServiceStart(replacementSchedule.id)
            ?.catch((error) => {
                this.logger.error(`Failed to schedule replacement service-record link SMS: ${error}`);
            });

        const updatedClient = await this.findClientByIdUsecase.execute(branchid, clientId);
        if (!updatedClient) {
            throw new NotFoundException(`Client with id ${clientId} not found`);
        }
        return updatedClient;
    }

    /**
     * Complete a replacement and restore service to active status
     * Call this after the replacement has been processed
     * @param clientId - The client ID
     */
    async completeReplacement(branchid: string, clientId: number): Promise<ClientEntity> {
        const client = await this.findClientByIdUsecase.execute(branchid, clientId);
        if (!client) {
            throw new NotFoundException(`Client with id ${clientId} not found`);
        }

        if (client.serviceStatus !== SERVICE_STATUS.REPLACEMENT_REQUESTED) {
            this.logger.warn(
                `Client ${clientId} is not in replacement_requested status, ` +
                `current status: ${client.serviceStatus}`
            );
        }

        this.logger.log(`Completing replacement for client ${clientId}`);

        // Compute what the status should be based on dates (usually 'active')
        const computedStatus = computeServiceStatus(
            null, // Ignore current status, compute fresh
            client.startDate,
            client.endDate,
        );

        const updatedClient = await this.updateClientUsecase.execute(branchid, clientId, {
            serviceStatus: computedStatus,
        });
        await this.serviceRecordLifecycleService?.ensureForClient(clientId);
        return updatedClient;
    }

    async delete(branchid: string, id: number): Promise<void> {
        await this.deleteClientUsecase.execute(branchid, id);
        // The delete use case holds the client row lock and rejects any
        // retained message-trigger job before the physical delete. Keep this
        // legacy cleanup hook after a successful delete so a blocked request
        // cannot partially mutate pending jobs.
        await this.triggerService?.cancelPendingJobsForClientDeletion(branchid, id);
    }

    async getStats(branchid: string): Promise<{
        activeClients: number;
        contractsNotSent: number;
        contractsPendingSignature: number;
        upcomingThisMonth: number;
        upcomingNextMonth: number;
    }> {
        const now = new Date();
        const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const thisMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
        const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        const nextMonthEnd = new Date(now.getFullYear(), now.getMonth() + 2, 0, 23, 59, 59);

        const [activeClients, contractsNotSent, branchClients, upcomingThisMonth, upcomingNextMonth] =
            await Promise.all([
                this.prismaService.client.count({
                    where: { serviceStatus: SERVICE_STATUS.ACTIVE, branchId: branchid },
                }),
                this.prismaService.client.count({
                    where: {
                        eDocId: null,
                        serviceStatus: SERVICE_STATUS.WAITING,
                        branchId: branchid,
                    },
                }),
                this.prismaService.client.findMany({
                    where: { branchId: branchid },
                    select: { id: true },
                }),
                this.prismaService.client.count({
                    where: {
                        serviceStatus: SERVICE_STATUS.WAITING,
                        startDate: { gte: thisMonthStart, lte: thisMonthEnd },
                        branchId: branchid,
                    },
                }),
                this.prismaService.client.count({
                    where: {
                        serviceStatus: SERVICE_STATUS.WAITING,
                        startDate: { gte: nextMonthStart, lte: nextMonthEnd },
                        branchId: branchid,
                    },
                }),
            ]);

        // 대시보드의 "검토 필요 문서"는 계약서 목록과 같은 규칙으로 센다: 제공기관
        // 검토 단계에 있고 검토 창(계약 종료 영업일 1일 전~)이 열린 문서만.
        const latestContracts = await this.findLatestContractByClientId(
            branchClients.map((client) => client.id),
        );
        const contractsPendingSignature = [...latestContracts.values()].filter((doc) => {
            if (
                doc.permanentPurgeRequestedAt != null
                || DELETED_DOCUMENT_STATUS_TYPES.has(doc.statusType.trim().padStart(3, "0"))
            ) {
                return false;
            }
            const endDate = doc.detailPayload && typeof doc.detailPayload === "object"
                ? extractEformsignContractEndDate(doc.detailPayload as unknown as EformsignApiDocumentResponse)
                : null;
            return resolveEformsignDocDisplayStatus({
                id: doc.documentId,
                current_status: {
                    status_type: doc.statusType,
                    step_type: doc.stepType,
                    step_name: doc.stepName,
                },
                ...(endDate ? { contract_end_date: endDate.toISOString().slice(0, 10) } : {}),
            }) === "review";
        }).length;

        return { activeClients, contractsNotSent, contractsPendingSignature, upcomingThisMonth, upcomingNextMonth };
    }

    async getDashboardOverview(
        branchid: string,
        limit = 50,
    ): Promise<DashboardOverview> {
        const [stats, clients] = await Promise.all([
            this.getStats(branchid),
            this.findAllPaginated(branchid, 1, limit),
        ]);

        return { stats, clients };
    }

    async getActionRequiredAlerts(
        branchid: string,
        limit = 3,
    ): Promise<ClientActionRequiredAlert[]> {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // The window is business days, which spans more calendar days than its
        // count. Translate it into the exact calendar date it reaches so this
        // pre-filter only narrows the scan — computeActionRequired still decides
        // (it alone knows whether the latest document is active).
        const businessDayCutoff = (businessDays: number): Date => {
            const cutoff = new Date(
                `${addBusinessDaysKr(isoDateInKorea(today), businessDays)}T00:00:00.000Z`,
            );
            cutoff.setHours(23, 59, 59, 999);
            return cutoff;
        };

        const sendThresholdDate = businessDayCutoff(CONTRACT_SEND_BUSINESS_DAYS_THRESHOLD);

        const clients = await this.prismaService.client.findMany({
            where: {
                branchId: branchid,
                OR: [
                    { serviceStatus: SERVICE_STATUS.REPLACEMENT_REQUESTED },
                    {
                        OR: [
                            { serviceStatus: null },
                            { serviceStatus: { notIn: [SERVICE_STATUS.PRE_BOOKING, SERVICE_STATUS.COMPLETED, SERVICE_STATUS.TERMINATED] } },
                        ],
                        startDate: { lte: sendThresholdDate },
                    },
                ],
            },
            select: {
                id: true,
                name: true,
                createdAt: true,
                startDate: true,
                endDate: true,
                serviceStatus: true,
            },
            orderBy: { createdAt: "desc" },
            take: Math.max(limit * 4, 12),
        });

        // Reads the latest contract, matching the badge — not the document
        // pinned by eDocId, which can lag behind a re-issued contract.
        const hasActiveDocumentByClientId = await this.findHasActiveContractDocumentByClientId(
            clients.map((client) => client.id),
        );

        return clients
            .map((client): ClientActionRequiredAlert | null => {
                const serviceStatus = computeServiceStatus(
                    client.serviceStatus,
                    client.startDate,
                    client.endDate,
                );

                const actionRequired = this.computeActionRequired({
                    serviceStatus,
                    startDate: client.startDate,
                    hasActiveContractDocument: hasActiveDocumentByClientId.get(client.id) ?? false,
                });

                if (!actionRequired) {
                    return null;
                }

                return {
                    id: client.id,
                    name: client.name,
                    createdAt: client.createdAt ?? null,
                    ...actionRequired,
                };
            })
            .filter((alert): alert is ClientActionRequiredAlert => alert !== null)
            .sort((a, b) => a.priority - b.priority)
            .slice(0, limit);
    }
}

type ContractPhoneCandidate = {
    documentKind?: string | null;
    serviceRecordCaseId?: string | null;
    templateId?: string | null;
    stepRecipientSms?: string | null;
    customerPhone?: string | null;
    detailPayload?: Prisma.JsonValue | null;
};

function isMatchingContractPhoneCandidate(
    document: ContractPhoneCandidate,
    normalizedPhone: string,
    serviceRecordTemplateIds: ReadonlySet<string>,
): boolean {
    if (isServiceRecordEformsignDocument(document, serviceRecordTemplateIds)) {
        return false;
    }
    if (document.customerPhone) {
        return document.customerPhone === normalizedPhone;
    }
    if (
        typeof document.detailPayload === "object"
        && document.detailPayload !== null
        && !Array.isArray(document.detailPayload)
    ) {
        return eformsignCustomerPhone(
            document.detailPayload as unknown as EformsignApiDocumentResponse,
        ) === normalizedPhone;
    }
    return extractPhoneCandidates(document.stepRecipientSms).includes(normalizedPhone);
}

function sameMirrorGeneration(
    initialSourceUpdatedAt: Date | null | undefined,
    initialSyncedAt: Date | null | undefined,
    lockedSourceUpdatedAt: Date | null | undefined,
    lockedSyncedAt: Date | null | undefined,
): boolean {
    return initialSourceUpdatedAt?.getTime() === lockedSourceUpdatedAt?.getTime()
        && initialSyncedAt?.getTime() === lockedSyncedAt?.getTime();
}
