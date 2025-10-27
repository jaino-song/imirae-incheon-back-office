import { Injectable, UnauthorizedException } from "@nestjs/common";
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

@Injectable()
export class AuthService {
    constructor(private prisma: PrismaService, private jwt: JwtService) {}

    async validateKakaoUser(kakaoData: KakaoData): Promise<UserValidationResult> {
        let user = await this.prisma.user.findFirst({
            where: { 
                profile_image: kakaoData.profileImage
            },
        });

        if (!user) {
            user = await this.prisma.user.create({
                data: {
                    kakaoId: kakaoData.kakaoId,
                    name: kakaoData.name,
                    profile_image: kakaoData.profileImage,
                    role: "user",
                },
            });
        }

        const payload = {
            userId: user.id,
            kakaoId: kakaoData.kakaoId,
            name: user.name,
            profileImage: user.profile_image,
            role: user.role,
        };
        const token = await this.jwt.signAsync(payload);

        return {
            user: user.id,
            token: token,
        };
    }
}