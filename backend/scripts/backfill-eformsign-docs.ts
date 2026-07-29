/**
 * One-shot operator script for BJJ-288 eformsign document backfill.
 *
 * Run from backend with production environment variables:
 *   pnpm backfill:eformsign-docs
 * The first run prints the exact target and required
 * EFORMSIGN_BACKFILL_CONFIRM_TARGET=<environment>@<host>:<port>/<db>?schema=<schema>&tenant=<project-or-user-fingerprint>,
 * then exits.
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
import { TenantModule } from "infrastructure/tenant/tenant.module";
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
        // @Global() is global to a graph that imports it, not to the process. AppModule
        // imports TenantModule; this one does not, and EformsignDocModule reaches
        // AreaTemplateModule, whose controller carries @UseGuards(TenantGuard) — Nest
        // instantiates that guard while building the graph and fails on TenantContext.
        // Nothing here serves a request, so the guard is never used; it only has to
        // resolve. Same fix, same reason, as bjj249-service-record-snapshot.live.e2e.spec.
        TenantModule,
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
        `Target environment=${target.environment} databaseTarget=${target.databaseTarget}`,
    );
    assertEformsignBackfillConfirmation(
        target,
        process.env["EFORMSIGN_BACKFILL_CONFIRM_TARGET"],
    );
}

async function runWithoutDistributedLock(
    configService: ConfigService,
    backfill: BackfillEformsignDocsUsecase,
): Promise<EformsignDocsBackfillSummary> {
    if (configService.get<string>("EFORMSIGN_BACKFILL_ALLOW_UNLOCKED") !== "true") {
        throw new Error(
            "VALKEY_URL is unset, so this run cannot take a cross-instance lock."
            + " Nothing would stop a second backfill writing at the same time."
            + " Set VALKEY_URL, or set EFORMSIGN_BACKFILL_ALLOW_UNLOCKED=true once you"
            + " have confirmed no other backfill is running.",
        );
    }

    process.stderr.write(
        "Running without a distributed lock (EFORMSIGN_BACKFILL_ALLOW_UNLOCKED=true).\n",
    );
    return backfill.execute({ onProgress: logProgress });
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
        // No Valkey is provisioned in any environment, and adding one was deliberately
        // deferred — so requiring the lock unconditionally would leave this script
        // unrunnable everywhere. Running a full write sweep with nothing stopping a
        // second operator is a real risk, though, so it takes its own acknowledgement
        // rather than degrading quietly the way the nightly reconcile does.
        const summary = lock.isAvailable()
            ? await lock.runExclusive((lease) =>
                backfill.execute({
                    onProgress: logProgress,
                    shouldContinue: lease.isHeld,
                }))
            : await runWithoutDistributedLock(configService, backfill);
        // Reaching here means every document was mirrored: the usecase now throws rather
        // than returning a summary that carries failures.
        logSummary("completed", summary);
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
