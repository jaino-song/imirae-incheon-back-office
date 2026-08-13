import { Inject, Injectable } from "@nestjs/common";

import {
    CLIENT_DASHBOARD_REPOSITORY,
    type ClientDashboardSummary,
    type IClientDashboardRepository,
} from "domain/repositories/client-dashboard.repository.interface";

@Injectable()
export class GetClientDashboardSummaryUsecase {
    constructor(
        @Inject(CLIENT_DASHBOARD_REPOSITORY)
        private readonly repository: IClientDashboardRepository,
    ) {}

    execute(branchId: string): Promise<ClientDashboardSummary> {
        return this.repository.getSummary(branchId);
    }
}
