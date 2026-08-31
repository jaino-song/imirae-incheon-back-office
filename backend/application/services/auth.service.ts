import { BadRequestException, ForbiddenException, Inject, Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../infrastructure/database/prisma.service";
import { runSystemScope } from "../../infrastructure/tenant/run-system-scope";
import { JwtService } from "@nestjs/jwt";
import * as crypto from "crypto";
import * as bcrypt from "bcrypt";
import { EMAIL_PORT, EmailPort } from "../../domain/ports/email.port";
import { AUTH_TOKEN_REPOSITORY, IAuthTokenRepository } from "../../domain/repositories/auth-token.repository.interface";
import { maskEmail } from "application/utils/mask";
import { isVisibleStaffBranchSlug } from "domain/constants/branch-routing.constants";
import { AuthSessionService } from "./auth-session.service";
import { AuthEmailTokenService } from "./auth-email-token.service";
import {
    AUTH_ERROR_CODES,
    AUTH_ERROR_MESSAGES,
} from "../constants/auth-error.constants";

export const NO_ACCESSIBLE_BRANCH_MESSAGE = AUTH_ERROR_MESSAGES.NO_ACCESSIBLE_BRANCH;
export const PENDING_APPROVAL_CODE = AUTH_ERROR_CODES.PENDING_APPROVAL;
export const PENDING_APPROVAL_MESSAGE = AUTH_ERROR_MESSAGES.PENDING_APPROVAL;

export interface KakaoData {
    kakaoId: string;
    email?: string;
    emailValid?: boolean;
    emailVerified?: boolean;
    name?: string;
    profileImage?: string;
}

export interface TokenPayload {
    sub: string;
    sid: string;
    role: string | null;
    tokenVersion: number;
    branchId?: string;
    branchRole?: string;
    organizationId?: string;
    orgRole?: string;
    type: 'access' | 'refresh';
}

export interface UserValidationResult {
    user: string;
    accessToken: string;
    refreshToken: string;
    requiresBranchSelection?: boolean;
}

export interface PendingKakaoSignupProfile {
    email?: string;
    name?: string;
    profileImage?: string;
}

export interface PendingAccountOnboardingProfile extends PendingKakaoSignupProfile {
    phone?: string;
    birthDate?: string;
    branchId?: string;
    role?: string;
}

export interface PendingKakaoSignupValidationResult {
    onboardingRequired: true;
    onboardingKind: "kakao_signup";
    pendingSignupData: KakaoData;
}

export interface PendingAccountOnboardingValidationResult {
    onboardingRequired: true;
    onboardingKind: "account_completion";
    userId: string;
    prefill: PendingAccountOnboardingProfile;
}

export type KakaoUserValidationResult =
    | UserValidationResult
    | PendingKakaoSignupValidationResult
    | PendingAccountOnboardingValidationResult;

export type EmailUserValidationResult =
    | UserValidationResult
    | PendingAccountOnboardingValidationResult;

export type KakaoLoginClient = 'desktop' | 'mobile' | 'legacy';

export interface PendingKakaoSignupExchangeResult {
    onboardingRequired: true;
    onboardingRoute: "/kakao/onboarding";
    pendingSignupToken: string;
    prefill: PendingKakaoSignupProfile;
}

export interface PendingAccountOnboardingExchangeResult {
    onboardingRequired: true;
    onboardingRoute: "/onboarding";
    pendingAccountOnboardingToken: string;
}

export type TokenExchangeResult = {
    accessToken: string;
    refreshToken: string;
    requiresBranchSelection?: boolean;
} | PendingKakaoSignupExchangeResult | PendingAccountOnboardingExchangeResult;

export interface PasswordValidationResult {
    valid: boolean;
    errors: string[];
}

type UserBranchSelection = {
    branchId: string;
    role: string | null;
    branch?: {
        slug: string | null;
        isActive: boolean | null;
    };
};

export interface RegistrationResult {
    success: boolean;
    message: string;
    userId?: string;
    code?: string;
}

export function buildAuthEmailProviderIdempotencyKey(
    tokenId: string,
    kind: "email_verification" | "password_reset",
): string {
    return `auth-email:${crypto
        .createHash("sha256")
        .update(`${kind}:${tokenId}`)
        .digest("hex")}`;
}

@Injectable()
export class AuthService {
    private readonly logger = new Logger(AuthService.name);
    private readonly BCRYPT_SALT_ROUNDS = 12;
    private readonly FRONTEND_URL: string;
    private publicBranchCache: {
        expiresAt: number;
        value: Array<{ id: string; name: string }>;
    } | null = null;

    constructor(
        private prisma: PrismaService,
        private jwt: JwtService,
        @Inject(EMAIL_PORT) private emailService: EmailPort,
        @Inject(AUTH_TOKEN_REPOSITORY) private authTokenRepository: IAuthTokenRepository,
        private readonly authSessionService: AuthSessionService,
        private readonly authEmailTokens: AuthEmailTokenService = new AuthEmailTokenService(),
    ) {
        const nodeEnv = process.env['NODE_ENV'];
        if (nodeEnv === "production") {
            this.FRONTEND_URL = process.env['PRODUCTION_FRONTEND_URL'] ?? "http://localhost:3000";
        } else if (nodeEnv === "preview") {
            this.FRONTEND_URL = process.env['PREVIEW_FRONTEND_URL'] ?? "http://localhost:3000";
        } else {
            this.FRONTEND_URL = process.env['DEVELOPMENT_FRONTEND_URL'] ?? "http://localhost:3000";
        }
    }

    private async issueBranchTokens(
        user: { id: string; role: string | null; approvalStatus: string; tokenVersion: number },
        branchId: string,
        branchRole: string,
        sessionId?: string,
    ): Promise<{ accessToken: string; refreshToken: string }> {
        this.assertUserApproved(user);
        return sessionId
            ? this.authSessionService.changeSessionBranch(
                sessionId,
                user,
                { branchId, branchRole },
            )
            : this.authSessionService.issueSession(
                user,
                { branchId, branchRole },
            );
    }

    private getPendingAccountOnboardingProfile(
        user: {
            id: string;
            email: string | null;
            name: string | null;
            profileImage: string | null;
            phone: string | null;
            birthDate: string | null;
            role: string | null;
        },
        userOrgs: UserBranchSelection[],
    ): PendingAccountOnboardingProfile | null {
        const [firstOrg] = userOrgs;

        const needsPhone = !user.phone;
        const needsBirthDate = !user.birthDate;
        const needsRole = !user.role;
        const needsBranch = userOrgs.length === 0;
        const needsBranchRole = userOrgs.length === 1 && !firstOrg?.role;

        if (!needsPhone && !needsBirthDate && !needsRole && !needsBranch && !needsBranchRole) {
            return null;
        }

        return {
            email: user.email ?? undefined,
            name: user.name ?? undefined,
            profileImage: user.profileImage ?? undefined,
            phone: user.phone ?? undefined,
            birthDate: user.birthDate ?? undefined,
            branchId: userOrgs.length === 1 ? firstOrg?.branchId : undefined,
            role: firstOrg?.role ?? user.role ?? undefined,
        };
    }

    private filterSelectableUserBranches<TUserBranch extends UserBranchSelection>(
        userBranches: TUserBranch[],
    ): TUserBranch[] {
        return userBranches.filter((userBranch) => {
            if (!userBranch.branch) {
                return true;
            }

            return userBranch.branch.isActive === true
                && isVisibleStaffBranchSlug(userBranch.branch.slug ?? "");
        });
    }

    private async createLoginResultForUser(user: {
        id: string;
        email: string | null;
        name: string | null;
        profileImage: string | null;
        phone: string | null;
        birthDate: string | null;
        role: string | null;
        approvalStatus: string;
        tokenVersion: number;
    }): Promise<UserValidationResult | PendingAccountOnboardingValidationResult> {
        this.assertUserApproved(user);
        // Cross-branch by design: enumerates the user's own memberships before any
        // branch is selected, so no tenant store branchId exists yet.
        const userOrgs = this.filterSelectableUserBranches(await runSystemScope(() => this.prisma.user_branch.findMany({
            where: { userId: user.id },
            select: {
                branchId: true,
                role: true,
                branch: {
                    select: {
                        slug: true,
                        isActive: true,
                    },
                },
            },
        })));

        if (user.role === 'owner') {
            const { accessToken, refreshToken } =
                await this.authSessionService.issueSession(user);

            return {
                user: user.id,
                accessToken,
                refreshToken,
                requiresBranchSelection: true,
            };
        }

        if (userOrgs.length === 0) {
            throw new ForbiddenException({
                code: AUTH_ERROR_CODES.NO_ACCESSIBLE_BRANCH,
                message: NO_ACCESSIBLE_BRANCH_MESSAGE,
            });
        }

        if (!user.phone || !user.birthDate) {
            throw new ForbiddenException({
                code: AUTH_ERROR_CODES.ACCOUNT_PROFILE_INCOMPLETE,
                message: AUTH_ERROR_MESSAGES.ACCOUNT_PROFILE_INCOMPLETE,
            });
        }

        if (!user.role || userOrgs.some((userOrg) => !userOrg.role)) {
            throw new ForbiddenException({
                code: AUTH_ERROR_CODES.NO_ACCESSIBLE_BRANCH,
                message: NO_ACCESSIBLE_BRANCH_MESSAGE,
            });
        }

        let branchId: string | undefined;
        let branchRole: string | undefined;
        let requiresBranchSelection = false;

        const [firstOrg] = userOrgs;

        if (userOrgs.length === 1 && firstOrg) {
            branchId = firstOrg.branchId;
            branchRole = firstOrg.role ?? undefined;
        } else if (userOrgs.length > 1) {
            requiresBranchSelection = true;
        } else if (userOrgs.length === 0) {
            requiresBranchSelection = true;
        }

        const { accessToken, refreshToken } =
            await this.authSessionService.issueSession(user, {
                branchId,
                branchRole,
            });

        return {
            user: user.id,
            accessToken,
            refreshToken,
            requiresBranchSelection: requiresBranchSelection || undefined,
        };
    }

    private assertUserApproved(user: { role: string | null; approvalStatus: string }): void {
        if (user.role === 'owner' || user.approvalStatus === 'approved') return;
        if (user.approvalStatus === 'rejected') {
            throw new ForbiddenException({
                code: AUTH_ERROR_CODES.ACCOUNT_REJECTED,
                message: AUTH_ERROR_MESSAGES.ACCOUNT_REJECTED,
            });
        }
        throw new ForbiddenException({
            code: PENDING_APPROVAL_CODE,
            message: PENDING_APPROVAL_MESSAGE,
        });
    }

    async validateKakaoUser(kakaoData: KakaoData): Promise<KakaoUserValidationResult> {
        // First, try to find user by kakaoId
        const user = await this.prisma.user.findFirst({
            where: {
                kakaoId: kakaoData.kakaoId
            },
        });

        if (!user) {
            const trustedEmail = kakaoData.email
                && kakaoData.emailValid
                && kakaoData.emailVerified
                ? kakaoData.email.toLowerCase()
                : undefined;
            return {
                onboardingRequired: true,
                onboardingKind: "kakao_signup",
                pendingSignupData: {
                    kakaoId: kakaoData.kakaoId,
                    email: trustedEmail,
                    emailValid: Boolean(trustedEmail),
                    emailVerified: Boolean(trustedEmail),
                    name: kakaoData.name,
                    profileImage: kakaoData.profileImage,
                },
            };
        }

        return this.createLoginResultForUser(user);
    }

    private isSelectableBranch(branch: { slug?: string | null; isActive?: boolean | null } | null | undefined): boolean {
        if (!branch) {
            return true;
        }

        return branch.isActive === true && isVisibleStaffBranchSlug(branch.slug ?? "");
    }

    async getPublicActiveBranches(): Promise<Array<{ id: string; name: string }>> {
        if (this.publicBranchCache && this.publicBranchCache.expiresAt > Date.now()) {
            return this.publicBranchCache.value;
        }
        const branches = await this.prisma.branch.findMany({
            where: { isActive: true },
            select: { id: true, name: true, slug: true },
            orderBy: { name: "asc" },
        });
        const value = branches
            .filter((branch) => isVisibleStaffBranchSlug(branch.slug))
            .map(({ id, name }) => ({ id, name }));
        this.publicBranchCache = {
            expiresAt: Date.now() + 300_000,
            value,
        };
        return value;
    }

    async selectBranch(
        userid: string,
        branchid: string,
        sessionId?: string,
    ): Promise<{ accessToken: string; refreshToken: string }> {
        const user = await this.prisma.user.findUnique({ where: { id: userid } });
        if (!user) {
            throw new UnauthorizedException("User not found");
        }

        // Owners can access any branch
        if (user.role === 'owner') {
            const org = await this.prisma.branch.findUnique({
                where: { id: branchid },
                select: { id: true, slug: true, isActive: true },
            });
            if (!org || !this.isSelectableBranch(org)) {
                throw new ForbiddenException("Branch not found");
            }
            return this.issueBranchTokens(user, branchid, 'owner', sessionId);
        }

        // Regular users must be linked to the branch.
        // System scope: membership is verified while the branch context is
        // still being established, so no tenant store branchId exists yet.
        const userOrg = await runSystemScope(() => this.prisma.user_branch.findFirst({
            where: { userId: userid, branchId: branchid },
            include: {
                branch: {
                    select: {
                        slug: true,
                        isActive: true,
                    },
                },
            },
        }));
        if (!userOrg || !this.isSelectableBranch(userOrg.branch)) {
            throw new ForbiddenException("User does not belong to this branch");
        }

        return this.issueBranchTokens(user, branchid, userOrg.role ?? 'member', sessionId);
    }

    async switchBranch(
        userid: string,
        _currentbranchid: string,
        newbranchid: string,
        sessionId?: string,
    ): Promise<{ accessToken: string; refreshToken: string }> {
        const user = await this.prisma.user.findUnique({ where: { id: userid } });
        if (!user) {
            throw new UnauthorizedException("User not found");
        }

        // Owners can switch to any branch
        if (user.role === 'owner') {
            const org = await this.prisma.branch.findUnique({
                where: { id: newbranchid },
                select: { id: true, slug: true, isActive: true },
            });
            if (!org || !this.isSelectableBranch(org)) {
                throw new ForbiddenException("Branch not found");
            }
            return this.issueBranchTokens(user, newbranchid, 'owner', sessionId);
        }

        // Regular users must be linked to the branch.
        // System scope: branch switch verifies membership in the TARGET
        // branch, which by definition differs from the store's current one.
        const userOrg = await runSystemScope(() => this.prisma.user_branch.findFirst({
            where: { userId: userid, branchId: newbranchid },
            include: {
                branch: {
                    select: {
                        slug: true,
                        isActive: true,
                    },
                },
            },
        }));
        if (!userOrg || !this.isSelectableBranch(userOrg.branch)) {
            throw new ForbiddenException("User does not belong to target branch");
        }

        return this.issueBranchTokens(user, newbranchid, userOrg.role ?? 'member', sessionId);
    }

    async getUserBranches(userid: string): Promise<Array<{ id: string; name: string; slug: string; role: string }>> {
        // Check if user is owner - owners have access to ALL branches
        const user = await this.prisma.user.findUnique({
            where: { id: userid },
            select: { role: true }
        });

        this.logger.log(`[getUserBranches] User ${userid} has role: ${user?.role}`);

        if (user?.role === 'owner') {
            // Owner gets access to all branches
            const allOrgs = await this.prisma.branch.findMany({
                where: { isActive: true },
                select: {
                    id: true,
                    name: true,
                    slug: true,
                },
                orderBy: { name: 'asc' }
            });

            this.logger.log(`[getUserBranches] Owner access - found ${allOrgs.length} active branches`);

            return allOrgs.filter((org) => isVisibleStaffBranchSlug(org.slug)).map(org => ({
                id: org.id,
                name: org.name,
                slug: org.slug,
                role: 'owner',
            }));
        }

        // Regular users: only get branches they're linked to.
        // Cross-branch by design: lists the user's own memberships across branches.
        const userOrgs = await runSystemScope(() => this.prisma.user_branch.findMany({
            where: { userId: userid },
            include: { branch: true }
        }));

        if (userOrgs.length === 0) {
            return [];
        }

        return userOrgs
            .filter((userOrg) => userOrg.branch.isActive === true && isVisibleStaffBranchSlug(userOrg.branch.slug))
            .map(userOrg => ({
                id: userOrg.branch.id,
                name: userOrg.branch.name,
                slug: userOrg.branch.slug,
                role: userOrg.role ?? 'member',
            }));
    }

    private async pruneAuthFlowStates(): Promise<void> {
        try {
            await this.prisma.auth_flow_state.deleteMany({
                where: {
                    OR: [
                        { expiresAt: { lt: new Date() } },
                        {
                            consumedAt: { not: null },
                            createdAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
                        },
                    ],
                },
            });
        } catch (error) {
            this.logger.warn(`Failed to prune auth flow states: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async createAuthFlowState(params: {
        kind: string;
        token: string;
        expiresAt: Date;
        userId?: string;
        sessionId?: string;
        requiresBranchSelection?: boolean;
        kakaoData?: KakaoData;
    }): Promise<void> {
        await this.prisma.auth_flow_state.create({
            data: {
                kind: params.kind,
                tokenHash: this.hashToken(params.token),
                userId: params.userId,
                sessionId: params.sessionId,
                requiresBranchSelection: params.requiresBranchSelection ?? false,
                kakaoId: params.kakaoData?.kakaoId,
                email: params.kakaoData?.email,
                name: params.kakaoData?.name,
                profileImage: params.kakaoData?.profileImage,
                expiresAt: params.expiresAt,
            },
        });
    }

    private async getAuthFlowStateOrThrow(token: string, allowedKinds: string[]) {
        const state = await this.prisma.auth_flow_state.findUnique({
            where: { tokenHash: this.hashToken(token) },
        });

        if (!state || !allowedKinds.includes(state.kind)) {
            throw new UnauthorizedException("Invalid authorization code");
        }

        if (state.consumedAt) {
            throw new UnauthorizedException("Authorization code already used");
        }

        if (state.expiresAt.getTime() < Date.now()) {
            throw new UnauthorizedException("Authorization code expired");
        }

        return state;
    }

    private async consumeAuthFlowStateOrThrow(token: string, allowedKinds: string[]) {
        const hashedToken = this.hashToken(token);

        return this.prisma.$transaction(async (tx) => {
            const state = await tx.auth_flow_state.findUnique({
                where: { tokenHash: hashedToken },
            });

            if (!state || !allowedKinds.includes(state.kind)) {
                throw new UnauthorizedException("Invalid authorization code");
            }

            if (state.consumedAt) {
                throw new UnauthorizedException("Authorization code already used");
            }

            if (state.expiresAt.getTime() < Date.now()) {
                throw new UnauthorizedException("Authorization code expired");
            }

            const consumeResult = await tx.auth_flow_state.updateMany({
                where: {
                    id: state.id,
                    consumedAt: null,
                },
                data: {
                    consumedAt: new Date(),
                },
            });

            if (consumeResult.count !== 1) {
                throw new UnauthorizedException("Authorization code already used");
            }

            return state;
        });
    }

    private async createPendingKakaoSignupState(kakaoData: KakaoData): Promise<string> {
        const pendingSignupToken = this.generateToken();

        await this.createAuthFlowState({
            kind: "pending_kakao_signup",
            token: pendingSignupToken,
            kakaoData,
            expiresAt: new Date(Date.now() + 30 * 60 * 1000),
        });

        return pendingSignupToken;
    }

    private async createPendingAccountOnboardingState(userId: string): Promise<string> {
        const pendingOnboardingToken = this.generateToken();

        await this.createAuthFlowState({
            kind: "pending_account_onboarding",
            token: pendingOnboardingToken,
            userId,
            expiresAt: new Date(Date.now() + 30 * 60 * 1000),
        });

        return pendingOnboardingToken;
    }

    private async getPendingKakaoSignupOrThrow(token: string) {
        return this.getAuthFlowStateOrThrow(token, ["pending_kakao_signup"]);
    }

    private async getPendingAccountOnboardingOrThrow(token: string) {
        return this.getAuthFlowStateOrThrow(token, ["pending_account_onboarding"]);
    }

    async createAuthCode(tokens: { accessToken: string; refreshToken: string; requiresBranchSelection?: boolean }): Promise<string> {
        await this.pruneAuthFlowStates();

        const decoded = this.jwt.decode<{ sid?: string }>(tokens.accessToken);
        if (!decoded?.sid) {
            throw new UnauthorizedException("Authorization session is invalid");
        }

        const code = this.generateToken();
        await this.createAuthFlowState({
            kind: "auth_code",
            token: code,
            sessionId: decoded.sid,
            requiresBranchSelection: tokens.requiresBranchSelection,
            expiresAt: new Date(Date.now() + 30 * 1000),
        });

        return code;
    }

    async createPendingSignupCode(kakaoData: KakaoData): Promise<string> {
        await this.pruneAuthFlowStates();

        const code = this.generateToken();
        await this.createAuthFlowState({
            kind: "pending_kakao_signup_exchange",
            token: code,
            kakaoData,
            expiresAt: new Date(Date.now() + 30 * 1000),
        });

        return code;
    }

    async createPendingAccountOnboardingCode(userId: string): Promise<string> {
        await this.pruneAuthFlowStates();

        const code = this.generateToken();
        await this.createAuthFlowState({
            kind: "pending_account_onboarding_exchange",
            token: code,
            userId,
            expiresAt: new Date(Date.now() + 30 * 1000),
        });

        return code;
    }

    async startPendingAccountOnboarding(userId: string): Promise<string> {
        await this.pruneAuthFlowStates();
        return this.createPendingAccountOnboardingState(userId);
    }

    async exchangeCodeForTokens(code: string): Promise<TokenExchangeResult> {
        const stored = await this.consumeAuthFlowStateOrThrow(code, [
            "auth_code",
            "pending_kakao_signup_exchange",
            "pending_account_onboarding_exchange",
        ]);

        if (stored.kind === "auth_code") {
            if (!stored.sessionId) {
                throw new UnauthorizedException("Authorization code payload is invalid");
            }

            const tokens = await this.authSessionService.issueTokensForAuthorizationCode(
                stored.sessionId,
            );
            return {
                ...tokens,
                requiresBranchSelection: stored.requiresBranchSelection || undefined,
            };
        }

        if (stored.kind === "pending_account_onboarding_exchange") {
            if (!stored.userId) {
                throw new UnauthorizedException("Pending account onboarding payload is invalid");
            }

            const pendingAccountOnboardingToken = await this.createPendingAccountOnboardingState(stored.userId);

            return {
                onboardingRequired: true,
                onboardingRoute: "/onboarding",
                pendingAccountOnboardingToken,
            };
        }

        if (!stored.kakaoId) {
            throw new UnauthorizedException("Pending Kakao signup payload is invalid");
        }

        const pendingSignupData: KakaoData = {
            kakaoId: stored.kakaoId,
            email: stored.email ?? undefined,
            name: stored.name ?? undefined,
            profileImage: stored.profileImage ?? undefined,
        };
        const pendingSignupToken = await this.createPendingKakaoSignupState(pendingSignupData);

        return {
            onboardingRequired: true,
            onboardingRoute: "/kakao/onboarding",
            pendingSignupToken,
            prefill: {
                email: stored.email ?? undefined,
                name: stored.name ?? undefined,
                profileImage: stored.profileImage ?? undefined,
            },
        };
    }

    async getPendingKakaoSignup(token: string): Promise<PendingKakaoSignupProfile> {
        const stored = await this.getPendingKakaoSignupOrThrow(token);

        return {
            email: stored.email ?? undefined,
            name: stored.name ?? undefined,
            profileImage: stored.profileImage ?? undefined,
        };
    }

    async getPendingAccountOnboarding(token: string): Promise<PendingAccountOnboardingProfile> {
        const stored = await this.getPendingAccountOnboardingOrThrow(token);

        if (!stored.userId) {
            throw new UnauthorizedException("Pending account onboarding payload is invalid");
        }

        const user = await this.prisma.user.findUnique({
            where: { id: stored.userId },
            select: {
                id: true,
                email: true,
                name: true,
                profileImage: true,
                phone: true,
                birthDate: true,
                role: true,
            },
        });

        if (!user) {
            throw new UnauthorizedException("Pending account onboarding user not found");
        }

        // Cross-branch by design: pending-onboarding users have no selected branch yet.
        const userOrgs = this.filterSelectableUserBranches(await runSystemScope(() => this.prisma.user_branch.findMany({
            where: { userId: user.id },
            select: {
                branchId: true,
                role: true,
                branch: {
                    select: {
                        slug: true,
                        isActive: true,
                    },
                },
            },
        })));

        return this.getPendingAccountOnboardingProfile(user, userOrgs) ?? {
            email: user.email ?? undefined,
            name: user.name ?? undefined,
            profileImage: user.profileImage ?? undefined,
            phone: user.phone ?? undefined,
            birthDate: user.birthDate ?? undefined,
            branchId: userOrgs.length === 1 ? userOrgs[0]?.branchId : undefined,
            role: userOrgs.length === 1 ? userOrgs[0]?.role ?? user.role ?? undefined : user.role ?? undefined,
        };
    }

    async completeKakaoOnboarding(
        token: string,
        phone: string,
        birthDate: string,
        role: string,
    ): Promise<RegistrationResult> {
        const hashedToken = this.hashToken(token);

        const onboardingResult = await this.prisma.$transaction(async (tx) => {
            const stored = await tx.auth_flow_state.findUnique({
                where: { tokenHash: hashedToken },
            });

            if (!stored || stored.kind !== 'pending_kakao_signup') {
                throw new UnauthorizedException('Pending Kakao signup not found');
            }

            if (stored.consumedAt) {
                throw new UnauthorizedException('Pending Kakao signup already used');
            }

            if (stored.expiresAt.getTime() < Date.now()) {
                throw new UnauthorizedException('Pending Kakao signup expired');
            }

            if (!stored.kakaoId) {
                throw new UnauthorizedException('Pending Kakao signup payload is invalid');
            }

            const consumeResult = await tx.auth_flow_state.updateMany({
                where: {
                    id: stored.id,
                    consumedAt: null,
                },
                data: {
                    consumedAt: new Date(),
                },
            });

            if (consumeResult.count !== 1) {
                throw new UnauthorizedException('Pending Kakao signup already used');
            }

            const pendingSignupData: KakaoData = {
                kakaoId: stored.kakaoId,
                email: stored.email ?? undefined,
                name: stored.name ?? undefined,
                profileImage: stored.profileImage ?? undefined,
            };

            let existingUser = await tx.user.findFirst({
                where: { kakaoId: pendingSignupData.kakaoId },
            });

            const phoneOwner = await tx.user.findFirst({
                where: { phone },
            });
            if (phoneOwner && phoneOwner.id !== existingUser?.id) {
                throw new BadRequestException('이미 존재하는 사용자 입니다.');
            }

            if (!existingUser) {
                existingUser = await tx.user.create({
                    data: {
                        kakaoId: pendingSignupData.kakaoId,
                        email: pendingSignupData.email?.toLowerCase(),
                        name: pendingSignupData.name,
                        profileImage: pendingSignupData.profileImage,
                        phone,
                        birthDate,
                        role: null,
                        requestedRole: role,
                        approvalStatus: 'pending',
                        authProvider: 'kakao',
                    },
                });
            } else {
                const isApproved = existingUser.role === 'owner' || existingUser.approvalStatus === 'approved';
                existingUser = await tx.user.update({
                    where: { id: existingUser.id },
                    data: {
                        email: existingUser.email ?? pendingSignupData.email?.toLowerCase(),
                        name: existingUser.name ?? pendingSignupData.name,
                        profileImage: existingUser.profileImage ?? pendingSignupData.profileImage,
                        phone,
                        birthDate,
                        requestedRole: role,
                        ...(!isApproved && { approvalStatus: 'pending' }),
                        authProvider: existingUser.passwordHash ? 'both' : 'kakao',
                    },
                });
            }

            return existingUser.id;
        });

        return {
            success: true,
            userId: onboardingResult,
            message: PENDING_APPROVAL_MESSAGE,
        };
    }

    async refreshTokens(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
        return this.authSessionService.rotateRefreshToken(refreshToken);
    }

    async logoutSession(
        userId: string,
        sessionId: string,
        pushEndpoint?: string,
    ): Promise<void> {
        await this.authSessionService.revokeSession(sessionId, userId, "logout", pushEndpoint);
        this.logger.log(JSON.stringify({
            event: "auth_logout",
            result: "success",
            sessionId,
        }));
    }

    async logoutWithCredentials(params: {
        refreshToken?: string;
        accessToken?: string;
        pushEndpoint?: string;
    }): Promise<void> {
        if (params.refreshToken) {
            const revokedByRefreshToken = await this.authSessionService.revokeSessionByRefreshToken(
                params.refreshToken,
                "logout",
                params.pushEndpoint,
            );
            // A stale or malformed refresh cookie must not prevent a valid
            // bearer token from revoking the current session and its endpoint.
            // Do not process both credentials when refresh revocation succeeds:
            // that preserves the existing safety boundary for mismatched tokens.
            if (revokedByRefreshToken) {
                this.logger.log(JSON.stringify({
                    event: "auth_logout",
                    result: "success",
                }));
                return;
            }
        }

        if (params.accessToken) {
            await this.authSessionService.revokeSessionByAccessToken(
                params.accessToken,
                "logout",
                params.pushEndpoint,
            );
        }
        this.logger.log(JSON.stringify({
            event: "auth_logout",
            result: "success",
        }));
    }

    async logoutAllSessions(userId: string): Promise<void> {
        await this.authSessionService.revokeAllUserSessions(userId, "logout_all");
        await this.prisma.user.update({
            where: { id: userId },
            data: { tokenVersion: { increment: 1 } },
        });
        this.logger.log(JSON.stringify({
            event: "auth_logout_all",
            result: "success",
            userId,
        }));
    }

    // ==================== Email Authentication Methods ====================

    /**
     * Validate password strength
     * Requirements: min 8 chars, uppercase, lowercase, number, special char
     */
    validatePasswordStrength(password: string): PasswordValidationResult {
        const errors: string[] = [];

        if (password.length < 8) {
            errors.push('비밀번호는 최소 8자 이상이어야 합니다.');
        }
        if (!/[a-z]/.test(password)) {
            errors.push('비밀번호에 소문자가 포함되어야 합니다.');
        }
        if (!/[A-Z]/.test(password)) {
            errors.push('비밀번호에 대문자가 포함되어야 합니다.');
        }
        if (!/[0-9]/.test(password)) {
            errors.push('비밀번호에 숫자가 포함되어야 합니다.');
        }
        if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
            errors.push('비밀번호에 특수문자가 포함되어야 합니다.');
        }

        return {
            valid: errors.length === 0,
            errors,
        };
    }

    /**
     * Hash a password with bcrypt
     */
    async hashPassword(password: string): Promise<string> {
        return bcrypt.hash(password, this.BCRYPT_SALT_ROUNDS);
    }

    /**
     * Verify a password against a hash
     */
    async verifyPassword(password: string, hash: string): Promise<boolean> {
        return bcrypt.compare(password, hash);
    }

    /**
     * Generate a secure random token
     */
    private generateToken(): string {
        return crypto.randomBytes(32).toString('hex');
    }

    /**
     * Hash a token for storage (using SHA-256)
     */
    private hashToken(token: string): string {
        return crypto.createHash('sha256').update(token).digest('hex');
    }

    /**
     * Register a new user with email/password
     * Always returns success to prevent email enumeration
     */
    async registerWithEmail(
        email: string,
        password: string,
        name: string,
        phone: string,
        birthDate: string,
    ): Promise<RegistrationResult> {
        // Validate password strength
        const passwordValidation = this.validatePasswordStrength(password);
        if (!passwordValidation.valid) {
            throw new BadRequestException({
                message: '비밀번호가 보안 요구사항을 충족하지 않습니다.',
                errors: passwordValidation.errors,
            });
        }

        // Check if email already exists
        const existingUser = await this.prisma.user.findUnique({
            where: { email: email.toLowerCase() },
        });

        if (existingUser) {
            // User already has email account (with or without Kakao)
            // Don't reveal that the email exists - return generic success
            // But still send an email to notify the user
            this.logger.log(`Registration attempt for existing email: ${maskEmail(email)}`);
            return {
                success: true,
                message: '인증 이메일이 발송되었습니다. 이메일을 확인해주세요.',
            };
        }

        const passwordHash = await this.hashPassword(password);

        const verificationToken = this.authEmailTokens.createToken();
        const now = new Date();
        const user = await this.prisma.$transaction(async (tx) => {
            const createdUser = await tx.user.create({
                data: {
                    email: email.toLowerCase(),
                    name: name || null,
                    phone,
                    birthDate,
                    passwordHash,
                    role: null,
                    requestedRole: 'user',
                    approvalStatus: 'pending',
                    authProvider: 'email',
                    emailVerified: false,
                },
            });

            await tx.auth_token.create({
                data: {
                    id: verificationToken.tokenId,
                    userId: createdUser.id,
                    token: verificationToken.tokenHash,
                    type: "email_verification",
                    expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
                },
            });
            await tx.auth_email_outbox.create({
                data: {
                    userId: createdUser.id,
                    authTokenId: verificationToken.tokenId,
                    kind: "email_verification",
                    recipient: createdUser.email!,
                    name: createdUser.name,
                    providerIdempotencyKey: buildAuthEmailProviderIdempotencyKey(
                        verificationToken.tokenId,
                        "email_verification",
                    ),
                },
            });
            return createdUser;
        });

        return {
            success: true,
            message: '인증 이메일이 발송되었습니다. 이메일을 확인해주세요.',
            userId: user.id,
        };
    }

    /**
     * Send a verification email to the user
     */
    async sendVerificationEmail(userId: string, email: string): Promise<void> {
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            select: { name: true },
        });
        const verificationToken = this.authEmailTokens.createToken();
        const now = new Date();
        await this.prisma.$transaction(async (tx) => {
            await tx.auth_token.deleteMany({
                where: { userId, type: "email_verification" },
            });
            await tx.auth_token.create({
                data: {
                    id: verificationToken.tokenId,
                    userId,
                    token: verificationToken.tokenHash,
                    type: "email_verification",
                    expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
                },
            });
            await tx.auth_email_outbox.create({
                data: {
                    userId,
                    authTokenId: verificationToken.tokenId,
                    kind: "email_verification",
                    recipient: email,
                    name: user?.name ?? null,
                    providerIdempotencyKey: buildAuthEmailProviderIdempotencyKey(
                        verificationToken.tokenId,
                        "email_verification",
                    ),
                },
            });
        });
        this.logger.log(`Verification email queued for ${maskEmail(email)}`);
    }

    /**
     * Verify email with token
     */
    async verifyEmail(token: string): Promise<RegistrationResult> {
        const hashedToken = this.hashToken(token);
        const tokenEntity = await this.authTokenRepository.findByToken(hashedToken);

        if (!tokenEntity) {
            throw new BadRequestException('유효하지 않은 인증 토큰입니다.');
        }

        if (tokenEntity.type !== 'email_verification') {
            throw new BadRequestException('유효하지 않은 인증 토큰입니다.');
        }

        if (!tokenEntity.isValid()) {
            throw new BadRequestException(
                tokenEntity.isExpired()
                    ? '인증 토큰이 만료되었습니다. 새 인증 이메일을 요청해주세요.'
                    : '이미 사용된 인증 토큰입니다.'
            );
        }

        await this.prisma.$transaction(async (tx) => {
            const consumed = await this.authTokenRepository.consumeWithinTx(
                tx,
                hashedToken,
                "email_verification",
            );
            if (!consumed) {
                throw new BadRequestException("이미 사용되었거나 만료된 인증 토큰입니다.");
            }
            await tx.user.update({
                where: { id: tokenEntity.userId },
                data: {
                    emailVerified: true,
                    emailVerifiedAt: new Date(),
                },
            });
        });

        this.logger.log(`Email verified for user ${tokenEntity.userId}`);

        return {
            success: true,
            message: '이메일 인증이 완료되었습니다. 이제 로그인할 수 있습니다.',
        };
    }

    /**
     * Validate email and password for login
     * Returns null if validation fails (for security reasons, don't reveal why)
     */
    async validateEmailPassword(
        email: string,
        password: string,
    ): Promise<EmailUserValidationResult | null> {
        const user = await this.prisma.user.findUnique({
            where: { email: email.toLowerCase() },
        });

        // User doesn't exist - return null without revealing why
        if (!user) {
            // Perform a dummy hash comparison to prevent timing attacks
            await bcrypt.compare(password, '$2b$12$invalidhashfortimingatack');
            return null;
        }

        // User has no password (OAuth-only account)
        if (!user.passwordHash) {
            await bcrypt.compare(password, '$2b$12$invalidhashfortimingatack');
            return null;
        }

        // Verify password
        const isPasswordValid = await this.verifyPassword(password, user.passwordHash);
        if (!isPasswordValid) {
            return null;
        }

        // Check if email is verified
        if (!user.emailVerified) {
            throw new ForbiddenException({
                code: 'EMAIL_NOT_VERIFIED',
                message: '이메일 인증이 필요합니다. 이메일을 확인해주세요.',
            });
        }

        this.assertUserApproved(user);

        return this.createLoginResultForUser(user);
    }

    /**
     * Request password reset
     * Always returns success to prevent email enumeration
     */
    async requestPasswordReset(email: string): Promise<RegistrationResult> {
        const user = await this.prisma.user.findUnique({
            where: { email: email.toLowerCase() },
        });

        // Always return success to prevent email enumeration
        if (!user) {
            return {
                success: true,
                message: '비밀번호 재설정 이메일이 발송되었습니다.',
            };
        }

        try {
            const resetToken = this.authEmailTokens.createToken();
            const now = new Date();
            await this.prisma.$transaction(async (tx) => {
                await tx.auth_token.deleteMany({
                    where: { userId: user.id, type: "password_reset" },
                });
                await tx.auth_token.create({
                    data: {
                        id: resetToken.tokenId,
                        userId: user.id,
                        token: resetToken.tokenHash,
                        type: "password_reset",
                        expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
                    },
                });
                await tx.auth_email_outbox.create({
                    data: {
                        userId: user.id,
                        authTokenId: resetToken.tokenId,
                        kind: "password_reset",
                        recipient: user.email!,
                        name: user.name,
                        providerIdempotencyKey: buildAuthEmailProviderIdempotencyKey(
                            resetToken.tokenId,
                            "password_reset",
                        ),
                    },
                });
            });
            this.logger.log(`Password reset email queued for ${maskEmail(email)}`);
        } catch (error) {
            this.logger.error(
                `Failed to send password reset email to ${maskEmail(email)}`,
                error instanceof Error ? error.stack : String(error),
            );
        }

        return {
            success: true,
            message: '비밀번호 재설정 이메일이 발송되었습니다.',
        };
    }

    /**
     * Reset password with token
     */
    async resetPassword(token: string, newPassword: string): Promise<RegistrationResult> {
        // Validate password strength
        const passwordValidation = this.validatePasswordStrength(newPassword);
        if (!passwordValidation.valid) {
            throw new BadRequestException({
                message: '비밀번호가 보안 요구사항을 충족하지 않습니다.',
                errors: passwordValidation.errors,
            });
        }

        const hashedToken = this.hashToken(token);
        const tokenEntity = await this.authTokenRepository.findByToken(hashedToken);

        if (!tokenEntity) {
            throw new BadRequestException({
                code: "AUTH_RESET_TOKEN_INVALID",
                message: "유효하지 않은 재설정 토큰입니다.",
            });
        }

        if (tokenEntity.type !== 'password_reset') {
            throw new BadRequestException({
                code: "AUTH_RESET_TOKEN_INVALID",
                message: "유효하지 않은 재설정 토큰입니다.",
            });
        }

        if (!tokenEntity.isValid()) {
            throw new BadRequestException({
                code: tokenEntity.isExpired()
                    ? "AUTH_RESET_TOKEN_EXPIRED"
                    : "AUTH_RESET_TOKEN_USED",
                message: tokenEntity.isExpired()
                    ? "재설정 토큰이 만료되었습니다. 새 재설정 이메일을 요청해주세요."
                    : "이미 사용된 재설정 토큰입니다.",
            });
        }

        // Hash new password
        const passwordHash = await this.hashPassword(newPassword);

        await this.prisma.$transaction(async (tx) => {
            const consumed = await this.authTokenRepository.consumeWithinTx(
                tx,
                hashedToken,
                'password_reset',
            );
            if (!consumed) {
                throw new BadRequestException({
                    code: "AUTH_RESET_TOKEN_USED",
                    message: "이미 사용되었거나 만료된 재설정 토큰입니다.",
                });
            }

            const user = await tx.user.findUnique({
                where: { id: tokenEntity.userId },
                select: { kakaoId: true },
            });
            const authProvider = user?.kakaoId ? 'both' : 'email';

            await tx.user.update({
                where: { id: tokenEntity.userId },
                data: {
                    passwordHash,
                    authProvider,
                    tokenVersion: { increment: 1 },
                },
            });
            await tx.auth_session.updateMany({
                where: {
                    userId: tokenEntity.userId,
                    revokedAt: null,
                },
                data: {
                    revokedAt: new Date(),
                    revokedReason: "password_reset",
                },
            });
        });

        this.logger.log(`Password reset completed for user ${tokenEntity.userId}`);

        return {
            success: true,
            message: '비밀번호가 성공적으로 변경되었습니다.',
        };
    }

    /**
     * Resend verification email
     * Always returns success to prevent email enumeration
     */
    async resendVerificationEmail(email: string): Promise<RegistrationResult> {
        const user = await this.prisma.user.findUnique({
            where: { email: email.toLowerCase() },
        });

        // Always return success to prevent email enumeration
        if (!user) {
            return {
                success: true,
                message: '인증 이메일이 발송되었습니다.',
            };
        }

        // Already verified
        if (user.emailVerified) {
            return {
                success: true,
                message: '인증 이메일이 발송되었습니다.',
            };
        }

        try {
            await this.sendVerificationEmail(user.id, user.email!);
        } catch (error) {
            this.logger.error(
                `Failed to resend verification email to ${maskEmail(email)}`,
                error instanceof Error ? error.stack : String(error),
            );
        }

        return {
            success: true,
            message: '인증 이메일이 발송되었습니다.',
        };
    }

    /**
     * Link password to an OAuth account
     * This allows users who signed up via OAuth to also login with email/password
     */
    async linkPasswordToOAuthAccount(
        userId: string,
        password: string,
        currentSessionId?: string,
    ): Promise<RegistrationResult> {
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
        });

        if (!user) {
            throw new UnauthorizedException('사용자를 찾을 수 없습니다.');
        }

        if (user.passwordHash) {
            throw new BadRequestException('이미 비밀번호가 설정되어 있습니다.');
        }

        if (!user.email) {
            throw new BadRequestException('이메일 주소가 설정되어 있지 않습니다. 먼저 이메일을 등록해주세요.');
        }

        // Validate password strength
        const passwordValidation = this.validatePasswordStrength(password);
        if (!passwordValidation.valid) {
            throw new BadRequestException({
                message: '비밀번호가 보안 요구사항을 충족하지 않습니다.',
                errors: passwordValidation.errors,
            });
        }

        // Hash password
        const passwordHash = await this.hashPassword(password);

        await this.prisma.$transaction(async (tx) => {
            await tx.user.update({
                where: { id: userId },
                data: {
                    passwordHash,
                    authProvider: 'both',
                    emailVerified: true,
                    emailVerifiedAt: new Date(),
                },
            });
            await tx.auth_session.updateMany({
                where: {
                    userId,
                    revokedAt: null,
                    ...(currentSessionId ? { id: { not: currentSessionId } } : {}),
                },
                data: {
                    revokedAt: new Date(),
                    revokedReason: "password_linked",
                },
            });
        });

        this.logger.log(`Password linked to OAuth account for user ${userId}`);

        return {
            success: true,
            message: '비밀번호가 성공적으로 설정되었습니다. 이제 이메일로도 로그인할 수 있습니다.',
        };
    }

    /**
     * Link Kakao account to an existing email-based account
     * This allows users who signed up via email to also login with Kakao
     */
    async linkKakaoToAccount(
        userId: string,
        kakaoData: KakaoData,
        currentSessionId: string,
        linkingStateToken: string,
    ): Promise<RegistrationResult> {
        const trustedKakaoEmail = kakaoData.email
            && kakaoData.emailValid
            && kakaoData.emailVerified
            ? kakaoData.email.toLowerCase()
            : null;
        let decodedState: {
            userId: string;
            sessionId: string;
            purpose: string;
        };
        try {
            decodedState = await this.jwt.verifyAsync(linkingStateToken);
        } catch {
            throw new UnauthorizedException("카카오 연결 세션이 유효하지 않습니다.");
        }
        if (
            decodedState.purpose !== "link_kakao"
            || decodedState.userId !== userId
            || decodedState.sessionId !== currentSessionId
        ) {
            throw new UnauthorizedException("카카오 연결 세션이 유효하지 않습니다.");
        }

        await this.prisma.$transaction(async (tx) => {
            const now = new Date();
            const activeSession = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
                SELECT "id"
                FROM "auth_session"
                WHERE "id" = CAST(${currentSessionId} AS UUID)
                  AND "user_id" = CAST(${userId} AS UUID)
                  AND "revoked_at" IS NULL
                  AND "expires_at" > NOW()
                FOR UPDATE
            `);
            if (activeSession.length !== 1) {
                throw new UnauthorizedException("카카오 연결 세션이 만료되었습니다.");
            }

            const state = await tx.auth_flow_state.findUnique({
                where: { tokenHash: this.hashToken(linkingStateToken) },
            });
            if (
                !state
                || state.kind !== "kakao_link_state"
                || state.userId !== userId
                || state.sessionId !== currentSessionId
                || state.consumedAt
                || state.expiresAt.getTime() <= now.getTime()
            ) {
                throw new UnauthorizedException("카카오 연결 세션이 유효하지 않습니다.");
            }

            const user = await tx.user.findUnique({
                where: { id: userId },
            });
            if (!user) {
                throw new UnauthorizedException('사용자를 찾을 수 없습니다.');
            }
            if (user.kakaoId) {
                throw new BadRequestException('이미 카카오 계정이 연결되어 있습니다.');
            }
            const existingKakaoUser = await tx.user.findFirst({
                where: { kakaoId: kakaoData.kakaoId },
                select: { id: true },
            });
            if (existingKakaoUser) {
                throw new BadRequestException('이 카카오 계정은 이미 다른 계정에 연결되어 있습니다.');
            }
            if (!user.email || trustedKakaoEmail !== user.email.toLowerCase()) {
                throw new BadRequestException({
                    code: "KAKAO_EMAIL_CONFIRMATION_REQUIRED",
                    message: "기존 계정과 동일한 인증된 카카오 이메일이 필요합니다.",
                });
            }

            const consumed = await tx.auth_flow_state.updateMany({
                where: { id: state.id, consumedAt: null },
                data: { consumedAt: now },
            });
            if (consumed.count !== 1) {
                throw new UnauthorizedException("카카오 연결 세션이 이미 사용되었습니다.");
            }

            const authProvider = user.passwordHash ? 'both' : 'kakao';
            await tx.user.update({
                where: { id: userId },
                data: {
                    kakaoId: kakaoData.kakaoId,
                    authProvider,
                    name: user.name || kakaoData.name,
                    profileImage: user.profileImage || kakaoData.profileImage,
                },
            });
            await tx.auth_session.updateMany({
                where: {
                    userId,
                    revokedAt: null,
                    id: { not: currentSessionId },
                },
                data: {
                    revokedAt: new Date(),
                    revokedReason: "kakao_linked",
                },
            });
        });

        this.logger.log(`Kakao account linked to user ${userId}`);

        return {
            success: true,
            message: '카카오 계정이 성공적으로 연결되었습니다. 이제 카카오로도 로그인할 수 있습니다.',
        };
    }

    /**
     * Create a linking state token for OAuth account linking
     * The state contains the user ID to link after OAuth callback
     */
    async createLinkingState(userId: string, sessionId: string): Promise<string> {
        const state = crypto.randomBytes(32).toString('hex');
        const payload = {
            userId,
            sessionId,
            purpose: 'link_kakao',
            state,
        };

        // Sign the state to prevent tampering
        const signedState = await this.jwt.signAsync(payload, { expiresIn: '10m' });
        await this.createAuthFlowState({
            kind: "kakao_link_state",
            token: signedState,
            userId,
            sessionId,
            expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        });
        return signedState;
    }

    /**
     * Verify and decode a linking state token
     */
    async verifyLinkingState(signedState: string): Promise<{ userId: string; sessionId: string; purpose: string } | null> {
        try {
            const decoded = await this.jwt.verifyAsync<{ userId: string; sessionId: string; purpose: string; state: string }>(signedState);
            if (decoded.purpose !== 'link_kakao' || !decoded.sessionId) {
                return null;
            }
            const now = new Date();
            const stored = await this.prisma.auth_flow_state.findUnique({
                where: { tokenHash: this.hashToken(signedState) },
                select: {
                    id: true,
                    kind: true,
                    userId: true,
                    sessionId: true,
                    expiresAt: true,
                    consumedAt: true,
                },
            });
            if (
                !stored
                || stored.kind !== "kakao_link_state"
                || stored.userId !== decoded.userId
                || stored.sessionId !== decoded.sessionId
                || stored.consumedAt
                || stored.expiresAt.getTime() <= now.getTime()
            ) {
                return null;
            }

            const session = await this.prisma.auth_session.findFirst({
                where: {
                    id: decoded.sessionId,
                    userId: decoded.userId,
                    revokedAt: null,
                    expiresAt: { gt: now },
                },
                select: { id: true },
            });
            if (!session) {
                return null;
            }

            return {
                userId: decoded.userId,
                sessionId: decoded.sessionId,
                purpose: decoded.purpose,
            };
        } catch {
            return null;
        }
    }

    /**
     * Create a Kakao login state token carrying the originating client and a
     * random nonce. The caller stores the nonce in a single-use httpOnly cookie so the callback
     * can bind the round-trip to this browser (login-CSRF protection).
     */
    async createKakaoLoginState(client: KakaoLoginClient): Promise<{ signedState: string; nonce: string }> {
        const nonce = crypto.randomBytes(32).toString('hex');
        const signedState = await this.jwt.signAsync(
            { client, purpose: 'kakao_login', nonce },
            { expiresIn: '10m' },
        );
        return { signedState, nonce };
    }

    /**
     * Verify a Kakao login state token and confirm its nonce matches the browser cookie.
     * Returns the allowlisted originating client, or null if the state is missing/forged/expired or the
     * nonce does not match.
     */
    async verifyKakaoLoginState(
        signedState: string,
        expectedNonce: string | undefined,
    ): Promise<{ client: KakaoLoginClient } | null> {
        if (!expectedNonce) return null;
        try {
            const decoded = await this.jwt.verifyAsync<{ client?: string; purpose: string; nonce?: string }>(signedState);
            if (decoded.purpose !== 'kakao_login') return null;
            if (!decoded.nonce || !this.timingSafeEqualStrings(decoded.nonce, expectedNonce)) return null;
            const client: KakaoLoginClient = decoded.client === 'mobile'
                ? 'mobile'
                : decoded.client === 'legacy'
                    ? 'legacy'
                    : 'desktop';
            return { client };
        } catch {
            return null;
        }
    }

    private timingSafeEqualStrings(a: string, b: string): boolean {
        const bufA = Buffer.from(a);
        const bufB = Buffer.from(b);
        if (bufA.length !== bufB.length) return false;
        return crypto.timingSafeEqual(bufA, bufB);
    }
}
