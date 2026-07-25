import { BadRequestException, ConflictException, Injectable, Inject, Logger, NotFoundException, Optional } from "@nestjs/common";
import { extractPhoneCandidates, normalizePhone } from "application/utils/normalize-phone";
import {
    CreateClientUsecase,
    DeleteClientUsecase,
    FindClientByIdUsecase,
    ListClientsUsecase,
    ListClientsPaginatedUsecase,
    UpdateClientUsecase,
} from "application/usecases/client";
import { ClientEntity } from "domain/entities/client.entity";
import { EFORMSIGN_DOCUMENT_KIND } from "domain/entities/eformsign-doc.entity";
import { CLIENT_REPOSITORY, IClientRepository } from "domain/repositories/client.repository.interface";
import { normalizeClientPricing } from "domain/services/client-pricing";
import { diffBusinessDaysKr } from "domain/utils/business-days";
import { PrismaService } from "infrastructure/database/prisma.service";
import { computeServiceStatus, isServiceStatus, SERVICE_STATUS, SERVICE_STATUS_VALUES, ServiceStatusType } from "domain/value-objects/service-status.vo";
import { MessageTriggerService } from "./message-trigger.service";
import { ServiceRecordLinkService } from "./service-record-link.service";
import { ServiceRecordLifecycleService } from "./service-record-lifecycle.service";
import { SystemSettingService } from "./system-setting.service";

const FILTER_DAYS_THRESHOLD = 7;
const CONTRACT_REQUIRED_BUSINESS_DAYS_THRESHOLD = 3;
const ACTION_REQUIRED_SIGNATURE_THRESHOLD_DAYS = 2;
const ACTION_REQUIRED_SEND_THRESHOLD_DAYS = 6;
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
    serviceStatus: string | null;
    breastPump: boolean;
    eDocId: string | null;
    areaId: string | null;
    hasSigned: boolean;
    documentStatus: DocumentStatusType;
    badges: ClientBadge[];
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

export interface ClientActionRequiredAlert {
    id: number;
    name: string;
    createdAt: Date | null;
    reason: ActionRequiredReason;
    priority: 1 | 2 | 3;
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
        @Optional() private readonly triggerService?: MessageTriggerService,
        @Optional() private readonly serviceRecordLinkService?: ServiceRecordLinkService,
        @Optional() private readonly serviceRecordLifecycleService?: ServiceRecordLifecycleService,
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

    private assertAllowedServiceStatus(status: string | null | undefined): void {
        if (status == null) return;

        if (!isServiceStatus(status)) {
            throw new BadRequestException(
                `serviceStatus must be one of: ${SERVICE_STATUS_VALUES.join(", ")}`
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
                    branchId: branchid,
                    serviceRecordCaseId: null,
                    stepRecipientSms: { contains: phoneLookupSuffix },
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
                    id: true,
                    documentId: true,
                    clientId: true,
                    stepRecipientSms: true,
                },
            });
            const matchingDocs = candidateDocs.filter((doc) =>
                extractPhoneCandidates(doc.stepRecipientSms).includes(normalizedPhone),
            );
            const documentIdsToReassign = matchingDocs
                .filter((doc) => doc.clientId !== client.id)
                .map((doc) => doc.id);
            const latestContract = matchingDocs[0];
            const shouldUpdateClientDocument = latestContract !== undefined
                && client.eDocId !== latestContract.documentId;

            if (documentIdsToReassign.length === 0 && !shouldUpdateClientDocument) {
                return;
            }

            await this.prismaService.$transaction(async (transaction) => {
                if (documentIdsToReassign.length > 0) {
                    const reassigned = await transaction.eformsign_doc.updateMany({
                        where: {
                            branchId: branchid,
                            id: { in: documentIdsToReassign },
                        },
                        data: { clientId: client.id },
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
        } catch (error) {
            const errorType = error instanceof Error ? error.name : "UnknownError";
            this.logger.error(
                `[CLIENT_CONTRACT_PHONE_LINK_FAILED] 고객 ${client.id} 계약서 자동 연결 실패 (${errorType})`,
            );
        }
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

    private buildClientBadges(params: {
        serviceStatus: string | null;
        documentStatus: DocumentStatusType;
        startDate: Date | null;
        breastPump: boolean;
        careCenter: boolean | null;
    }): ClientBadge[] {
        const badges: ClientBadge[] = [];
        const businessDaysUntilStart = params.startDate
            ? diffBusinessDaysKr(params.startDate.toISOString().slice(0, 10))
            : null;
        const isWaitingWithinContractWindow =
            params.serviceStatus === SERVICE_STATUS.WAITING &&
            businessDaysUntilStart !== null &&
            businessDaysUntilStart >= 0 &&
            businessDaysUntilStart <= CONTRACT_REQUIRED_BUSINESS_DAYS_THRESHOLD;
        const requiresContract =
            params.documentStatus !== "completed" &&
            (params.serviceStatus === SERVICE_STATUS.ACTIVE || isWaitingWithinContractWindow);

        if (requiresContract) {
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

    private async assertAllowedClientArea(branchid: string, areaId: string | null | undefined): Promise<void> {
        if (!areaId) return;

        const areaScope = branchid
            ? [{ branchId: branchid }, { branchId: null }]
            : [{ branchId: null }];
        const area = await this.prismaService.area.findFirst({
            where: {
                id: areaId,
                OR: areaScope,
            },
            select: { id: true },
        });

        if (!area) {
            throw new BadRequestException("areaId must reference an available area");
        }
    }

    private async assertAllowedEmployees(
        branchid: string,
        primaryEmployeeId: number | null,
        secondaryEmployeeId: number | null,
    ): Promise<void> {
        if (primaryEmployeeId === null) {
            if (secondaryEmployeeId !== null) {
                throw new BadRequestException("primary employee is required when a secondary employee is selected");
            }
            return;
        }
        if (primaryEmployeeId === secondaryEmployeeId) {
            throw new BadRequestException("주담당과 부담당은 같은 직원일 수 없습니다.");
        }

        const employeeIds = [primaryEmployeeId, secondaryEmployeeId].filter(
            (employeeId): employeeId is number => employeeId !== null,
        );
        const employees = await this.prismaService.employee.findMany({
            where: {
                id: { in: employeeIds },
                branchId: branchid,
                deletedAt: null,
            },
            select: { id: true },
        });
        if (employees.length !== employeeIds.length) {
            throw new BadRequestException("selected employees must belong to the client branch");
        }
    }

    private assertValidServicePeriod(startDate: Date | null, endDate: Date | null): void {
        if (startDate && endDate && startDate > endDate) {
            throw new BadRequestException("서비스 시작일은 종료일보다 늦을 수 없습니다.");
        }
    }

    private async syncEmployeeAssignment(branchid: string, params: {
        clientId: number;
        primaryEmployeeId?: number;
        secondaryEmployeeId?: number | null;
        workAddress: string;
        startDate: Date;
        endDate: Date;
    }): Promise<{ createdScheduleId: number | null; replacedScheduleId: number | null }> {
        const currentSchedule = await this.prismaService.employee_schedule.findFirst({
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
            return { createdScheduleId: null, replacedScheduleId: null };
        }

        await this.assertAllowedEmployees(branchid, newPrimaryEmployeeId, newSecondaryEmployeeId);
        if (newPrimaryEmployeeId === null) {
            throw new BadRequestException("primary employee is required to create an assignment");
        }

        const newSchedule = await this.prismaService.$transaction(async (transaction) => {
            if (currentSchedule) {
                await transaction.employee_schedule.update({
                    where: { id: currentSchedule.id },
                    data: { replaced: true, endDate: new Date() },
                });
            }
            return transaction.employee_schedule.create({
                data: {
                    clientId: params.clientId,
                    branchId: branchid,
                    primaryEmployeeId: newPrimaryEmployeeId,
                    secondaryEmployeeId: newSecondaryEmployeeId,
                    workAddress: params.workAddress,
                    startDate: params.startDate,
                    endDate: params.endDate,
                    replaced: false,
                },
            });
        });

        return {
            createdScheduleId: newSchedule.id,
            replacedScheduleId: currentSchedule?.id ?? null,
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
        serviceStatus?: string | null;
        breastPump: boolean;
        eDocId?: string | null;
        areaId?: string | null;
        suppressGreetingSms?: boolean;
        applyMessageAutomation?: boolean;
        reuseExistingClient?: boolean;
        source?: string;
    }): Promise<ClientEntity> {
        const startDate = params.startDate ? new Date(params.startDate) : null;
        const endDate = params.endDate ? new Date(params.endDate) : null;
        const dueDate = params.dueDate ? new Date(params.dueDate) : null;
        this.assertValidServicePeriod(startDate, endDate);
        this.assertAllowedServiceStatus(params.serviceStatus);
        await this.assertAllowedClientArea(branchid, params.areaId);

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

        const normalizedPhone = normalizePhone(params.phone ?? null);
        if (normalizedPhone) {
            const existing = await this.clientRepository.findByPhone(branchid, normalizedPhone);
            if (existing) {
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
                    });
                    if (assignment.replacedScheduleId !== null) {
                        await this.revokeServiceRecordLinkAfterCommit(
                            existing.id,
                            assignment.replacedScheduleId,
                        );
                    }
                    if (assignment.createdScheduleId !== null) {
                        await this.triggerService
                            ?.syncEmployeeAssignmentRulesForSchedule(branchid, assignment.createdScheduleId, true)
                            ?.catch((error) => {
                                this.logger.error(`Failed to sync employee assignment triggers: ${error}`);
                            });
                        this.serviceRecordLinkService
                            ?.scheduleForServiceStart(assignment.createdScheduleId)
                            ?.catch((error) => {
                                this.logger.error(`Failed to schedule feedback link SMS: ${error}`);
                            });
                    }
                }
                await this.linkContractDocumentsByPhone(branchid, existing, normalizedPhone);
                await this.serviceRecordLifecycleService?.ensureForClient(existing.id);
                return existing;
            }
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
            duration: params.duration ?? null,
            fullPrice: normalizedPricing.fullPrice,
            grant: normalizedPricing.grant,
            actualPrice: normalizedPricing.actualPrice,
            startDate: startDate,
            endDate: endDate,
            careCenter: params.careCenter,
            voucherClient: params.voucherClient,
            birthday: params.birthday ?? null,
            dueDate,
            serviceStatus: params.serviceStatus ?? null,
            breastPump: params.breastPump,
            eDocId: params.eDocId ?? null,
            areaId: params.areaId ?? null,
            suppressGreetingSms,
        };

        const primaryEmployeeId = params.primaryEmployeeId ?? null;
        const secondaryEmployeeId = params.secondaryEmployeeId ?? null;
        await this.assertAllowedEmployees(branchid, primaryEmployeeId, secondaryEmployeeId);

        let client: ClientEntity;
        let createdScheduleId: number | null = null;
        if (primaryEmployeeId !== null) {
            const result = await this.createClientUsecase.executeWithInitialSchedule(branchid, createParams, {
                primaryEmployeeId,
                secondaryEmployeeId,
                workAddress: params.address ?? "",
                startDate: startDate ?? new Date(),
                endDate: endDate ?? new Date(Date.now() + DEFAULT_SERVICE_PERIOD_MS),
            });
            client = result.client;
            createdScheduleId = result.scheduleId;
        } else {
            client = await this.createClientUsecase.execute(branchid, createParams);
        }

        if (normalizedPhone) {
            await this.linkContractDocumentsByPhone(branchid, client, normalizedPhone);
        }
        await this.serviceRecordLifecycleService?.ensureForClient(client.id);

        if (this.triggerService && applyMessageAutomation) {
            await this.triggerService
                .ensureDefaultRulesForBranch(branchid)
                .then(() => this.triggerService!.syncClientRulesForClient(branchid, client.id, true, suppressGreetingSms))
                .catch((error) => {
                    this.logger.error(`Failed to sync client trigger rules: ${error}`);
                });
        }
        if (createdScheduleId !== null && applyMessageAutomation) {
            await this.triggerService
                ?.syncEmployeeAssignmentRulesForSchedule(branchid, createdScheduleId, true)
                ?.catch((error) => {
                    this.logger.error(`Failed to sync employee assignment triggers: ${error}`);
                });
            this.serviceRecordLinkService
                ?.scheduleForServiceStart(createdScheduleId)
                ?.catch((error) => {
                    this.logger.error(`Failed to schedule feedback link SMS: ${error}`);
                });
        }

        return client;
    }

    async findAll(branchid: string): Promise<ClientWithEmployees[]> {
        const clients = await this.listClientsUsecase.execute(branchid);
        return this.attachEmployeesToClients(clients);
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
        const clientsWithEmployees = await this.attachEmployeesToClients(result.data);
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

        const [withEmployees] = await this.attachEmployeesToClients([client]);
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

        return this.attachEmployeesToClients(clients);
    }

    /**
     * Helper method to attach employee info to clients and compute service status
     * Implements lazy update: computes status on access and updates DB if changed
     */
    private async attachEmployeesToClients(clients: ClientEntity[]): Promise<ClientWithEmployees[]> {
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
        const contractDocs = await this.prismaService.eformsign_doc.findMany({
            where: {
                clientId: { in: clientIds },
                OR: [
                    { documentKind: EFORMSIGN_DOCUMENT_KIND.CONTRACT },
                    { documentKind: null },
                ],
            },
            orderBy: [
                { createdDate: "desc" },
                { id: "desc" },
            ],
            select: { clientId: true, statusType: true },
        });
        const latestContractStatusMap = new Map<number, string>();
        for (const doc of contractDocs) {
            if (doc.clientId === null) continue;
            if (!latestContractStatusMap.has(doc.clientId)) {
                latestContractStatusMap.set(doc.clientId, doc.statusType);
            }
        }

        // Compute and update service status for each client (lazy update strategy)
        const clientsNeedingUpdate: { id: number; newStatus: ServiceStatusType }[] = [];

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
            if (client.serviceStatus !== computedStatus) {
                clientsNeedingUpdate.push({ id: client.id, newStatus: computedStatus });
            }
            const documentStatus = this.mapStatusTypeToDocumentStatus(latestContractStatusMap.get(client.id));
            const badges = this.buildClientBadges({
                serviceStatus: computedStatus,
                documentStatus,
                startDate: client.startDate,
                breastPump: client.breastPump,
                careCenter: client.careCenter,
            });

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
                    serviceStatus: computedStatus, // Return computed status, not stored one
                    breastPump: client.breastPump,
                    eDocId: client.eDocId,
                    areaId: client.areaId,
                    hasSigned: client.eDocId !== null,
                    documentStatus,
                    badges,
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
            this.updateServiceStatusesInBackground(clientsNeedingUpdate);
        }

        return result;
    }

    /**
     * Background update of service statuses (fire-and-forget)
     * Does not block the main response
     */
    private updateServiceStatusesInBackground(
        updates: { id: number; newStatus: ServiceStatusType }[]
    ): void {
        // Use Promise.allSettled to handle each update independently
        Promise.allSettled(
            updates.map(async ({ id, newStatus }) => {
                try {
                    await this.prismaService.client.update({
                        where: { id },
                        data: { serviceStatus: newStatus },
                        select: { id: true },
                    });
                    this.logger.debug(`Updated client ${id} service status to ${newStatus}`);
                } catch (error) {
                    this.logger.warn(`Failed to update client ${id} service status: ${error}`);
                }
            })
        ).catch(error => {
            this.logger.error(`Error in background status updates: ${error}`);
        });
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
        serviceStatus?: string | null;
        breastPump?: boolean;
        eDocId?: string | null;
        areaId?: string | null;
    }): Promise<ClientEntity> {
        // Get existing client
        const existingClient = await this.findClientByIdUsecase.execute(branchid, id);
        if (!existingClient) {
            throw new Error(`Client with id ${id} not found`);
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
        this.assertAllowedServiceStatus(params.serviceStatus);
        await this.assertAllowedClientArea(branchid, params.areaId);
        await this.serviceRecordLifecycleService?.validatePeriodChange({
            clientId: id,
            startDate: params.startDate === undefined
                ? undefined
                : params.startDate ? new Date(params.startDate) : null,
            endDate: params.endDate === undefined
                ? undefined
                : params.endDate ? new Date(params.endDate) : null,
            duration: params.duration,
        });

        const normalizedPhone = normalizePhone(params.phone ?? null);
        if (normalizedPhone) {
            const clientWithPhone = await this.clientRepository.findByPhone(branchid, normalizedPhone);
            if (clientWithPhone && clientWithPhone.id !== id) {
                throw new ConflictException({ statusCode: 409, code: "P2002", error: "Conflict", field: "phone" });
            }
        }

        const startDate = params.startDate ? new Date(params.startDate) : existingClient.startDate ?? new Date();
        const endDate = params.endDate ? new Date(params.endDate) : existingClient.endDate ?? new Date(startDate.getTime() + DEFAULT_SERVICE_PERIOD_MS);
        this.assertValidServicePeriod(startDate, endDate);

        // Check if employee assignment is being changed
        const employeeChanged = params.primaryEmployeeId !== undefined || params.secondaryEmployeeId !== undefined;

        let createdScheduleId: number | null = null;
        let replacedScheduleId: number | null = null;
        let currentSchedule: {
            id: number;
            primaryEmployeeId: number;
            secondaryEmployeeId: number | null;
        } | null = null;
        let assignmentChanged = false;
        if (employeeChanged) {
            currentSchedule = await this.prismaService.employee_schedule.findFirst({
                where: { clientId: id, branchId: branchid, replaced: false },
                orderBy: { id: "desc" },
            });
            const primaryEmployeeId = params.primaryEmployeeId ?? currentSchedule?.primaryEmployeeId ?? null;
            const secondaryEmployeeId = params.secondaryEmployeeId !== undefined
                ? params.secondaryEmployeeId
                : currentSchedule?.secondaryEmployeeId ?? null;
            await this.assertAllowedEmployees(branchid, primaryEmployeeId, secondaryEmployeeId);
            assignmentChanged = primaryEmployeeId !== (currentSchedule?.primaryEmployeeId ?? null)
                || secondaryEmployeeId !== (currentSchedule?.secondaryEmployeeId ?? null);
        }

        await this.prismaService.$transaction(async (transaction) => {
            if (assignmentChanged) {
                const primaryEmployeeId = params.primaryEmployeeId ?? currentSchedule?.primaryEmployeeId ?? null;
                const secondaryEmployeeId = params.secondaryEmployeeId !== undefined
                    ? params.secondaryEmployeeId
                    : currentSchedule?.secondaryEmployeeId ?? null;
                if (primaryEmployeeId === null) {
                    throw new BadRequestException("primary employee is required to create an assignment");
                }
                if (currentSchedule) {
                    await transaction.employee_schedule.update({
                        where: { id: currentSchedule.id },
                        data: { replaced: true, endDate: new Date() },
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
                        startDate,
                        endDate,
                        replaced: false,
                    },
                });
                createdScheduleId = schedule.id;
            }

            const result = await transaction.client.updateMany({
                where: { id, branchId: branchid },
                data: {
                    name: params.name,
                    address: params.address ?? undefined,
                    phone: params.phone ?? undefined,
                    type: normalizedPricing?.type,
                    duration: params.duration ?? undefined,
                    fullPrice: normalizedPricing?.fullPrice,
                    grant: normalizedPricing?.grant,
                    actualPrice: normalizedPricing?.actualPrice,
                    startDate: params.startDate ? new Date(params.startDate) : undefined,
                    endDate: params.endDate ? new Date(params.endDate) : undefined,
                    careCenter: params.careCenter ?? undefined,
                    voucherClient: params.voucherClient,
                    birthday: params.birthday ?? undefined,
                    dueDate: params.dueDate ? new Date(params.dueDate) : undefined,
                    serviceStatus: params.serviceStatus ?? undefined,
                    breastPump: params.breastPump,
                    eDocId: params.eDocId ?? undefined,
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
        }
        if (createdScheduleId !== null) {
            await this.triggerService
                ?.syncEmployeeAssignmentRulesForSchedule(branchid, createdScheduleId, true)
                ?.catch((error) => {
                    this.logger.error(`Failed to sync employee assignment triggers: ${error}`);
                });
            this.serviceRecordLinkService
                ?.scheduleForServiceStart(createdScheduleId)
                ?.catch((error) => {
                    this.logger.error(`Failed to schedule feedback link SMS: ${error}`);
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

        // Also mark the current schedule as ended
        await this.prismaService.employee_schedule.updateMany({
            where: { clientId: clientId, replaced: false },
            data: { endDate: new Date() },
        });

        // Revoke any outstanding feedback links for this client's active assignments
        const activeSchedules = await this.prismaService.employee_schedule.findMany({
            where: { clientId: clientId, replaced: false },
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
        await this.assertAllowedEmployees(
            branchid,
            newPrimaryEmployeeId,
            newSecondaryEmployeeId ?? null,
        );

        this.assertValidServicePeriod(client.startDate, client.endDate);
        const replacementStartDate = new Date();
        const replacementEndDate = client.endDate ?? new Date(replacementStartDate.getTime() + DEFAULT_SERVICE_PERIOD_MS);

        this.logger.log(
            `Replacement requested for client ${clientId}: ` +
            `new primary=${newPrimaryEmployeeId}, secondary=${newSecondaryEmployeeId ?? "none"}`
        );

        let replacedScheduleId: number | null = null;
        const replacementSchedule = await this.prismaService.$transaction(async (transaction) => {
            const updateResult = await transaction.client.updateMany({
                where: { id: clientId, branchId: branchid },
                data: { serviceStatus: SERVICE_STATUS.REPLACEMENT_REQUESTED },
            });
            if (updateResult.count === 0) {
                throw new NotFoundException(`Client with id ${clientId} not found`);
            }

            const currentSchedule = await transaction.employee_schedule.findFirst({
                where: { clientId, branchId: branchid, replaced: false },
                orderBy: { id: "desc" },
            });
            if (currentSchedule) {
                await transaction.employee_schedule.update({
                    where: { id: currentSchedule.id },
                    data: { replaced: true, endDate: replacementStartDate },
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
        this.triggerService
            ?.syncEmployeeAssignmentRulesForSchedule(branchid, replacementSchedule.id, true)
            ?.catch((error) => {
                this.logger.error(`Failed to sync replacement assignment triggers: ${error}`);
            });
        await this.serviceRecordLifecycleService?.ensureForClient(clientId);
        this.serviceRecordLinkService
            ?.scheduleForServiceStart(replacementSchedule.id)
            ?.catch((error) => {
                this.logger.error(`Failed to schedule replacement feedback link SMS: ${error}`);
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
        await this.triggerService?.cancelPendingJobsForClientDeletion(branchid, id);
        await this.deleteClientUsecase.execute(branchid, id);
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

        const [activeClients, contractsNotSent, contractsPendingSignature, upcomingThisMonth, upcomingNextMonth] = 
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
                this.prismaService.client.count({
                    where: {
                        eDocId: { not: null },
                        eformsignDocByEDocId: { statusType: { not: '050' } },
                        branchId: branchid,
                    },
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

        const sendThresholdDate = new Date(today);
        sendThresholdDate.setDate(today.getDate() + ACTION_REQUIRED_SEND_THRESHOLD_DAYS);
        sendThresholdDate.setHours(23, 59, 59, 999);

        const signatureThresholdDate = new Date(today);
        signatureThresholdDate.setDate(today.getDate() + ACTION_REQUIRED_SIGNATURE_THRESHOLD_DAYS);
        signatureThresholdDate.setHours(23, 59, 59, 999);

        const clients = await this.prismaService.client.findMany({
            where: {
                branchId: branchid,
                OR: [
                    { serviceStatus: SERVICE_STATUS.REPLACEMENT_REQUESTED },
                    {
                        eDocId: null,
                        OR: [
                            { serviceStatus: null },
                            { serviceStatus: { notIn: [SERVICE_STATUS.PRE_BOOKING, SERVICE_STATUS.COMPLETED, SERVICE_STATUS.TERMINATED] } },
                        ],
                        startDate: { lte: sendThresholdDate },
                    },
                    {
                        eDocId: { not: null },
                        OR: [
                            { serviceStatus: null },
                            { serviceStatus: { notIn: [SERVICE_STATUS.PRE_BOOKING, SERVICE_STATUS.COMPLETED, SERVICE_STATUS.TERMINATED] } },
                        ],
                        startDate: { lte: signatureThresholdDate },
                        eformsignDocByEDocId: { statusType: { not: "050" } },
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
                eDocId: true,
                eformsignDocByEDocId: {
                    select: {
                        statusType: true,
                    },
                },
            },
            orderBy: { createdAt: "desc" },
            take: Math.max(limit * 4, 12),
        });

        return clients
            .map((client): ClientActionRequiredAlert | null => {
                const eformsignDoc = client.eformsignDocByEDocId as { statusType: string | null } | null | undefined;
                const serviceStatus = computeServiceStatus(
                    client.serviceStatus,
                    client.startDate,
                    client.endDate,
                );

                if (serviceStatus === SERVICE_STATUS.REPLACEMENT_REQUESTED) {
                    return {
                        id: client.id,
                        name: client.name,
                        createdAt: client.createdAt ?? null,
                        reason: "교체 요청",
                        priority: 1,
                    };
                }

                if (
                    serviceStatus === SERVICE_STATUS.PRE_BOOKING ||
                    serviceStatus === SERVICE_STATUS.COMPLETED ||
                    serviceStatus === SERVICE_STATUS.TERMINATED
                ) {
                    return null;
                }

                if (!client.startDate) {
                    return null;
                }

                const start = new Date(client.startDate);
                start.setHours(0, 0, 0, 0);
                const daysUntilStart = Math.round((start.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

                if (!client.eDocId && daysUntilStart <= ACTION_REQUIRED_SEND_THRESHOLD_DAYS) {
                    return {
                        id: client.id,
                        name: client.name,
                        createdAt: client.createdAt ?? null,
                        reason: "발송 필요",
                        priority: 3,
                    };
                }

                if (
                    client.eDocId &&
                    eformsignDoc?.statusType !== "050" &&
                    daysUntilStart <= ACTION_REQUIRED_SIGNATURE_THRESHOLD_DAYS
                ) {
                    return {
                        id: client.id,
                        name: client.name,
                        createdAt: client.createdAt ?? null,
                        reason: "서명 필요",
                        priority: 2,
                    };
                }

                return null;
            })
            .filter((alert): alert is ClientActionRequiredAlert => alert !== null)
            .sort((a, b) => a.priority - b.priority)
            .slice(0, limit);
    }
}
