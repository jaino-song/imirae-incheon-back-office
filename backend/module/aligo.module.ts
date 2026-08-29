import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ALIGO_SMS_API_PORT } from "domain/ports/aligo-sms-api.port";
import { AligoApiClient } from "infrastructure/api/aligo-api.client";
import { SendAligoSmsUsecase } from "application/usecases/aligo";
import { AligoService } from "application/services/aligo.service";
import { MESSAGE_LOG_REPOSITORY } from "domain/repositories/message-log.repository.interface";
import { SbMessageLogRepository } from "infrastructure/database/repositories/sb.message-log.repository";
import { DatabaseModule } from "infrastructure/database/database.module";
import { createAligoPortClient } from "infrastructure/vendor-stubs/e2e-vendor-stubs";
import { SmsProviderAcceptanceService } from "application/services/sms-provider-acceptance.service";

@Module({
    imports: [DatabaseModule],
    providers: [
        {
            provide: AligoApiClient,
            inject: [ConfigService],
            useFactory: createAligoPortClient,
        },
        { provide: ALIGO_SMS_API_PORT, useExisting: AligoApiClient },
        { provide: MESSAGE_LOG_REPOSITORY, useClass: SbMessageLogRepository },
        SmsProviderAcceptanceService,
        SendAligoSmsUsecase,
        AligoService,
    ],
    exports: [
        AligoService,
        SendAligoSmsUsecase,
        MESSAGE_LOG_REPOSITORY,
        ALIGO_SMS_API_PORT,
        SmsProviderAcceptanceService,
    ],
})
export class AligoModule {}
