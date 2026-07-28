export interface EformsignBackfillTarget {
    environment: string;
    databaseHost: string;
}

const UNKNOWN_TARGET = "unknown";

function normalizedTargetPart(value: string | undefined): string {
    return value?.trim() || UNKNOWN_TARGET;
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
    try {
        databaseHost = normalizedTargetPart(
            params.databaseUrl ? new URL(params.databaseUrl).hostname : undefined,
        );
    } catch {
        databaseHost = UNKNOWN_TARGET;
    }

    return { environment, databaseHost };
}

export function assertEformsignBackfillConfirmation(
    target: EformsignBackfillTarget,
    confirmation: string | undefined,
): void {
    if (
        target.environment === UNKNOWN_TARGET
        || target.databaseHost === UNKNOWN_TARGET
    ) {
        throw new Error(
            "Cannot determine the eformsign backfill target environment and database host",
        );
    }

    const expectedConfirmation = `${target.environment}@${target.databaseHost}`;
    if (confirmation?.trim() !== expectedConfirmation) {
        throw new Error(
            `Set EFORMSIGN_BACKFILL_CONFIRM_TARGET=${expectedConfirmation} to confirm this exact target`,
        );
    }
}
