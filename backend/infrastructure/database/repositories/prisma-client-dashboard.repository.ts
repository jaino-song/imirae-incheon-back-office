import { Injectable } from "@nestjs/common";

import { SERVICE_STATUS } from "domain/value-objects/service-status.vo";
import type { ClientDashboardSummary, IClientDashboardRepository } from "domain/repositories/client-dashboard.repository.interface";
import { PrismaService } from "infrastructure/database/prisma.service";

@Injectable()
export class PrismaClientDashboardRepository implements IClientDashboardRepository {
    constructor(private readonly prisma: PrismaService) {}

    async getSummary(branchId: string): Promise<ClientDashboardSummary> {
        const [totalClients, activeClients] = await Promise.all([
            this.prisma.client.count({ where: { branchId } }),
            this.prisma.client.count({ where: { branchId, serviceStatus: SERVICE_STATUS.ACTIVE } }),
        ]);
        return { totalClients, activeClients };
    }
}
