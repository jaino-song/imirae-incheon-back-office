import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { JwtStrategy } from "./infrastructure/auth/jwt.strategy";
import { AuthController } from "interface/controllers/auth.controller";
import { EformsignController } from "interface/controllers/eformsign.controller";
import { KakaoStrategy } from "infrastructure/auth/kakao.strategy";
import { AuthService } from "application/services/auth.service";
import { EformsignService } from "application/services/eformsign.service";
import { ConfigModule } from "@nestjs/config";
import { PassportModule } from "@nestjs/passport";
import { BankAccountInfoModule } from "module/bank-account-info.module";
import { UserModule } from "module/user.module";
import { MessageModule } from "module/message.module";
import { VoucherPriceInfoModule } from "module/voucher-price-info.module";
import { EmployeeModule } from "module/employee.module";
import { PrismaService } from "infrastructure/database/prisma.service";

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
        UserModule,
        BankAccountInfoModule,
        MessageModule,
        VoucherPriceInfoModule,
        EmployeeModule,
    ],
    controllers: [AuthController, EformsignController],
    providers: [AuthService, EformsignService, KakaoStrategy, JwtStrategy, PrismaService],
})
export class AppModule {}

