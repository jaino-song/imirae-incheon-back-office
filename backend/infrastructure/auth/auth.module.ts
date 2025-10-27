import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { AuthService } from "../../application/services/auth.service";
import { AuthController } from "../../interface/controllers/auth.controller";
import { KakaoStrategy } from "./kakao.strategy";
import { PrismaService } from "../database/prisma.service";

@Module({
    imports: [
        PassportModule,
        JwtModule.register({
            secret: process.env.JWT_SECRET || "your-secret-key",
            signOptions: { expiresIn: "7d" },
        }),
    ],
    controllers: [AuthController],
    providers: [AuthService, KakaoStrategy, PrismaService],
})
export class AuthModule {}

