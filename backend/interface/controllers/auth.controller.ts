import { BadRequestException, Body, Controller, ForbiddenException, Get, Headers, Ip, Logger, Post, Query, Req, Request, Res, UseGuards } from "@nestjs/common";
import { Response, Request as ExpressRequest } from "express";
import {
    AuthService,
    type KakaoLoginClient,
    type KakaoUserValidationResult,
} from "../../application/services/auth.service";
import {
    AUTH_ERROR_CODES,
    isAuthErrorCode,
    type AuthErrorCode,
} from "../../application/constants/auth-error.constants";
import { JwtGuard } from "../../infrastructure/auth/jwt.guard";
import { PrismaService } from "../../infrastructure/database/prisma.service";
import { TokenExchangeDto } from "interface/dto/token-exchange.dto";
import { RefreshTokenDto } from "interface/dto/refresh-token.dto";
import { RateLimitGuard } from "../../infrastructure/auth/rate-limit.guard";
import { getAuthTokenMaxAgeMs } from "../../application/services/auth-token-policy";
import {
    RegisterDto,
    LoginDto,
    VerifyEmailDto,
    ForgotPasswordDto,
    ResetPasswordDto,
    ResendVerificationDto,
    LinkPasswordDto,
} from "interface/dto/email-auth.dto";
import { SelectBranchDto, SwitchBranchDto } from "interface/dto/branch-auth.dto";
import { CompleteKakaoOnboardingDto } from "interface/dto/kakao-onboarding.dto";
import { LogoutDto } from "interface/dto/logout.dto";
import { getKakaoOAuthConfig } from "infrastructure/auth/kakao-config";
import {
    KakaoAuthGuard,
    KAKAO_OAUTH_ERROR_REQUEST_KEY,
    type KakaoCallbackRequest,
} from "../../infrastructure/auth/kakao-auth.guard";
import { normalizePhone } from "application/utils/normalize-phone";

@Controller("auth")
export class AuthController {
    private static readonly PENDING_SIGNUP_TOKEN_HEADER = "x-pending-signup-token";
    private static readonly PENDING_ONBOARDING_TOKEN_HEADER = "x-pending-onboarding-token";
    private static readonly OAUTH_NONCE_COOKIE = "kakao_oauth_nonce";
    private static readonly LEGACY_FRONTEND_URL = "https://imirae-incheon-back-office.vercel.app";
    private readonly logger = new Logger(AuthController.name);

    constructor(
        private readonly authService: AuthService,
        private readonly prisma: PrismaService,
        private readonly rateLimitGuard: RateLimitGuard,
    ) {}

    @Get("kakao")
    async kakaoLogin(@Query("client") client: string | undefined, @Res() res: Response) {
        // Initiate Kakao OAuth manually so we can both:
        //  - carry the allowlisted originating client in the OAuth `state`, so the callback
        //    returns mobile and legacy users to their own frontend instead of the desktop domain, and
        //  - bind the round-trip to THIS browser with a single-use nonce cookie, so a forged
        //    callback from another browser is rejected (login-CSRF protection).
        // Both frontends navigate the browser directly to this backend host to start the flow,
        // so the nonce cookie set here is sent back on the callback (same host).
        const target: KakaoLoginClient = client === "mobile"
            ? "mobile"
            : client === "legacy"
                ? "legacy"
                : "desktop";
        const { signedState, nonce } = await this.authService.createKakaoLoginState(target);
        this.setOAuthNonceCookie(res, nonce);

        res.redirect(this.buildKakaoAuthorizeUrl(signedState));
    }

    @Get("kakao/callback")
    @UseGuards(KakaoAuthGuard)
    async kakaoCallback(@Req() req: KakaoCallbackRequest, @Res() res: Response) {
        // `state` is a signed JWT: { client, nonce } for login, or a userId payload for
        // linking. For login, the matching single-use nonce was stored in an httpOnly cookie
        // at initiation; reading + clearing it here and requiring it to match the signed nonce
        // binds this callback to the browser that started the flow (login-CSRF protection).
        const state = req.query["state"] as string | undefined;
        const nonce = req.cookies?.[AuthController.OAUTH_NONCE_COOKIE] as string | undefined;
        this.clearOAuthNonceCookie(res);

        // Account-linking flow: state is a signed JWT bound to a userId (JwtGuard-gated).
        const linkingInfo = state ? await this.authService.verifyLinkingState(state) : null;
        if (linkingInfo) {
            const oauthErrorCode = req[KAKAO_OAUTH_ERROR_REQUEST_KEY];
            if (oauthErrorCode) {
                return this.redirectWithAuthError(
                    res,
                    `${this.resolveFrontendURL("desktop")}/settings`,
                    oauthErrorCode,
                );
            }

            console.log(`[Auth] Linking Kakao account to user ${linkingInfo.userId}`);
            return this.completeKakaoLink(
                linkingInfo.userId,
                linkingInfo.sessionId,
                state!,
                req.user,
                res,
                this.resolveFrontendURL("desktop"),
            );
        }

        // Login/registration flow: state is a signed JWT carrying { client, nonce }.
        const loginState = state ? await this.authService.verifyKakaoLoginState(state, nonce) : null;
        if (!loginState) {
            // Login-CSRF guard: state missing/forged/expired, or its nonce does not match the cookie.
            console.warn("[Auth] Rejected Kakao callback: invalid or unbound OAuth state");
            return this.redirectWithAuthError(
                res,
                `${this.resolveFrontendURL("desktop")}/login`,
                AUTH_ERROR_CODES.INVALID_OAUTH_STATE,
            );
        }

        const frontendURL = this.resolveFrontendURL(loginState.client);
        const oauthErrorCode = req[KAKAO_OAUTH_ERROR_REQUEST_KEY];
        if (oauthErrorCode) {
            return this.redirectWithAuthError(
                res,
                `${frontendURL}/login`,
                oauthErrorCode,
            );
        }

        if (!req.user) {
            return this.redirectWithAuthError(
                res,
                `${frontendURL}/login`,
                AUTH_ERROR_CODES.OAUTH_PROVIDER_ERROR,
            );
        }

        // Normal login/registration flow
        let result: KakaoUserValidationResult;
        try {
            result = await this.authService.validateKakaoUser(req.user);
        } catch (error) {
            const authErrorCode = this.getAuthErrorCode(error);
            if (authErrorCode) {
                return this.redirectWithAuthError(
                    res,
                    `${frontendURL}/login`,
                    authErrorCode,
                );
            }

            throw error;
        }

        const code = ("onboardingRequired" in result && result.onboardingRequired)
            ? result.onboardingKind === "kakao_signup"
                ? await this.authService.createPendingSignupCode(result.pendingSignupData)
                : await this.authService.createPendingAccountOnboardingCode(result.userId)
            : await this.authService.createAuthCode(result as { accessToken: string; refreshToken: string; requiresBranchSelection?: boolean });

        const callbackPath = this.resolveCallbackPath(loginState.client);
        this.logger.log(`[Auth] Redirecting to ${frontendURL}${callbackPath} (NODE_ENV: ${process.env['NODE_ENV']})`);

        res.redirect(`${frontendURL}${callbackPath}?code=${code}`);
    }

    @Get("me")
    @UseGuards(JwtGuard)
    async getCurrentUser(@Request() req: any) {
        const userPromise = this.prisma.user.findUnique({
            where: { id: req.user.userId },
            select: {
                id: true,
                name: true,
                email: true,
                phone: true,
                birthDate: true,
                profileImage: true,
                role: true,
            },
        });
        const branchPromise = req.user.branchId
            ? this.prisma.branch.findUnique({
                where: { id: req.user.branchId },
                select: { name: true, slug: true },
            })
            : Promise.resolve(null);

        const [user, org] = await Promise.all([userPromise, branchPromise]);
        const branchId = req.user.branchId ?? null;
        const branchName = org?.name ?? null;
        const branchSlug = org?.slug ?? null;

        return { ...user, branchId, branchName, branchSlug };
    }

    @Post("token")
    async exchangeToken(@Body() body: TokenExchangeDto) {
        const tokens = await this.authService.exchangeCodeForTokens(body.code);
        return tokens;
    }

    @Get("kakao/pending-signup")
    async getPendingKakaoSignup(
        @Headers(AuthController.PENDING_SIGNUP_TOKEN_HEADER) headerToken?: string,
        @Query("token") queryToken?: string,
    ) {
        const token = headerToken ?? queryToken;
        if (!token) {
            throw new BadRequestException("Pending signup token is required");
        }

        return this.authService.getPendingKakaoSignup(token);
    }

    @Post("kakao/complete-signup")
    @UseGuards(RateLimitGuard)
    async completeKakaoOnboarding(
        @Headers(AuthController.PENDING_SIGNUP_TOKEN_HEADER) headerToken: string | undefined,
        @Query("token") queryToken: string | undefined,
        @Body() body: CompleteKakaoOnboardingDto,
    ) {
        const token = headerToken ?? queryToken;
        if (!token) {
            throw new BadRequestException("Pending signup token is required");
        }

        return this.authService.completeKakaoOnboarding(
            token,
            body.phone,
            body.birthDate,
            body.role,
        );
    }

    @Get("onboarding/pending")
    async getPendingAccountOnboarding(
        @Headers(AuthController.PENDING_ONBOARDING_TOKEN_HEADER) headerToken?: string,
        @Query("token") queryToken?: string,
    ) {
        const token = headerToken ?? queryToken;
        if (!token) {
            throw new BadRequestException("Pending onboarding token is required");
        }

        return this.authService.getPendingAccountOnboarding(token);
    }

    @Post("onboarding/complete")
    @UseGuards(RateLimitGuard)
    completeAccountOnboarding(): never {
        throw new ForbiddenException({
            code: AUTH_ERROR_CODES.ACCOUNT_PROFILE_INCOMPLETE,
            message: "가입 정보와 지점 배정은 오너가 확인해야 합니다.",
        });
    }

    @Post("refresh-token")
    @UseGuards(RateLimitGuard)
    async refreshToken(@Body() body: RefreshTokenDto) {
        const tokens = await this.authService.refreshTokens(body.refreshToken);
        return tokens;
    }

    // ==================== Email Authentication Endpoints ====================

    @Post("register")
    @UseGuards(RateLimitGuard)
    async register(@Body() body: RegisterDto, @Ip() ip: string) {
        const result = await this.authService.registerWithEmail(
            body.email,
            body.password,
            body.name,
            body.phone,
            body.birthDate,
        );

        // Reset rate limit on successful registration
        if (result.success) {
            await this.rateLimitGuard.resetForKey(ip, body.email, "post:register");
        }

        return result;
    }

    @Get("check-email")
    @UseGuards(RateLimitGuard)
    async checkEmail(@Query("email") email?: string) {
        const normalizedEmail = email?.trim().toLowerCase();

        if (!normalizedEmail) {
            return { exists: false };
        }

        const user = await this.prisma.user.findUnique({
            where: { email: normalizedEmail },
            select: { id: true },
        });

        return { exists: Boolean(user) };
    }

    @Get("check-phone")
    @UseGuards(RateLimitGuard)
    async checkPhone(@Query("phone") phone?: string) {
        const normalizedPhone = normalizePhone(phone);

        if (!normalizedPhone || normalizedPhone.length !== 11) {
            return { exists: false };
        }

        const formattedPhone = [
            normalizedPhone.slice(0, 3),
            normalizedPhone.slice(3, 7),
            normalizedPhone.slice(7),
        ].join("-");
        const user = await this.prisma.user.findFirst({
            where: { phone: { in: [normalizedPhone, formattedPhone] } },
            select: { id: true },
        });

        return { exists: Boolean(user) };
    }

    @Post("login")
    @UseGuards(RateLimitGuard)
    async login(@Body() body: LoginDto, @Ip() ip: string) {
        const startedAt = Date.now();
        try {
            const result = await this.authService.validateEmailPassword(
                body.email,
                body.password,
            );

            if (!result) {
                return {
                    success: false,
                    message: '이메일 또는 비밀번호가 올바르지 않습니다.',
                };
            }

            await this.rateLimitGuard.resetForKey(ip, body.email, "post:login");

            if ("onboardingRequired" in result && result.onboardingRequired) {
                const pendingAccountOnboardingToken = await this.authService.startPendingAccountOnboarding(result.userId);

                return {
                    success: true,
                    onboardingRequired: true,
                    onboardingRoute: "/onboarding",
                    pendingAccountOnboardingToken,
                };
            }

            return {
                success: true,
                ...result,
            };
        } finally {
            this.logger.log(JSON.stringify({
                event: "auth_login_duration_ms",
                durationMs: Date.now() - startedAt,
            }));
        }
    }

    @Post("verify-email")
    async verifyEmail(@Body() body: VerifyEmailDto) {
        return this.authService.verifyEmail(body.token);
    }

    @Post("forgot-password")
    @UseGuards(RateLimitGuard)
    async forgotPassword(@Body() body: ForgotPasswordDto) {
        return this.authService.requestPasswordReset(body.email);
    }

    @Post("reset-password")
    @UseGuards(RateLimitGuard)
    async resetPassword(@Body() body: ResetPasswordDto) {
        return this.authService.resetPassword(body.token, body.newPassword);
    }

    @Post("resend-verification")
    @UseGuards(RateLimitGuard)
    async resendVerification(@Body() body: ResendVerificationDto) {
        return this.authService.resendVerificationEmail(body.email);
    }

    @Post("link-password")
    @UseGuards(JwtGuard)
    async linkPassword(@Body() body: LinkPasswordDto, @Request() req: any) {
        return this.authService.linkPasswordToOAuthAccount(
            req.user.userId,
            body.password,
            req.user.sessionId,
        );
    }

    /**
     * Initiate Kakao account linking for logged-in email users
     * Redirects to Kakao OAuth with a signed state containing user ID
     */
    @Get("kakao/link")
    @UseGuards(JwtGuard)
    async initiateKakaoLink(@Request() req: any, @Res() res: Response) {
        const state = await this.authService.createLinkingState(
            req.user.userId,
            req.user.sessionId,
        );
        res.redirect(this.buildKakaoAuthorizeUrl(state));
    }

    /**
     * Complete Kakao account linking after OAuth callback
     * Called internally from kakaoCallback when linking state is detected
     */
    private async completeKakaoLink(
        userId: string,
        sessionId: string,
        linkingStateToken: string,
        kakaoData: any,
        res: Response,
        frontendURL: string,
    ) {
        try {
            await this.authService.linkKakaoToAccount(
                userId,
                kakaoData,
                sessionId,
                linkingStateToken,
            );

            // Redirect to frontend with success
            res.redirect(`${frontendURL}/settings?kakaoLinked=true`);
        } catch (error: any) {
            this.logger.warn(`Kakao account linking failed: ${error instanceof Error ? error.message : "unknown error"}`);
            this.redirectWithAuthError(
                res,
                `${frontendURL}/settings`,
                AUTH_ERROR_CODES.OAUTH_PROVIDER_ERROR,
            );
        }
    }

    // ==================== Branch Selection Endpoints ====================

    @Get("branches")
    @UseGuards(JwtGuard)
    async getUserBranches(@Request() req: any) {
        const branches = await this.authService.getUserBranches(req.user.userId);
        return { branches };
    }

    @Get("branches/all")
    @UseGuards(RateLimitGuard)
    async getAllActiveBranches() {
        return this.authService.getPublicActiveBranches();
    }

    @Post("select-branch")
    @UseGuards(JwtGuard)
    async selectBranch(
        @Body() body: SelectBranchDto,
        @Request() req: any,
        @Res({ passthrough: true }) res: Response
    ) {
        const tokens = await this.authService.selectBranch(
            req.user.userId,
            body.branchId,
            req.user.sessionId,
        );

        this.setAuthCookies(res, tokens);

        return { success: true, ...tokens };
    }

    @Post("switch-branch")
    @UseGuards(JwtGuard)
    async switchBranch(
        @Body() body: SwitchBranchDto,
        @Request() req: any,
        @Res({ passthrough: true }) res: Response
    ) {
        const tokens = await this.authService.switchBranch(
            req.user.userId,
            body.currentBranchId,
            body.newBranchId,
            req.user.sessionId,
        );

        this.setAuthCookies(res, tokens);

        return { success: true, ...tokens };
    }

    @Post("logout")
    async logout(
        @Body() body: LogoutDto,
        @Req() req: ExpressRequest,
        @Res({ passthrough: true }) res: Response,
    ) {
        const authorization = req.headers.authorization;
        const accessToken = authorization?.startsWith("Bearer ")
            ? authorization.slice("Bearer ".length)
            : undefined;
        await this.authService.logoutWithCredentials({
            refreshToken: body.refreshToken || req.cookies?.["refresh_token"],
            accessToken,
        });
        // Clear auth cookies
        res.clearCookie('auth_token', { path: '/' });
        res.clearCookie('refresh_token', { path: '/' });
        res.clearCookie('selected_branch_id', { path: '/' });
        res.clearCookie('auto_login', { path: '/' });

        return { success: true, message: 'Logged out successfully' };
    }

    @Post("logout-all")
    @UseGuards(JwtGuard)
    async logoutAll(
        @Request() req: any,
        @Res({ passthrough: true }) res: Response,
    ) {
        await this.authService.logoutAllSessions(req.user.userId);
        res.clearCookie('auth_token', { path: '/' });
        res.clearCookie('refresh_token', { path: '/' });
        res.clearCookie('selected_branch_id', { path: '/' });
        res.clearCookie('auto_login', { path: '/' });
        return { success: true, message: 'Logged out from all sessions' };
    }

    // ==================== Private Helper Methods ====================

    private getAuthErrorCode(error: unknown): AuthErrorCode | null {
        if (!(error instanceof ForbiddenException)) return null;

        const response = error.getResponse();
        const code = typeof response === "object"
            && response !== null
            && "code" in response
            ? response.code
            : undefined;

        return isAuthErrorCode(code) ? code : null;
    }

    private redirectWithAuthError(res: Response, pathname: string, code: AuthErrorCode) {
        const query = new URLSearchParams({ authError: code });
        return res.redirect(`${pathname}?${query.toString()}`);
    }

    private getRoleFromToken(token: string): string | null {
        const [, payload] = token.split(".");
        if (!payload) return null;

        try {
            const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { role?: unknown };
            return typeof decoded.role === "string" ? decoded.role : null;
        } catch {
            return null;
        }
    }

    private resolveFrontendURL(client: KakaoLoginClient): string {
        const nodeEnv = process.env['NODE_ENV'];
        const fallback = "http://localhost:3000";

        if (client === "legacy" && nodeEnv === "production") {
            return AuthController.LEGACY_FRONTEND_URL;
        }

        const desktopURL =
            nodeEnv === "production" ? process.env['PRODUCTION_FRONTEND_URL']
            : nodeEnv === "preview" ? process.env['PREVIEW_FRONTEND_URL']
            : process.env['DEVELOPMENT_FRONTEND_URL'];

        if (client !== "mobile") {
            return desktopURL ?? fallback;
        }

        const mobileURL =
            nodeEnv === "production" ? process.env['PRODUCTION_MOBILE_FRONTEND_URL']
            : nodeEnv === "preview" ? process.env['PREVIEW_MOBILE_FRONTEND_URL']
            : process.env['DEVELOPMENT_MOBILE_FRONTEND_URL'];

        // Fall back to the desktop URL until the mobile URL env var is configured, so a
        // missing var degrades gracefully (current behavior) instead of breaking login.
        return mobileURL ?? desktopURL ?? fallback;
    }

    private resolveCallbackPath(client: KakaoLoginClient): "/callback" | "/auth/callback" {
        return client === "legacy" ? "/auth/callback" : "/callback";
    }

    private buildKakaoAuthorizeUrl(state: string): string {
        const kakaoOAuthConfig = getKakaoOAuthConfig();
        const kakaoAuthUrl = new URL("https://kauth.kakao.com/oauth/authorize");
        kakaoAuthUrl.searchParams.set("client_id", kakaoOAuthConfig.clientID);
        kakaoAuthUrl.searchParams.set("redirect_uri", kakaoOAuthConfig.callbackURL);
        kakaoAuthUrl.searchParams.set("response_type", "code");
        kakaoAuthUrl.searchParams.set("state", state);
        return kakaoAuthUrl.toString();
    }

    private setOAuthNonceCookie(res: Response, nonce: string) {
        res.cookie(AuthController.OAUTH_NONCE_COOKIE, nonce, {
            httpOnly: true,
            secure: process.env['NODE_ENV'] === 'production',
            sameSite: 'lax',
            path: '/',
            maxAge: 10 * 60 * 1000, // 10 minutes; matches the signed-state TTL
        });
    }

    private clearOAuthNonceCookie(res: Response) {
        res.clearCookie(AuthController.OAUTH_NONCE_COOKIE, { path: '/' });
    }

    private setAuthCookies(res: Response, tokens: { accessToken: string; refreshToken: string }) {
        const isProduction = process.env['NODE_ENV'] === 'production';
        const role = this.getRoleFromToken(tokens.accessToken);
        const refreshMaxAge = getAuthTokenMaxAgeMs(role);

        res.cookie('auth_token', tokens.accessToken, {
            httpOnly: true,
            secure: isProduction,
            sameSite: 'lax',
            path: '/',
            maxAge: 15 * 60 * 1000,
        });

        res.cookie('refresh_token', tokens.refreshToken, {
            httpOnly: true,
            secure: isProduction,
            sameSite: 'lax',
            path: '/',
            maxAge: refreshMaxAge,
        });
    }
}
