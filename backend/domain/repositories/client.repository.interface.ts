import { ClientEntity } from "domain/entities/client.entity";
import type { Prisma } from "@prisma/client";

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
    ): Promise<ClientWithInitialSchedule>;
    update(branchid: string, client: ClientEntity): Promise<ClientEntity>;
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
