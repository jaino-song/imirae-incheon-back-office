import "../instrument";

import * as Sentry from "@sentry/nestjs";

import { captureServiceRecordError } from "../infrastructure/observability/service-record-sentry";

async function run(): Promise<void> {
    if (process.env["SENTRY_ENVIRONMENT"] !== "preview") {
        throw new Error("The service-record Sentry smoke test is restricted to preview");
    }
    if (!process.env["SENTRY_DSN"]) {
        throw new Error("SENTRY_DSN is required for the service-record Sentry smoke test");
    }

    captureServiceRecordError(
        new Error("Service-record backend preview smoke test"),
        {
            operation: "auto-finalize",
            handled: true,
            smokeTest: true,
        },
    );

    const flushed = await Sentry.flush(10_000);
    if (!flushed) throw new Error("Sentry did not flush the preview smoke event");
}

void run().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
});
