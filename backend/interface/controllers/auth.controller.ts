import { Controller, Get, Req, UseGuards, Request } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { AuthService, KakaoData } from "../../application/services/auth.service";
import { UserValidationResult } from "../../application/services/auth.service";

@Controller("auth")
export class AuthController {
    constructor(private readonly authService: AuthService) {}

    @Get("kakao")
    @UseGuards(AuthGuard("kakao"))
    async kakaoLogin() {
        // Redirects user to Kakao login page
    }

    @Get("kakao/callback")
    @UseGuards(AuthGuard("kakao"))
    async kakaoCallback(@Req() req: any): Promise<UserValidationResult> {
        return await this.authService.validateKakaoUser(req.user);
    }
}