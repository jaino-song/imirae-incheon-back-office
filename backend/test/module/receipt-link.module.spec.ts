// F5: ReceiptLinkModule transitively imports MessageModule, EformsignDocModule,
// SystemSettingModule and SchedulerLeaseModule, so compiling it in isolation with
// Test.createTestingModule needs heavy overrides this unit test has no reason to stand up
// (mirrors the reasoning in test/services/sms-trigger-payload-enricher.spec.ts's
// "MessageModule providers/exports" describe block). Asserting the module's own @Module
// metadata instead still catches the regression this test exists for: deleting a provider
// (e.g. the enricher or the cleanup scheduler) or the AppModule import cannot pass silently
// with a green suite.
import { ReceiptLinkCleanupSchedulerService } from "application/services/receipt-link-cleanup-scheduler.service";
import { ReceiptLinkDeliveryEnricher } from "application/services/receipt-link-delivery-enricher.service";
import { ReceiptLinkIssueService } from "application/services/receipt-link-issue.service";
import { ReceiptLinkManualSendService } from "application/services/receipt-link-manual-send.service";
import { ReceiptLinkTokenService } from "application/services/receipt-link-token.service";
import { ReceiptLinkAdminController } from "interface/controllers/receipt-link-admin.controller";
import { ReceiptLinkController } from "interface/controllers/receipt-link.controller";
import { ReceiptLinkModule } from "module/receipt-link.module";

// app.module.ts cannot be imported directly in this jest project: it transitively imports
// `nanoid` (an ESM-only package) via infrastructure/database/repositories/chat-feedback.repository.ts,
// and jest's CommonJS transform fails on that import with "Cannot use import statement outside
// a module" (same issue documented in
// test/infrastructure/tenant/app-module-middleware.wiring.spec.ts). Stubbing nanoid out is
// enough to let app.module.ts load for the metadata assertion below. This must stay a top-level
// require (not inside jest.isolateModules) so the ReceiptLinkModule class it pulls in
// transitively is reference-identical to the one imported above — a separate module registry
// would produce a distinct class object and the `toContain` assertion would false-fail.
jest.mock("nanoid", () => ({ nanoid: () => "test-id" }));
const { AppModule } = require("../../app.module") as typeof import("../../app.module");

describe("ReceiptLinkModule wiring", () => {
    it("declares the delivery enricher, cleanup scheduler, token and issue services as providers", () => {
        const providers = Reflect.getMetadata("providers", ReceiptLinkModule) as unknown[];

        expect(providers).toContain(ReceiptLinkDeliveryEnricher);
        expect(providers).toContain(ReceiptLinkCleanupSchedulerService);
        expect(providers).toContain(ReceiptLinkTokenService);
        expect(providers).toContain(ReceiptLinkIssueService);
        expect(providers).toContain(ReceiptLinkManualSendService);
    });

    it("declares ReceiptLinkController and ReceiptLinkAdminController as controllers", () => {
        const controllers = Reflect.getMetadata("controllers", ReceiptLinkModule) as unknown[];

        expect(controllers).toContain(ReceiptLinkController);
        expect(controllers).toContain(ReceiptLinkAdminController);
    });

    it("is imported by AppModule", () => {
        const imports = Reflect.getMetadata("imports", AppModule) as unknown[];

        expect(imports).toContain(ReceiptLinkModule);
    });
});
