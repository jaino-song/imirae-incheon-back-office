import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { AIChatController } from "interface/controllers/ai-chat.controller";
import { AdminFeedbackController } from "interface/controllers/admin-feedback.controller";
import { AIChatService } from "application/services/ai-chat.service";
import { GetChatHistoryUsecase } from "application/usecases/ai-chat/get-chat-history.usecase";
import { CleanupChatSessionsUsecase } from "application/usecases/ai-chat/cleanup-chat-sessions.usecase";
import { ToolExecutorService } from "application/ai-chat/tool-executor.service";
import { GeminiChatGateway } from "infrastructure/api/gemini-chat.gateway";
import { VercelGeminiGateway } from "infrastructure/api/vercel-gemini.gateway";
import { createGeminiGateway } from "infrastructure/vendor-stubs/e2e-vendor-stubs";
import { OwnerOrAdminGuard } from "infrastructure/auth/owner-or-admin.guard";
import { DatabaseModule } from "infrastructure/database/database.module";
import { ChatSessionModule } from "./chat-session.module";
import { ClientModule } from "./client.module";
import { EmployeeModule } from "./employee.module";
import { MessageModule } from "./message.module";
import { AreaTemplateModule } from "./area-template.module";
import { EformsignDocModule } from "./eformsign-doc.module";
import { VoucherPriceInfoModule } from "./voucher-price-info.module";
import { BankAccountInfoModule } from "./bank-account-info.module";
import { EmployeeScheduleModule } from "./employee-schedule.module";
import { GEMINI_GATEWAY } from "./ai-chat.tokens";
import { LegacyChatConfirmationService } from "application/ai-chat/legacy-chat-confirmation.service";

// Re-export for backwards compatibility
export { GEMINI_GATEWAY } from "./ai-chat.tokens";

@Module({
    imports: [
        ConfigModule,
        DatabaseModule,
        ChatSessionModule,
        ClientModule,
        EmployeeModule,
        MessageModule,
        AreaTemplateModule,
        EformsignDocModule,
        VoucherPriceInfoModule,
        BankAccountInfoModule,
        EmployeeScheduleModule,
    ],
    controllers: [AIChatController, AdminFeedbackController],
    providers: [
        {
            provide: GEMINI_GATEWAY,
            useFactory: createGeminiGateway,
            inject: [ConfigService],
        },
        // Keep both gateways available for direct injection if needed
        GeminiChatGateway,
        VercelGeminiGateway,
        ToolExecutorService,
        LegacyChatConfirmationService,
        AIChatService,
        GetChatHistoryUsecase,
        CleanupChatSessionsUsecase,
        OwnerOrAdminGuard,
    ],
    exports: [AIChatService, GEMINI_GATEWAY],
})
export class AIChatModule {}
