export interface ClientDashboardSummary {
    totalClients: number;
    activeClients: number;
}

export interface IClientDashboardRepository {
    getSummary(branchId: string): Promise<ClientDashboardSummary>;
}

export const CLIENT_DASHBOARD_REPOSITORY = "CLIENT_DASHBOARD_REPOSITORY";
