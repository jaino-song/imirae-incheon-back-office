import { Module } from "@nestjs/common";
import { PrismaService } from "./infrastructure/database/prisma.service";
import { JwtModule } from "@nestjs/jwt";
import { JwtStrategy } from "./infrastructure/auth/jwt.strategy";
import { AuthController } from "interface/controllers/auth.controller";
import { EformsignController } from "interface/controllers/eformsign.controller";
import { KakaoStrategy } from "infrastructure/auth/kakao.strategy";
import { AuthService } from "application/services/auth.service";
import { EformsignService } from "application/services/eformsign.service";
import { ConfigModule } from "@nestjs/config";
import { PassportModule } from "@nestjs/passport";
import { SbUserRepository } from "infrastructure/database/repositories/sb.user.repository";
import { MESSAGE_REPOSITORY } from "domain/repositories/message.repository.interface";
import { USER_REPOSITORY } from "domain/repositories/user.repository.interface";
import { BANK_ACCOUNT_INFO_REPOSITORY } from "domain/repositories/bank-account-info.repository.interface";
import { VOUCHER_PRICE_INFO_REPOSITORY } from "domain/repositories/voucher-price-info.repository.interface";
import { SbBankAccountInfoRepository } from "infrastructure/database/repositories/sb.bank-account-info.repository";
import { SbMessageRepository } from "infrastructure/database/repositories/sb.message.repository";
import { SbVoucherPriceInfoRepository } from "infrastructure/database/repositories/sb.voucher-price-info.repository";

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
    controllers: [AuthController, EformsignController],
    providers: [AuthService, EformsignService, KakaoStrategy, JwtStrategy, PrismaService,
        {
            provide: USER_REPOSITORY,
            useClass: SbUserRepository,
        },
        {
            provide: MESSAGE_REPOSITORY,
            useClass: SbMessageRepository,
        },
        {
            provide: BANK_ACCOUNT_INFO_REPOSITORY,
            useClass: SbBankAccountInfoRepository,
        },
        {
            provide: VOUCHER_PRICE_INFO_REPOSITORY,
            useClass: SbVoucherPriceInfoRepository,
        },
    ],
})
export class AppModule {}

