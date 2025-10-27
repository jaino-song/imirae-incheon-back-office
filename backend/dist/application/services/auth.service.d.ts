import { PrismaService } from "../../infrastructure/database/prisma.service";
import { JwtService } from "@nestjs/jwt";
export interface KakaoData {
    kakaoId: string;
    name?: string;
    email?: string;
    profileImage?: string;
}
export interface TokenPayload {
    userId: string;
    email: string;
    role: string;
}
export interface UserValidationResult {
    user: string;
    token: string;
}
export declare class AuthService {
    private prisma;
    private jwt;
    constructor(prisma: PrismaService, jwt: JwtService);
    validateKakaoUser(kakaoData: KakaoData): Promise<UserValidationResult>;
}
