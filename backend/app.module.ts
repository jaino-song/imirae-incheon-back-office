import { Module } from "@nestjs/common";
import { PrismaService } from "./infrastructure/database/prisma.service";
import { JwtModule } from "@nestjs/jwt";
import { JwtStrategy } from "./infrastructure/auth/jwt.strategy";
import { AuthController } from "interface/controllers/auth.controller";
import { KakaoStrategy } from "infrastructure/auth/kakao.strategy";
import { AuthService } from "application/services/auth.service";
import { ConfigModule } from "@nestjs/config";
import { PassportModule } from "@nestjs/passport";

@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
        }),
        PassportModule,
        JwtModule.register({
            secret: process.env.JWT_SECRET,
            signOptions: { expiresIn: "7d" },
        }),
    ],
    controllers: [AuthController],
    providers: [AuthService, KakaoStrategy, JwtStrategy, PrismaService],
})
export class AppModule {}

