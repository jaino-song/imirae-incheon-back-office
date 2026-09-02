import { Global, Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";

import { SCHEDULER_LEASE_REPOSITORY } from "domain/repositories/scheduler-lease.repository.interface";
import { SbSchedulerLeaseRepository } from "infrastructure/database/repositories/sb.scheduler-lease.repository";
import { SchedulerLeaseService } from "application/services/scheduler-lease.service";

/**
 * Mirrors DatabaseModule: @Global(). PrismaService is provided globally by DatabaseModule.
 * ConfigModule is imported explicitly (not relied on as global) so feature-module test graphs
 * that do not call ConfigModule.forRoot({ isGlobal: true }) can still resolve this module.
 */
@Global()
@Module({
    imports: [ConfigModule],
    providers: [
        { provide: SCHEDULER_LEASE_REPOSITORY, useClass: SbSchedulerLeaseRepository },
        SchedulerLeaseService,
    ],
    exports: [SchedulerLeaseService],
})
export class SchedulerLeaseModule {}
