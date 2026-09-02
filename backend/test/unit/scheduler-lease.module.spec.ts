import { ConfigModule } from "@nestjs/config";
import { Test } from "@nestjs/testing";

import { DatabaseModule } from "infrastructure/database/database.module";
import { SchedulerLeaseModule } from "module/scheduler-lease.module";
import { SchedulerLeaseService } from "application/services/scheduler-lease.service";

/**
 * DI-graph gate: no existing unit spec resolves the AppModule graph, so without this a DI
 * mistake (e.g. a missing @Optional() on SchedulerLeaseService's constructor) would pass every
 * other check and only surface as a NestFactory.create(AppModule) abort in production.
 *
 * Deliberately never calls .init() — Test.createTestingModule(...).compile() alone does not
 * trigger Nest lifecycle hooks (proven by
 * infrastructure/database/tenant-isolation.wiring.spec.ts:59-74), so this needs no live DB.
 */
describe("SchedulerLeaseModule — DI graph", () => {
    const originalSchedulersEnabled = process.env["SCHEDULERS_ENABLED"];

    beforeAll(() => {
        process.env["SCHEDULERS_ENABLED"] = "false";
    });

    afterAll(() => {
        if (originalSchedulersEnabled === undefined) {
            delete process.env["SCHEDULERS_ENABLED"];
        } else {
            process.env["SCHEDULERS_ENABLED"] = originalSchedulersEnabled;
        }
    });

    it("resolves SchedulerLeaseService from the compiled module graph", async () => {
        const moduleRef = await Test.createTestingModule({
            imports: [
                ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
                DatabaseModule,
                SchedulerLeaseModule,
            ],
        }).compile();

        try {
            const service = moduleRef.get(SchedulerLeaseService);
            expect(service).toBeInstanceOf(SchedulerLeaseService);
            // SCHEDULERS_ENABLED=false during compile -> the constructed service is standby.
            expect(service.mode).toBe("standby");
        } finally {
            await moduleRef.close();
        }
    });
});
