import "./instrument";

import { HttpAdapterHost, NestFactory } from "@nestjs/core";
import helmet from "helmet";
import { json } from "express";
import { AppModule } from "./app.module";
import cookieParser from "cookie-parser";
import { PrismaExceptionFilter } from "./infrastructure/filters/prisma-exception.filter";
import { ServiceRecordSentryExceptionFilter } from "./infrastructure/observability/service-record-sentry-exception.filter";
import { GlobalValidationPipe } from "./infrastructure/pipes/global-validation.pipe";
import { assertVendorStubsConfigured } from "./infrastructure/vendor-stubs/e2e-vendor-stubs";

// Catch any unhandled errors
process.on('uncaughtException', (error) => {
    console.error('UNCAUGHT EXCEPTION:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('UNHANDLED REJECTION at:', promise, 'reason:', reason);
});

// Add BigInt serialization support (env reloaded)
(BigInt.prototype as any).toJSON = function () {
    return this.toString();
};

async function bootstrap() {
    // Belt-and-suspenders (review finding): the e2e-only switches must never
    // ride into a production boot — they disable vendor egress and the
    // storage bucket bootstrap.
    if (process.env["NODE_ENV"] === "production") {
        for (const flag of ["E2E_VENDOR_STUBS", "STORAGE_BOOTSTRAP_DISABLED"]) {
            if (process.env[flag] === "1") {
                throw new Error(`${flag}=1 is not allowed when NODE_ENV=production`);
            }
        }
    }

    // Must run before NestFactory.create(AppModule): module instantiation is
    // what invokes createAligoPortClient / createEformsignClientRepository /
    // createGeminiGateway (infrastructure/vendor-stubs/e2e-vendor-stubs.ts),
    // and this throws first if a test-like boot is missing (or has typo'd)
    // E2E_VENDOR_STUBS=1 — see assertVendorStubsConfigured for what counts as
    // "test-like". No real ConfigService exists yet, so pass a process.env-backed
    // adapter, same shape the vendor-stub factories already accept.
    assertVendorStubsConfigured({ get: (key: string) => process.env[key] });

    const app = await NestFactory.create(AppModule);
    app.use(helmet());
    // 1mb: call-transcript webhook payloads (long transcripts) exceed the 100kb express default
    app.use(json({ limit: "1mb" }));
    const expressApp = app.getHttpAdapter().getInstance();
    expressApp.set("trust proxy", 1);
    app.use(cookieParser());
    // forbidNonWhitelisted turns silently-stripped unknown body fields into
    // explicit 400s (mass-assignment hardening). GlobalValidationPipe carves out
    // inbound third-party webhook DTOs (eformsign sends undeclared fields) that
    // a stricter global pipe would otherwise reject — see the pipe for why a
    // controller-level override can't do this.
    app.useGlobalPipes(new GlobalValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    const httpAdapterHost = app.get(HttpAdapterHost);
    // Nest evaluates global filters in reverse registration order. Register the
    // catch-all first so Prisma's specific mapping keeps its existing API behavior.
    app.useGlobalFilters(
        new ServiceRecordSentryExceptionFilter(httpAdapterHost),
        new PrismaExceptionFilter(),
    );
    // CORS configuration - support production, preview, and development origins
    const allowedOrigins = [
        process.env['PRODUCTION_FRONTEND_URL'],
        process.env['PRODUCTION_MOBILE_FRONTEND_URL'],
        process.env['PREVIEW_FRONTEND_URL'],
        process.env['PREVIEW_MOBILE_FRONTEND_URL'],
        process.env['DEVELOPMENT_FRONTEND_URL'],
        process.env['DEVELOPMENT_MOBILE_FRONTEND_URL'],
        "http://localhost:3000", // Fallback for local development
    ].filter((origin): origin is string => Boolean(origin)); // Remove undefined values

    console.log("Allowed CORS origins:", allowedOrigins);

    app.enableCors({
        origin: allowedOrigins.length > 0 ? allowedOrigins : "http://localhost:3000",
        credentials: true,
        methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization", "Cookie"],
    });

    // Health check endpoint
    app.getHttpAdapter().get("/", (req, res) => {
        res.send("Server is running");
    });

    // WARNING: DO NOT CHANGE - Railway Deployment Configuration
    // The port MUST be hardcoded to 3001 and "nest start" must be used.
    // Changing to process.env.PORT or "node dist/main" will break Railway deployment.
    // See commit 993b0d63 for details on why this configuration is required.
    await app.listen(3001);
    console.log("Server is running");
}
bootstrap().catch((error) => {
    console.error("BOOTSTRAP FAILED:", error);
    process.exit(1);
});
