import { ClientEntity } from "domain/entities/client.entity";
import {
    AutomaticServiceStatusUpdateResult,
    ClientWithInitialSchedule,
    IClientRepository,
    InitialClientSchedule,
    PaginatedResult,
} from "domain/repositories/client.repository.interface";
import type { Prisma } from "@prisma/client";
import { clientAgentTargetVersion } from "application/usecases/client/client-agent-target";
import {
    isAutomaticServiceStatusTransitionAllowed,
    ServiceStatusType,
} from "domain/value-objects/service-status.vo";

/**
 * 테스트용 Mock Client Repository
 * In-memory 저장소로 동작하며, 테스트 간 독립성 보장
 */
export class MockClientRepository implements IClientRepository {
    private clients: Map<number, ClientEntity> = new Map();
    private nextId: number = 1;

    /**
     * 테스트 데이터 초기화
     */
    reset(): void {
        this.clients.clear();
        this.nextId = 1;
    }

    /**
     * 테스트 데이터 직접 설정
     */
    setData(clients: ClientEntity[]): void {
        this.clients.clear();
        clients.forEach(client => {
            this.clients.set(client.id, client);
            if (client.id >= this.nextId) {
                this.nextId = client.id + 1;
            }
        });
    }

    /**
     * 저장된 모든 데이터 조회 (테스트 검증용)
     */
    getAllData(): ClientEntity[] {
        return Array.from(this.clients.values());
    }

    async findById(_branchid: string, id: number): Promise<ClientEntity | null> {
        return this.clients.get(id) ?? null;
    }

    async findByIdForUpdate(
        branchid: string,
        id: number,
        _transaction: Prisma.TransactionClient,
    ): Promise<ClientEntity | null> {
        void _transaction;
        return this.findById(branchid, id);
    }

    async findAll(_branchid: string): Promise<ClientEntity[]> {
        return Array.from(this.clients.values());
    }

    async findAllPaginated(
        _branchid: string,
        page: number,
        limit: number,
        search?: string,
    ): Promise<PaginatedResult<ClientEntity>> {
        let data = Array.from(this.clients.values());

        // 검색 필터 적용
        if (search) {
            const searchLower = search.toLowerCase();
            data = data.filter(
                client =>
                    client.name.toLowerCase().includes(searchLower) ||
                    client.address?.toLowerCase().includes(searchLower) ||
                    client.phone?.toLowerCase().includes(searchLower),
            );
        }

        const total = data.length;
        const totalPages = Math.ceil(total / limit);
        const startIndex = (page - 1) * limit;
        const paginatedData = data.slice(startIndex, startIndex + limit);

        return {
            data: paginatedData,
            total,
            page,
            limit,
            totalPages,
        };
    }

    async create(_branchid: string, client: ClientEntity): Promise<ClientEntity> {
        // ID가 없으면 자동 생성
        const id = client.id > 0 ? client.id : this.nextId++;
        const newClient = ClientEntity.reconstitute(
            id,
            client.name,
            client.address,
            client.phone,
            client.type,
            client.duration,
            client.fullPrice,
            client.grant,
            client.actualPrice,
            client.startDate,
            client.endDate,
            client.careCenter,
            client.voucherClient,
            client.birthday,
            client.dueDate,
            client.serviceStatus,
            client.breastPump,
            client.eDocId,
        );
        this.clients.set(id, newClient);
        return newClient;
    }

    async createWithInitialSchedule(
        branchid: string,
        client: ClientEntity,
        _schedule: InitialClientSchedule,
    ): Promise<ClientWithInitialSchedule> {
        void _schedule;
        const created = await this.create(branchid, client);
        return { client: created, scheduleId: created.id };
    }

    async update(_branchid: string, client: ClientEntity): Promise<ClientEntity> {
        if (!this.clients.has(client.id)) {
            throw new Error(`Client with id ${client.id} not found`);
        }
        this.clients.set(client.id, client);
        return client;
    }

    async updateServiceStatusIfCurrent(
        branchid: string,
        id: number,
        expectedServiceStatus: string | null,
        newServiceStatus: ServiceStatusType,
    ): Promise<AutomaticServiceStatusUpdateResult> {
        const client = this.clients.get(id);
        if (
            !client
            || (client.branchId !== null && client.branchId !== branchid)
            || !isAutomaticServiceStatusTransitionAllowed(client.serviceStatus, newServiceStatus)
            || client.serviceStatus !== expectedServiceStatus
        ) {
            return "stale";
        }

        client.update({ serviceStatus: newServiceStatus });
        return "updated";
    }

    async updateIfTargetVersion(
        branchid: string,
        id: number,
        expectedTargetVersion: string,
        updates: Parameters<IClientRepository["updateIfTargetVersion"]>[3],
        _transaction?: Prisma.TransactionClient,
    ): Promise<ClientEntity | null> {
        void _transaction;
        const client = await this.findById(branchid, id);
        if (!client || clientAgentTargetVersion(client) !== expectedTargetVersion) return null;
        client.update(updates);
        return client;
    }

    async delete(_branchid: string, id: number): Promise<void> {
        if (!this.clients.has(id)) {
            throw new Error(`Client with id ${id} not found`);
        }
        this.clients.delete(id);
    }

    /**
     * Find clients by start date (P3 scheduler support)
     */
    async findByStartDate(_branchid: string, date: Date): Promise<ClientEntity[]> {
        const startOfDay = new Date(date);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(date);
        endOfDay.setHours(23, 59, 59, 999);

        return Array.from(this.clients.values()).filter(client => {
            if (!client.startDate) return false;
            return client.startDate >= startOfDay && client.startDate <= endOfDay;
        });
    }

    /**
     * Find clients by end date (P3 scheduler support)
     */
    async findByEndDate(_branchid: string, date: Date): Promise<ClientEntity[]> {
        const startOfDay = new Date(date);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(date);
        endOfDay.setHours(23, 59, 59, 999);

        return Array.from(this.clients.values()).filter(client => {
            if (!client.endDate) return false;
            return client.endDate >= startOfDay && client.endDate <= endOfDay;
        });
    }

    /**
     * Find clients by created date (P3 scheduler support)
     * Note: Mock doesn't have createdAt field, returns empty array
     */
    async findByCreatedDate(_branchid: string, _date: Date): Promise<ClientEntity[]> {
        // Mock doesn't track createdAt, similar to real implementation
        return [];
    }

    async findStartingWithinDays(_branchid: string, days: number): Promise<ClientEntity[]> {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const endDate = new Date(today);
        endDate.setDate(endDate.getDate() + days);
        endDate.setHours(23, 59, 59, 999);

        return Array.from(this.clients.values()).filter(client => {
            if (!client.startDate) return false;
            return client.startDate >= today && client.startDate <= endDate;
        });
    }

    async findEndingWithinDays(_branchid: string, days: number): Promise<ClientEntity[]> {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const endDate = new Date(today);
        endDate.setDate(endDate.getDate() + days);
        endDate.setHours(23, 59, 59, 999);

        return Array.from(this.clients.values()).filter(client => {
            if (!client.endDate) return false;
            return client.endDate >= today && client.endDate <= endDate;
        });
    }

    async findWithIncompleteContractsStartingWithinDays(
        _branchid: string,
        days: number
    ): Promise<ClientEntity[]> {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const endDate = new Date(today);
        endDate.setDate(endDate.getDate() + days);
        endDate.setHours(23, 59, 59, 999);

        return Array.from(this.clients.values()).filter(client => {
            if (!client.startDate) return false;
            const isStartingSoon = client.startDate >= today && client.startDate <= endDate;
            const hasContractButIncomplete = client.eDocId !== null;
            return isStartingSoon && hasContractButIncomplete;
        });
    }

    async findWithoutContractSentStartingWithinDays(
        _branchid: string,
        days: number
    ): Promise<ClientEntity[]> {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const endDate = new Date(today);
        endDate.setDate(endDate.getDate() + days);
        endDate.setHours(23, 59, 59, 999);

        return Array.from(this.clients.values()).filter(client => {
            if (!client.startDate) return false;
            const isStartingSoon = client.startDate >= today && client.startDate <= endDate;
            const noContractSent = client.eDocId === null;
            return isStartingSoon && noContractSent;
        });
    }

    async findByPhone(_branchid: string, _normalizedPhone: string): Promise<ClientEntity | null> {
        return null;
    }
}
