import { Global, Module } from "@nestjs/common";

import { SCHEDULER_LEASE_REPOSITORY } from "domain/repositories/scheduler-lease.repository.interface";
import { SbSchedulerLeaseRepository } from "infrastructure/database/repositories/sb.scheduler-lease.repository";
import { SchedulerLeaseService } from "application/services/scheduler-lease.service";

/**
 * Mirrors DatabaseModule: @Global(), no imports needed because PrismaService and ConfigService
 * are already provided globally (DatabaseModule is @Global(), ConfigModule.forRoot({ isGlobal:
 * true })).
 */
@Global()
@Module({
    providers: [
        { provide: SCHEDULER_LEASE_REPOSITORY, useClass: SbSchedulerLeaseRepository },
        SchedulerLeaseService,
    ],
    exports: [SchedulerLeaseService],
})
export class SchedulerLeaseModule {}
