import { ConfigModule } from "@nestjs/config";
import { Test } from "@nestjs/testing";

import { SchedulerLeaseService } from "application/services/scheduler-lease.service";
import { TenantModule } from "infrastructure/tenant/tenant.module";
import { CallInboxModule } from "module/call-inbox.module";
import { ClientModule } from "module/client.module";
import { EformsignDocModule } from "module/eformsign-doc.module";
import { EformsignWebhookModule } from "module/eformsign-webhook.module";
import { EmployeeModule } from "module/employee.module";
import { EmployeeScheduleModule } from "module/employee-schedule.module";
import { SchedulerLeaseModule } from "module/scheduler-lease.module";
import { ServiceRecordEntryModule } from "module/service-record-entry.module";

/**
 * The specs under test/e2e/ build feature-module graphs (not AppModule) and are
 * excluded from `pnpm test`, so a scheduler that injects SchedulerLeaseService
 * without SchedulerLeaseModule in the graph would only fail in the gated e2e
 * runners. This compiles the same graphs here, in the hermetic unit suite.
 *
 * `.compile()` alone runs no lifecycle hooks (see scheduler-lease.module.spec.ts),
 * so no database or Valkey is touched.
 */
const GRAPHS: Array<{ name: string; modules: Parameters<typeof Test.createTestingModule>[0]["imports"] }> = [
    { name: "full-flow", modules: [TenantModule, ClientModule, EmployeeModule, EmployeeScheduleModule] },
    { name: "call-inbox (+ sms automation, contract readiness)", modules: [CallInboxModule, ClientModule, TenantModule] },
    { name: "eformsign document jobs / contract headless", modules: [TenantModule, EformsignDocModule] },
    { name: "service-record snapshot", modules: [TenantModule, ServiceRecordEntryModule, EformsignWebhookModule] },
];

describe("test/e2e feature-module graphs resolve SchedulerLeaseService", () => {
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

    it.each(GRAPHS)("$name compiles with SchedulerLeaseModule", async ({ modules }) => {
        const moduleRef = await Test.createTestingModule({
            imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), ...(modules ?? []), SchedulerLeaseModule],
        }).compile();

        try {
            expect(moduleRef.get(SchedulerLeaseService)).toBeInstanceOf(SchedulerLeaseService);
        } finally {
            await moduleRef.close();
        }
    });

    it("the graph really depends on the module: call-inbox without SchedulerLeaseModule does not compile", async () => {
        await expect(
            Test.createTestingModule({
                imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), CallInboxModule, ClientModule, TenantModule],
            }).compile(),
        ).rejects.toThrow(/SchedulerLeaseService/);
    });
});
