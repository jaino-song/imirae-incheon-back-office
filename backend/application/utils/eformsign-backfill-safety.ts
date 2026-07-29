import { createHash } from "node:crypto";

export interface EformsignBackfillTarget {
    environment: string;
    databaseHost: string;
    databaseTarget: string;
}

const UNKNOWN_TARGET = "unknown";
const USERNAME_FINGERPRINT_LENGTH = 12;

function normalizedTargetPart(value: string | undefined): string {
    return value?.trim() || UNKNOWN_TARGET;
}

function databaseTenantIdentifier(databaseUrl: URL): string {
    const username = decodeURIComponent(databaseUrl.username).trim();
    if (!username) {
        return UNKNOWN_TARGET;
    }

    const projectSeparator = username.indexOf(".");
    if (projectSeparator >= 0 && projectSeparator < username.length - 1) {
        return normalizedTargetPart(username.slice(projectSeparator + 1));
    }

    // Generic database usernames may be sensitive; retain target separation without exposing them.
    const fingerprint = createHash("sha256")
        .update(username)
        .digest("hex")
        .slice(0, USERNAME_FINGERPRINT_LENGTH);
    return `user-${fingerprint}`;
}

export function resolveEformsignBackfillTarget(params: {
    railwayEnvironmentName?: string;
    nodeEnv?: string;
    databaseUrl?: string;
}): EformsignBackfillTarget {
    const railwayEnvironment = normalizedTargetPart(params.railwayEnvironmentName);
    const environment = railwayEnvironment === UNKNOWN_TARGET
        ? normalizedTargetPart(params.nodeEnv)
        : railwayEnvironment;
    let databaseHost = UNKNOWN_TARGET;
    let databaseTarget = UNKNOWN_TARGET;
    try {
        const databaseUrl = params.databaseUrl
            ? new URL(params.databaseUrl)
            : null;
        databaseHost = normalizedTargetPart(databaseUrl?.hostname);
        const databasePort = normalizedTargetPart(databaseUrl?.port || "5432");
        const databaseName = normalizedTargetPart(
            databaseUrl
                ? decodeURIComponent(databaseUrl.pathname.replace(/^\/+/, ""))
                : undefined,
        );
        const databaseSchema = normalizedTargetPart(
            databaseUrl?.searchParams.get("schema") || "public",
        );
        const databaseTenant = databaseUrl
            ? databaseTenantIdentifier(databaseUrl)
            : UNKNOWN_TARGET;
        if (
            databaseHost !== UNKNOWN_TARGET
            && databasePort !== UNKNOWN_TARGET
            && databaseName !== UNKNOWN_TARGET
            && databaseSchema !== UNKNOWN_TARGET
            && databaseTenant !== UNKNOWN_TARGET
        ) {
            databaseTarget = `${databaseHost}:${databasePort}/${encodeURIComponent(databaseName)}?schema=${encodeURIComponent(databaseSchema)}&tenant=${encodeURIComponent(databaseTenant)}`;
        }
    } catch {
        databaseHost = UNKNOWN_TARGET;
        databaseTarget = UNKNOWN_TARGET;
    }

    return { environment, databaseHost, databaseTarget };
}

export function assertEformsignBackfillConfirmation(
    target: EformsignBackfillTarget,
    confirmation: string | undefined,
): void {
    if (
        target.environment === UNKNOWN_TARGET
        || target.databaseHost === UNKNOWN_TARGET
        || target.databaseTarget === UNKNOWN_TARGET
    ) {
        throw new Error(
            "Cannot determine the eformsign backfill target environment and database target",
        );
    }

    const expectedConfirmation = `${target.environment}@${target.databaseTarget}`;
    if (confirmation?.trim() !== expectedConfirmation) {
        throw new Error(
            `Set EFORMSIGN_BACKFILL_CONFIRM_TARGET=${expectedConfirmation} to confirm this exact target`,
        );
    }
}
