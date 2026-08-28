import {
    ForbiddenException,
    Inject,
    Injectable,
    Logger,
} from "@nestjs/common";

import {
    EFORMSIGN_CLIENT_REPOSITORY,
    EformsignTokenResponse,
    IEformsignClientRepository,
} from "domain/repositories/eformsign.client.interface";
import { sanitizeEformsignErrorMessage } from "application/utils/eformsign-error-message";

/**
 * The only credential shape that a provider operation may receive.  This type
 * is intentionally not a DTO and is never returned by a controller.  Callers
 * must use `withCredentials` so the token pair cannot accidentally become part
 * of an HTTP response or a persisted payload.
 */
export interface EformsignProviderCredentials {
    readonly accessToken: string;
    readonly refreshToken: string;
}

export interface EformsignProviderPrincipal {
    readonly userId?: string;
    readonly branchId?: string;
    readonly globalRole?: string;
    readonly branchRole?: string;
    /** Internal worker marker; never accepted from an HTTP body/header. */
    readonly source?: "worker";
}

/**
 * Constructs the only non-user principal allowed to run queued provider work.
 * The branch id comes from the durable job row after target ownership has been
 * checked; it is not derived from request input at execution time.
 */
export function createEformsignWorkerPrincipal(branchId: string): EformsignProviderPrincipal {
    return { branchId, source: "worker" };
}

/**
 * Constructs a scoped worker principal for company-wide maintenance flows that
 * have no tenant branch (for example the webhook mirror sweep or backfill).
 * The synthetic branch marker is an internal scope label, not an owner
 * identity, and is accepted only for read/backfill capabilities below.
 */
export function createEformsignGlobalWorkerPrincipal(
    scope: "backfill" | "webhook" | "reconciliation" | "test",
): EformsignProviderPrincipal {
    return { branchId: `__system__:${scope}`, source: "worker" };
}

/** Narrow capabilities that are allowed to invoke a provider-side operation. */
export type EformsignProviderCapability =
    | "contract.dispatch"
    | "contract.finalize"
    | "contract.adopt"
    | "document.read"
    | "document.backfill"
    | "document.cancel"
    | "document.re_request";

const CAPABILITY_ROLES: Record<EformsignProviderCapability, readonly string[]> = {
    "contract.dispatch": ["owner", "admin", "manager"],
    "contract.finalize": ["owner", "admin", "manager"],
    "contract.adopt": ["owner", "admin", "manager"],
    "document.read": ["owner", "admin", "manager"],
    "document.backfill": ["owner", "admin", "manager"],
    "document.cancel": ["owner", "admin"],
    "document.re_request": ["owner", "admin", "manager"],
};

/**
 * Enforces the trusted tenant principal at the provider boundary.  A JWT that
 * merely proves active branch membership is not enough to mint or use the
 * service account: the operation must name an explicit capability and the
 * principal must carry a non-empty branch selected by TenantGuard.
 */
export function assertEformsignProviderCapability(
    principal: EformsignProviderPrincipal,
    capability: EformsignProviderCapability,
): void {
    if (!principal.branchId) {
        throw new ForbiddenException("Branch selection required for eformsign operations");
    }

    if (principal.source === "worker") {
        if (principal.userId || principal.globalRole || principal.branchRole) {
            throw new ForbiddenException("Worker principal cannot impersonate a user");
        }
        if (principal.branchId.startsWith("__system__:")
            && capability !== "document.read"
            && capability !== "document.backfill") {
            throw new ForbiddenException("Global worker is restricted to read/backfill capabilities");
        }
        return;
    }

    const role = principal.globalRole === "owner"
        ? "owner"
        : principal.branchRole;
    if (!role || !CAPABILITY_ROLES[capability].includes(role)) {
        throw new ForbiddenException("Eformsign provider capability required");
    }
}

function toCredentials(response: EformsignTokenResponse): EformsignProviderCredentials {
    const accessToken = response.oauth_token?.access_token;
    const refreshToken = response.oauth_token?.refresh_token;
    if (!accessToken || !refreshToken) {
        throw new Error("Eformsign provider returned an incomplete credential response");
    }

    return { accessToken, refreshToken };
}

/**
 * Server-only eformsign credential custody.
 *
 * Tokens are acquired from the configured provider identity and are scoped to
 * one callback.  The callback result is the only value allowed to cross back
 * to an application service/controller; credential fields are never returned
 * by this service.  Refresh is likewise only available for an already-held
 * server credential object, never a request/body/cookie value.
 */
@Injectable()
export class EformsignCredentialBoundary {
    private readonly logger = new Logger(EformsignCredentialBoundary.name);

    constructor(
        @Inject(EFORMSIGN_CLIENT_REPOSITORY)
        private readonly eformsignClient: IEformsignClientRepository,
    ) {}

    async withCredentials<T>(
        principal: EformsignProviderPrincipal,
        capability: EformsignProviderCapability,
        operation: (credentials: EformsignProviderCredentials) => Promise<T> | T,
    ): Promise<T> {
        assertEformsignProviderCapability(principal, capability);

        let credentials: EformsignProviderCredentials;
        try {
            // The provider identity (EFORMSIGN_USER_EMAIL) is selected by the
            // infrastructure client.  There is deliberately no memberEmail
            // or other caller-controlled identity parameter here.
            credentials = toCredentials(await this.eformsignClient.getAccessToken(Date.now()));
        } catch (error) {
            this.logger.error(
                `Eformsign credential acquisition failed capability=${capability} branch=${principal.branchId}: ${sanitizeEformsignErrorMessage(error)}`,
            );
            throw error;
        }

        try {
            return await operation(credentials);
        } catch (error) {
            this.logger.error(
                `Eformsign provider operation failed capability=${capability} branch=${principal.branchId}: ${sanitizeEformsignErrorMessage(error)}`,
            );
            throw error;
        } finally {
            // Strings cannot be scrubbed in-place in JavaScript, but dropping
            // the only server-local reference immediately prevents accidental
            // reuse by later requests and documents the custody boundary.
            credentials = { accessToken: "", refreshToken: "" };
        }
    }

    async withRefreshedCredentials<T>(
        principal: EformsignProviderPrincipal,
        capability: EformsignProviderCapability,
        credentials: EformsignProviderCredentials,
        operation: (refreshed: EformsignProviderCredentials) => Promise<T> | T,
    ): Promise<T> {
        assertEformsignProviderCapability(principal, capability);

        let refreshed: EformsignProviderCredentials;
        try {
            refreshed = toCredentials(
                await this.eformsignClient.refreshAccessToken(Date.now(), credentials.refreshToken),
            );
        } catch (error) {
            this.logger.error(
                `Eformsign credential refresh failed capability=${capability} branch=${principal.branchId}: ${sanitizeEformsignErrorMessage(error)}`,
            );
            throw error;
        }

        try {
            return await operation(refreshed);
        } catch (error) {
            this.logger.error(
                `Eformsign provider operation after refresh failed capability=${capability} branch=${principal.branchId}: ${sanitizeEformsignErrorMessage(error)}`,
            );
            throw error;
        } finally {
            refreshed = { accessToken: "", refreshToken: "" };
        }
    }
}
