import {
    ForbiddenException,
    Injectable,
    Logger,
    UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Prisma } from "@prisma/client";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "crypto";

import { PrismaService } from "infrastructure/database/prisma.service";
import { getAuthTokenMaxAgeMs } from "./auth-token-policy";

const ACCESS_TOKEN_EXPIRES_IN = "15m";
const CONCURRENT_REFRESH_GRACE_MS = 5_000;

type SessionUser = {
    id: string;
    role: string | null;
    approvalStatus: string;
    tokenVersion: number;
};

export type IssuedAuthTokens = {
    accessToken: string;
    refreshToken: string;
};

type RotationResult =
    | {
        kind: "success";
        user: SessionUser;
        sessionId: string;
        branchId?: string;
        branchRole?: string;
        refreshToken: string;
    }
    | {
        kind: "error";
        code:
            | "AUTH_REFRESH_INVALID"
            | "AUTH_REFRESH_EXPIRED"
            | "AUTH_REFRESH_REPLAY_CONCURRENT"
            | "AUTH_REFRESH_REUSED"
            | "AUTH_SESSION_REVOKED";
    };

@Injectable()
export class AuthSessionService {
    private readonly logger = new Logger(AuthSessionService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly jwt: JwtService,
    ) {}

    async issueSession(
        user: SessionUser,
        params: {
            branchId?: string;
            branchRole?: string;
            revokeSessionId?: string;
            revokeReason?: string;
        } = {},
    ): Promise<IssuedAuthTokens> {
        this.assertUserApproved(user);

        const now = new Date();
        const expiresAt = new Date(now.getTime() + getAuthTokenMaxAgeMs(user.role));
        const sessionId = randomUUID();
        const refreshTokenId = randomUUID();
        const refreshSecret = randomBytes(32).toString("base64url");
        const refreshToken = `${refreshTokenId}.${refreshSecret}`;

        await this.prisma.$transaction(async (tx) => {
            if (params.revokeSessionId) {
                await tx.auth_session.updateMany({
                    where: {
                        id: params.revokeSessionId,
                        userId: user.id,
                        revokedAt: null,
                    },
                    data: {
                        revokedAt: now,
                        revokedReason: params.revokeReason ?? "session_replaced",
                    },
                });
            }

            await tx.auth_session.create({
                data: {
                    id: sessionId,
                    userId: user.id,
                    selectedBranchId: params.branchId,
                    expiresAt,
                    lastUsedAt: now,
                },
            });
            await tx.auth_refresh_token.create({
                data: {
                    id: refreshTokenId,
                    sessionId,
                    secretHash: this.hashSecret(refreshSecret),
                    expiresAt,
                },
            });
        });

        return {
            accessToken: await this.signAccessToken(user, sessionId, params),
            refreshToken,
        };
    }

    async rotateRefreshToken(rawToken: string): Promise<IssuedAuthTokens> {
        const parsed = this.parseRefreshToken(rawToken);
        if (!parsed) {
            throw this.refreshError("AUTH_REFRESH_INVALID", "Invalid refresh token");
        }

        const now = new Date();
        const successorId = randomUUID();
        const successorSecret = randomBytes(32).toString("base64url");
        const successorToken = `${successorId}.${successorSecret}`;

        const result = await this.prisma.$transaction<RotationResult>(async (tx) => {
            const candidate = await tx.auth_refresh_token.findUnique({
                where: { id: parsed.tokenId },
                select: {
                    sessionId: true,
                    secretHash: true,
                },
            });

            if (!candidate || !this.matchesSecret(candidate.secretHash, parsed.secret)) {
                return { kind: "error", code: "AUTH_REFRESH_INVALID" };
            }

            if (!await this.lockSession(tx, candidate.sessionId)) {
                return { kind: "error", code: "AUTH_SESSION_REVOKED" };
            }

            const current = await tx.auth_refresh_token.findUnique({
                where: { id: parsed.tokenId },
                include: {
                    session: {
                        include: {
                            user: {
                                select: {
                                    id: true,
                                    role: true,
                                    approvalStatus: true,
                                    tokenVersion: true,
                                },
                            },
                        },
                    },
                },
            });

            if (!current) {
                return { kind: "error", code: "AUTH_REFRESH_INVALID" };
            }

            if (current.session.revokedAt) {
                return { kind: "error", code: "AUTH_SESSION_REVOKED" };
            }

            if (
                current.expiresAt.getTime() <= now.getTime()
                || current.session.expiresAt.getTime() <= now.getTime()
            ) {
                await this.revokeSessionWithinTx(tx, current.sessionId, now, "session_expired");
                return { kind: "error", code: "AUTH_REFRESH_EXPIRED" };
            }

            if (current.usedAt) {
                return this.handleRefreshReplay(
                    tx,
                    current.sessionId,
                    current.usedAt,
                    now,
                );
            }
            if (current.revokedAt) {
                return { kind: "error", code: "AUTH_REFRESH_INVALID" };
            }

            this.assertUserApproved(current.session.user);

            const consumed = await tx.auth_refresh_token.updateMany({
                where: {
                    id: current.id,
                    usedAt: null,
                    revokedAt: null,
                },
                data: {
                    usedAt: now,
                    replacedByTokenId: successorId,
                    activeMarker: null,
                },
            });

            if (consumed.count !== 1) {
                const raced = await tx.auth_refresh_token.findUnique({
                    where: { id: current.id },
                    select: { usedAt: true, revokedAt: true },
                });
                if (raced?.revokedAt && !raced.usedAt) {
                    return { kind: "error", code: "AUTH_REFRESH_INVALID" };
                }
                return this.handleRefreshReplay(
                    tx,
                    current.sessionId,
                    raced?.usedAt ?? null,
                    now,
                );
            }

            const branch = await this.resolveFreshBranchPrincipal(
                tx,
                current.session.user,
                current.session.selectedBranchId,
            );

            await tx.auth_refresh_token.create({
                data: {
                    id: successorId,
                    sessionId: current.sessionId,
                    secretHash: this.hashSecret(successorSecret),
                    expiresAt: current.session.expiresAt,
                },
            });
            await tx.auth_session.update({
                where: { id: current.sessionId },
                data: {
                    lastUsedAt: now,
                    selectedBranchId: branch.branchId ?? null,
                },
            });

            return {
                kind: "success",
                user: current.session.user,
                sessionId: current.sessionId,
                branchId: branch.branchId,
                branchRole: branch.branchRole,
                refreshToken: successorToken,
            };
        });

        if (result.kind === "error") {
            this.logger.warn(JSON.stringify({
                event: "auth_refresh",
                result: result.code,
            }));
            throw this.refreshError(result.code, "Invalid or expired refresh token");
        }

        this.assertUserApproved(result.user);
        this.logger.log(JSON.stringify({
            event: "auth_refresh",
            result: "success",
            sessionId: result.sessionId,
        }));

        return {
            accessToken: await this.signAccessToken(
                result.user,
                result.sessionId,
                {
                    branchId: result.branchId,
                    branchRole: result.branchRole,
                },
            ),
            refreshToken: result.refreshToken,
        };
    }

    async changeSessionBranch(
        sessionId: string,
        user: SessionUser,
        branch: { branchId: string; branchRole: string },
    ): Promise<IssuedAuthTokens> {
        this.assertUserApproved(user);

        const now = new Date();
        const successorId = randomUUID();
        const successorSecret = randomBytes(32).toString("base64url");
        const refreshToken = `${successorId}.${successorSecret}`;

        const session = await this.prisma.$transaction(async (tx) => {
            if (!await this.lockSession(tx, sessionId)) {
                return null;
            }
            const activeSession = await tx.auth_session.findFirst({
                where: {
                    id: sessionId,
                    userId: user.id,
                    revokedAt: null,
                    expiresAt: { gt: now },
                },
                select: { id: true, expiresAt: true },
            });
            if (!activeSession) {
                return null;
            }

            await tx.auth_refresh_token.updateMany({
                where: {
                    sessionId,
                    usedAt: null,
                    revokedAt: null,
                },
                data: { revokedAt: now, activeMarker: null },
            });
            await tx.auth_refresh_token.create({
                data: {
                    id: successorId,
                    sessionId,
                    secretHash: this.hashSecret(successorSecret),
                    expiresAt: activeSession.expiresAt,
                },
            });
            await tx.auth_session.update({
                where: { id: sessionId },
                data: {
                    selectedBranchId: branch.branchId,
                    lastUsedAt: now,
                },
            });

            return activeSession;
        });

        if (!session) {
            throw this.refreshError("AUTH_SESSION_REVOKED", "Session is not active");
        }

        return {
            accessToken: await this.signAccessToken(user, sessionId, branch),
            refreshToken,
        };
    }

    async issueTokensForAuthorizationCode(
        sessionId: string,
    ): Promise<IssuedAuthTokens> {
        const session = await this.prisma.auth_session.findUnique({
            where: { id: sessionId },
            include: {
                user: {
                    select: {
                        id: true,
                        role: true,
                        approvalStatus: true,
                        tokenVersion: true,
                    },
                },
            },
        });
        if (
            !session
            || session.revokedAt
            || session.expiresAt.getTime() <= Date.now()
        ) {
            throw this.refreshError("AUTH_SESSION_REVOKED", "Session is not active");
        }

        const branch = await this.prisma.$transaction((tx) =>
            this.resolveFreshBranchPrincipal(
                tx,
                session.user,
                session.selectedBranchId,
            ),
        );

        return this.changeSessionBranchOrRefreshCredential(
            session.id,
            session.user,
            session.expiresAt,
            branch,
        );
    }

    async revokeSession(
        sessionId: string,
        userId: string,
        reason = "logout",
        pushEndpoint?: string,
    ): Promise<void> {
        const now = new Date();
        await this.prisma.$transaction(async (tx) => {
            await tx.auth_session.updateMany({
                where: { id: sessionId, userId, revokedAt: null },
                data: { revokedAt: now, revokedReason: reason },
            });
            await tx.auth_refresh_token.updateMany({
                where: { sessionId, revokedAt: null },
                data: { revokedAt: now, activeMarker: null },
            });
            if (this.shouldCleanUpPushSubscriptions(reason)) {
                await this.deletePushSubscriptionsWithinTx(tx, userId, pushEndpoint);
            }
        });
    }

    async revokeSessionByRefreshToken(
        rawToken: string,
        reason = "logout",
        pushEndpoint?: string,
    ): Promise<boolean> {
        const parsed = this.parseRefreshToken(rawToken);
        if (!parsed) return false;

        return this.prisma.$transaction(async (tx) => {
            const token = await tx.auth_refresh_token.findUnique({
                where: { id: parsed.tokenId },
                select: {
                    sessionId: true,
                    secretHash: true,
                    session: { select: { userId: true } },
                },
            });
            if (!token || !this.matchesSecret(token.secretHash, parsed.secret)) {
                return false;
            }
            await this.revokeSessionWithinTx(
                tx,
                token.sessionId,
                new Date(),
                reason,
            );
            if (this.shouldCleanUpPushSubscriptions(reason)) {
                await this.deletePushSubscriptionsWithinTx(
                    tx,
                    token.session.userId,
                    pushEndpoint,
                );
            }
            return true;
        });
    }

    async revokeSessionByAccessToken(
        rawToken: string,
        reason = "logout",
        pushEndpoint?: string,
    ): Promise<void> {
        let payload: {
            sub?: string;
            sid?: string;
            type?: string;
        };
        try {
            payload = await this.jwt.verifyAsync<{
                sub?: string;
                sid?: string;
                type?: string;
            }>(rawToken, { ignoreExpiration: true });
        } catch {
            // Invalid or unverifiable bearer tokens cannot identify an owner;
            // keep logout idempotent without attempting a user-wide cleanup.
            return;
        }

        if (
            payload.type !== "access"
            || typeof payload.sub !== "string"
            || typeof payload.sid !== "string"
        ) {
            return;
        }

        // Deliberately keep revocation errors visible. A valid token with a
        // failed transactional push cleanup must not be acknowledged as a
        // successful server logout.
        await this.revokeSession(payload.sid, payload.sub, reason, pushEndpoint);
    }

    async revokeAllUserSessions(
        userId: string,
        reason = "logout_all",
        exceptSessionId?: string,
        pushEndpoint?: string,
    ): Promise<void> {
        const now = new Date();
        const sessionWhere = {
            userId,
            ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
        };
        await this.prisma.$transaction(async (tx) => {
            await tx.auth_session.updateMany({
                where: {
                    ...sessionWhere,
                    revokedAt: null,
                },
                data: { revokedAt: now, revokedReason: reason },
            });
            await tx.auth_refresh_token.updateMany({
                where: {
                    session: sessionWhere,
                    revokedAt: null,
                },
                data: { revokedAt: now, activeMarker: null },
            });
            if (this.shouldCleanUpPushSubscriptions(reason)) {
                await this.deletePushSubscriptionsWithinTx(tx, userId, pushEndpoint);
            }
        });
    }

    private shouldCleanUpPushSubscriptions(reason: string): boolean {
        return reason === "logout" || reason === "logout_all";
    }

    private async deletePushSubscriptionsWithinTx(
        tx: Prisma.TransactionClient,
        userId: string,
        pushEndpoint?: string,
    ): Promise<void> {
        // First-party logout pages pass the browser endpoint so other devices
        // remain enrolled. Legacy/API callers cannot identify one browser, so
        // remove every endpoint owned by the user rather than leave an
        // account-bound delivery channel active after logout.
        await tx.push_subscription.deleteMany({
            where: pushEndpoint
                ? { userId, endpoint: pushEndpoint }
                : { userId },
        });
    }

    private async changeSessionBranchOrRefreshCredential(
        sessionId: string,
        user: SessionUser,
        expiresAt: Date,
        branch: { branchId?: string; branchRole?: string },
    ): Promise<IssuedAuthTokens> {
        this.assertUserApproved(user);
        const now = new Date();
        const successorId = randomUUID();
        const successorSecret = randomBytes(32).toString("base64url");

        await this.prisma.$transaction(async (tx) => {
            if (!await this.lockSession(tx, sessionId)) {
                throw this.refreshError(
                    "AUTH_SESSION_REVOKED",
                    "Session is not active",
                );
            }
            const active = await tx.auth_session.updateMany({
                where: {
                    id: sessionId,
                    userId: user.id,
                    revokedAt: null,
                    expiresAt: { gt: now },
                },
                data: {
                    selectedBranchId: branch.branchId ?? null,
                    lastUsedAt: now,
                },
            });
            if (active.count !== 1) {
                throw this.refreshError(
                    "AUTH_SESSION_REVOKED",
                    "Session is not active",
                );
            }
            await tx.auth_refresh_token.updateMany({
                where: { sessionId, usedAt: null, revokedAt: null },
                data: { revokedAt: now, activeMarker: null },
            });
            await tx.auth_refresh_token.create({
                data: {
                    id: successorId,
                    sessionId,
                    secretHash: this.hashSecret(successorSecret),
                    expiresAt,
                },
            });
        });

        return {
            accessToken: await this.signAccessToken(user, sessionId, branch),
            refreshToken: `${successorId}.${successorSecret}`,
        };
    }

    private async signAccessToken(
        user: SessionUser,
        sessionId: string,
        branch: { branchId?: string; branchRole?: string },
    ): Promise<string> {
        return this.jwt.signAsync(
            {
                sub: user.id,
                sid: sessionId,
                role: user.role,
                tokenVersion: user.tokenVersion,
                ...(branch.branchId
                    ? {
                        branchId: branch.branchId,
                        branchRole: branch.branchRole,
                    }
                    : {}),
                type: "access",
            },
            { expiresIn: ACCESS_TOKEN_EXPIRES_IN },
        );
    }

    private async resolveFreshBranchPrincipal(
        tx: Prisma.TransactionClient,
        user: SessionUser,
        selectedBranchId: string | null,
    ): Promise<{ branchId?: string; branchRole?: string }> {
        if (!selectedBranchId) {
            return {};
        }

        if (user.role === "owner") {
            const branch = await tx.branch.findUnique({
                where: { id: selectedBranchId },
                select: { id: true, isActive: true },
            });
            return branch?.isActive
                ? { branchId: branch.id, branchRole: "owner" }
                : {};
        }

        const membership = await tx.user_branch.findUnique({
            where: {
                userId_branchId: {
                    userId: user.id,
                    branchId: selectedBranchId,
                },
            },
            select: {
                role: true,
                branch: { select: { id: true, isActive: true } },
            },
        });

        return membership?.branch.isActive
            ? {
                branchId: membership.branch.id,
                branchRole: membership.role ?? "user",
            }
            : {};
    }

    private async handleRefreshReplay(
        tx: Prisma.TransactionClient,
        sessionId: string,
        usedAt: Date | null,
        now: Date,
    ): Promise<RotationResult> {
        if (
            usedAt
            && now.getTime() - usedAt.getTime() <= CONCURRENT_REFRESH_GRACE_MS
        ) {
            return { kind: "error", code: "AUTH_REFRESH_REPLAY_CONCURRENT" };
        }

        await this.revokeSessionWithinTx(tx, sessionId, now, "refresh_token_reuse");
        return { kind: "error", code: "AUTH_REFRESH_REUSED" };
    }

    private async revokeSessionWithinTx(
        tx: Prisma.TransactionClient,
        sessionId: string,
        now: Date,
        reason: string,
    ): Promise<void> {
        await tx.auth_session.updateMany({
            where: { id: sessionId, revokedAt: null },
            data: { revokedAt: now, revokedReason: reason },
        });
        await tx.auth_refresh_token.updateMany({
            where: { sessionId, revokedAt: null },
            data: { revokedAt: now, activeMarker: null },
        });
    }

    private async lockSession(
        tx: Prisma.TransactionClient,
        sessionId: string,
    ): Promise<boolean> {
        const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
            SELECT "id"
            FROM "auth_session"
            WHERE "id" = CAST(${sessionId} AS UUID)
            FOR UPDATE
        `);
        return rows.length === 1;
    }

    private parseRefreshToken(
        token: string,
    ): { tokenId: string; secret: string } | null {
        const [tokenId, secret, extra] = token.split(".");
        if (
            !tokenId
            || !secret
            || extra !== undefined
            || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(tokenId)
            || !/^[A-Za-z0-9_-]{32,128}$/.test(secret)
        ) {
            return null;
        }
        return { tokenId, secret };
    }

    private hashSecret(secret: string): string {
        return createHash("sha256").update(secret).digest("hex");
    }

    private matchesSecret(expectedHash: string, secret: string): boolean {
        const actual = Buffer.from(this.hashSecret(secret), "hex");
        const expected = Buffer.from(expectedHash, "hex");
        return actual.length === expected.length && timingSafeEqual(actual, expected);
    }

    private assertUserApproved(user: SessionUser): void {
        if (user.role === "owner" || user.approvalStatus === "approved") {
            return;
        }
        throw new ForbiddenException({
            code: user.approvalStatus === "rejected"
                ? "ACCOUNT_REJECTED"
                : "PENDING_APPROVAL",
            message: user.approvalStatus === "rejected"
                ? "가입이 거부되었습니다."
                : "관리자 승인 대기 중입니다.",
        });
    }

    private refreshError(code: string, message: string): UnauthorizedException {
        return new UnauthorizedException({ code, message });
    }
}
