import { Module } from "@nestjs/common";
import { SentryModule } from "@sentry/nestjs/setup";
import { resolve } from "node:path";
import { JwtModule } from "@nestjs/jwt";
import { JwtStrategy } from "./infrastructure/auth/jwt.strategy";
import { EformsignController } from "interface/controllers/eformsign.controller";
import { EformsignService } from "application/services/eformsign.service";
import { ConfigModule } from "@nestjs/config";
import { PassportModule } from "@nestjs/passport";
import { ScheduleModule } from "@nestjs/schedule";
import { AuthModule } from "infrastructure/auth/auth.module";
import { BankAccountInfoModule } from "module/bank-account-info.module";
import { UserModule } from "module/user.module";
import { MessageModule } from "module/message.module";
import { MessageTemplateModule } from "module/message-template.module";
import { VoucherPriceInfoModule } from "module/voucher-price-info.module";
import { OutOfPocketPriceInfoModule } from "module/out-of-pocket-price-info.module";
import { EmployeeModule } from "module/employee.module";
import { ClientModule } from "module/client.module";
import { EmployeeScheduleModule } from "module/employee-schedule.module";
import { EformsignDocModule } from "module/eformsign-doc.module";
import { EformsignWebhookModule } from "module/eformsign-webhook.module";
import { AreaTemplateModule } from "module/area-template.module";
import { DocumentModule } from "module/document.module";
import { DatabaseModule } from "infrastructure/database/database.module";
import { TenantModule } from "./infrastructure/tenant/tenant.module";
import { NotificationModule } from "module/notification.module";
import { AIChatModule } from "module/ai-chat.module";
import { MessageDeliveryModule } from "module/message-delivery.module";
import { CallInboxModule } from "module/call-inbox.module";
import { ConsultationInquiryModule } from "module/consultation-inquiry.module";
import { SystemAdminModule } from "module/system-admin.module";
import { ServiceRecordEntryModule } from "module/service-record-entry.module";
import { getJwtSecret } from "./infrastructure/auth/jwt-secret";
import { ContractClientAssignmentGuardService } from "application/services/contract-client-assignment-guard.service";

const ENV_FILE_PATHS = [
    resolve(process.cwd(), "backend/.env.local"),
    resolve(process.cwd(), "backend/.env"),
    resolve(process.cwd(), ".env.local"),
    resolve(process.cwd(), ".env"),
    resolve(__dirname, ".env.local"),
    resolve(__dirname, ".env"),
    resolve(__dirname, "..", ".env.local"),
    resolve(__dirname, "..", ".env"),
];

@Module({
    imports: [
        SentryModule.forRoot(),
        ConfigModule.forRoot({
            isGlobal: true,
            envFilePath: ENV_FILE_PATHS,
        }),
        DatabaseModule,
        ScheduleModule.forRoot(),
        PassportModule,
        JwtModule.register({
            secret: getJwtSecret(),
            signOptions: { expiresIn: "7d" },
        }),
        AuthModule,
        UserModule,
        BankAccountInfoModule,
        MessageModule,
        MessageTemplateModule,
        VoucherPriceInfoModule,
        OutOfPocketPriceInfoModule,
        EmployeeModule,
        ClientModule,
        EmployeeScheduleModule,
        EformsignDocModule,
        EformsignWebhookModule,
        AreaTemplateModule,
        DocumentModule,
        TenantModule,
        NotificationModule,
        AIChatModule,
        MessageDeliveryModule,
        CallInboxModule,
        ConsultationInquiryModule,
        SystemAdminModule,
        ServiceRecordEntryModule,
    ],
    controllers: [EformsignController],
    providers: [
        EformsignService,
        JwtStrategy,
        ContractClientAssignmentGuardService,
    ],
})
export class AppModule {}
