import { ClientEntity } from "domain/entities/client.entity";
import { ServiceStatusType } from "domain/value-objects/service-status.vo";
import type { Prisma } from "@prisma/client";

export type AutomaticServiceStatusUpdateResult = "updated" | "stale";

export interface PaginatedResult<T> {
    data: T[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

export interface InitialClientSchedule {
    primaryEmployeeId: number;
    secondaryEmployeeId: number | null;
    workAddress: string;
    startDate: Date;
    endDate: Date;
}

export interface ClientWithInitialSchedule {
    client: ClientEntity;
    scheduleId: number;
}

export interface IClientRepository {
    findById(branchid: string, id: number): Promise<ClientEntity | null>;
    /**
     * Lock one branch-owned client row for an approval-bound mutation or
     * external-effect staging operation. The lock and all work performed with
     * the returned entity must share the supplied transaction.
     */
    findByIdForUpdate(
        branchid: string,
        id: number,
        transaction: Prisma.TransactionClient,
    ): Promise<ClientEntity | null>;
    findAll(branchid: string): Promise<ClientEntity[]>;
    findAllPaginated(
        branchid: string,
        page: number,
        limit: number,
        search?: string
    ): Promise<PaginatedResult<ClientEntity>>;
    create(branchid: string, client: ClientEntity, transaction?: Prisma.TransactionClient): Promise<ClientEntity>;
    createWithInitialSchedule(
        branchid: string,
        client: ClientEntity,
        schedule: InitialClientSchedule,
        transaction?: Prisma.TransactionClient,
    ): Promise<ClientWithInitialSchedule>;
    update(branchid: string, client: ClientEntity): Promise<ClientEntity>;
    /**
     * Apply a date-derived status only when the branch-owned row still has the
     * status observed by the caller. A stale result is benign and must not be
     * retried with the stale value.
     */
    updateServiceStatusIfCurrent(
        branchid: string,
        id: number,
        expectedServiceStatus: string | null,
        newServiceStatus: ServiceStatusType,
    ): Promise<AutomaticServiceStatusUpdateResult>;
    /**
     * Compare the approval target while holding the row lock, then apply the
     * update before releasing that lock. A null result means the target version
     * no longer matches; callers must not fall back to an unlocked update.
     */
    updateIfTargetVersion(
        branchid: string,
        id: number,
        expectedTargetVersion: string,
        updates: Partial<{
            name: string;
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
        }>,
        transaction?: Prisma.TransactionClient,
    ): Promise<ClientEntity | null>;
    delete(branchid: string, id: number): Promise<void>;

    // Date-based queries for scheduler (P3)
    /**
     * Find clients whose service starts on a specific date
     * Used for contract reminders (3-day, 1-day before)
     */
    findByStartDate(branchid: string, date: Date): Promise<ClientEntity[]>;

    /**
     * Find clients whose service ends on a specific date
     * Used for survey requests
     */
    findByEndDate(branchid: string, date: Date): Promise<ClientEntity[]>;

    /**
     * Find clients created on a specific date (for payment reminders)
     * Used to send payment reminders X days after registration
     */
    findByCreatedDate(branchid: string, date: Date): Promise<ClientEntity[]>;

    /**
     * Find clients whose service starts within the next N days (inclusive)
     * Used for daily summary notifications
     */
    findStartingWithinDays(branchid: string, days: number): Promise<ClientEntity[]>;

    /**
     * Find clients whose service ends within the next N days (inclusive)
     * Used for daily summary notifications
     */
    findEndingWithinDays(branchid: string, days: number): Promise<ClientEntity[]>;

    /**
     * Find clients with incomplete contracts (eformsign doc not completed)
     * whose service starts within the next N days
     */
    findWithIncompleteContractsStartingWithinDays(
        branchid: string,
        days: number
    ): Promise<ClientEntity[]>;

    /**
     * Find clients without any contract sent (eDocId is null)
     * whose service starts within the next N days
     */
    findWithoutContractSentStartingWithinDays(
        branchid: string,
        days: number
    ): Promise<ClientEntity[]>;

    /**
     * Find a client in the branch whose phone, normalized to bare digits, equals
     * the given normalized phone. Used to dedupe (reuse existing) on create.
     */
    findByPhone(branchid: string, normalizedPhone: string): Promise<ClientEntity | null>;
}

export const CLIENT_REPOSITORY = "CLIENT_REPOSITORY";
