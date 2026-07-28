/**
 * One-shot operator script for BJJ-288 eformsign document backfill.
 *
 * Run from backend with production environment variables:
 *   pnpm backfill:eformsign-docs
 * The first run prints the exact target and required
 * EFORMSIGN_BACKFILL_CONFIRM_TARGET=<environment>@<database-host> value, then exits.
 *
 * The command fails closed unless VALKEY_URL is configured. It never triggers
 * notification, client-linking, end-date sync, or service-record snapshot paths.
 */
import "reflect-metadata";

import { Logger, Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { resolve } from "node:path";

import {
    BackfillEformsignDocsError,
    BackfillEformsignDocsUsecase,
    EformsignDocsBackfillProgress,
    EformsignDocsBackfillSummary,
} from "application/usecases/eformsign-doc/backfill-eformsign-docs.usecase";
import {
    assertEformsignBackfillConfirmation,
    resolveEformsignBackfillTarget,
} from "application/utils/eformsign-backfill-safety";
import { EformsignBackfillLockService } from "infrastructure/locking/eformsign-backfill-lock.service";
import { EformsignDocModule } from "module/eformsign-doc.module";

const ENV_FILE_PATHS = [
    resolve(process.cwd(), ".env.local"),
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), "backend/.env.local"),
    resolve(process.cwd(), "backend/.env"),
];

@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
            envFilePath: ENV_FILE_PATHS,
        }),
        EformsignDocModule,
    ],
})
class EformsignBackfillCliModule {}

const logger = new Logger("EformsignBackfillOperator");

function logProgress(progress: EformsignDocsBackfillProgress): void {
    logger.log(JSON.stringify(progress));
}

function logSummary(
    outcome: "completed" | "failed",
    summary: EformsignDocsBackfillSummary,
): void {
    logger.log(JSON.stringify({
        outcome,
        summary,
    }));
}

function confirmOperatorTarget(): void {
    const target = resolveEformsignBackfillTarget({
        railwayEnvironmentName: process.env["RAILWAY_ENVIRONMENT_NAME"],
        nodeEnv: process.env["NODE_ENV"],
        databaseUrl: process.env["DATABASE_URL"],
    });
    logger.warn(
        `Target environment=${target.environment} databaseHost=${target.databaseHost}`,
    );
    assertEformsignBackfillConfirmation(
        target,
        process.env["EFORMSIGN_BACKFILL_CONFIRM_TARGET"],
    );
}

async function main(): Promise<void> {
    // ConfigModule.forRoot loads ENV_FILE_PATHS while this module is evaluated.
    // Keep confirmation before Nest bootstrap because Prisma connects during bootstrap.
    confirmOperatorTarget();
    const app = await NestFactory.createApplicationContext(
        EformsignBackfillCliModule,
        { logger: ["error", "warn", "log"] },
    );

    try {
        const configService = app.get(ConfigService);
        if (configService.get<string>("E2E_VENDOR_STUBS") === "1") {
            throw new Error("E2E_VENDOR_STUBS=1 is not allowed for the operator backfill");
        }

        const backfill = app.get(BackfillEformsignDocsUsecase);
        const lock = app.get(EformsignBackfillLockService);
        const summary = await lock.runExclusive((lease) =>
            backfill.execute({
                onProgress: logProgress,
                shouldContinue: lease.isHeld,
            }),
        );
        logSummary("completed", summary);
        if (summary.failed > 0) {
            process.exitCode = 1;
        }
    } catch (error) {
        if (error instanceof BackfillEformsignDocsError) {
            logSummary("failed", error.summary);
        }
        throw error;
    } finally {
        await app.close();
    }
}

void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Eformsign backfill failed: ${message}\n`);
    process.exitCode = 1;
});
