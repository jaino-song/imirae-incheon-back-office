import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { CLIENT_REPOSITORY } from "domain/repositories/client.repository.interface";
import { EFORMSIGN_DOCUMENT_MIRROR_REPOSITORY } from "domain/repositories/eformsign-document-mirror.repository.interface";
import { RECEIPT_LINK_TOKEN_REPOSITORY } from "domain/repositories/receipt-link-token.repository.interface";
import { MESSAGE_TRIGGER_RULE_REPOSITORY } from "domain/repositories/message-trigger-rule.repository.interface";
import { FILE_STORAGE_PORT } from "domain/ports/file-storage.port";
import { DatabaseModule } from "infrastructure/database/database.module";
import { SbClientRepository } from "infrastructure/database/repositories/sb.client.repository";
import { SbEformsignDocumentMirrorRepository } from "infrastructure/database/repositories/sb.eformsign-document-mirror.repository";
import { SbReceiptLinkTokenRepository } from "infrastructure/database/repositories/sb.receipt-link-token.repository";
import { SbMessageTriggerRuleRepository } from "infrastructure/database/repositories/sb.message-trigger-rule.repository";
import { SupabaseStorageAdapter } from "infrastructure/adapters/supabase-storage.adapter";
import { RateLimitGuard } from "infrastructure/auth/rate-limit.guard";
import { PdfPageRasterizerService } from "infrastructure/pdf/pdf-page-rasterizer.service";
import { ReceiptLinkCleanupSchedulerService } from "application/services/receipt-link-cleanup-scheduler.service";
import { ReceiptLinkDeliveryEnricher } from "application/services/receipt-link-delivery-enricher.service";
import { ReceiptLinkIssueService } from "application/services/receipt-link-issue.service";
import { ReceiptLinkTokenService } from "application/services/receipt-link-token.service";
import { ReceiptLinkManualSendService } from "application/services/receipt-link-manual-send.service";
import { ReceiptLinkAdminController } from "interface/controllers/receipt-link-admin.controller";
import { ReceiptLinkController } from "interface/controllers/receipt-link.controller";
import { EformsignDocModule } from "./eformsign-doc.module";
import { MessageModule } from "./message.module";
import { SchedulerLeaseModule } from "./scheduler-lease.module";
import { SystemSettingModule } from "./system-setting.module";

// Leaf module: imports MessageModule (registry, job repo, scheduler), EformsignDocModule
// (mirror service), and SystemSettingModule (MessageSenderApprovalService, for the manual
// send gate). Nothing imports ReceiptLinkModule except AppModule, so there is no cycle even
// though EformsignDocModule itself imports MessageModule.
//
// CLIENT_REPOSITORY, EFORMSIGN_DOCUMENT_MIRROR_REPOSITORY, and MESSAGE_TRIGGER_RULE_REPOSITORY
// are provided internally by EformsignDocModule/MessageModule but NOT exported by either, so
// ReceiptLinkModule rebinds them itself (mirroring the { provide, useClass } pattern in
// message.module.ts) rather than relying on an export that doesn't exist. RateLimitGuard is
// likewise provided directly here (DatabaseModule supplies its PrismaService dependency)
// instead of importing AuthModule.
@Module({
    imports: [DatabaseModule, ConfigModule, MessageModule, EformsignDocModule, SystemSettingModule, SchedulerLeaseModule],
    controllers: [ReceiptLinkAdminController, ReceiptLinkController],
    providers: [
        SupabaseStorageAdapter,
        { provide: FILE_STORAGE_PORT, useClass: SupabaseStorageAdapter },
        { provide: CLIENT_REPOSITORY, useClass: SbClientRepository },
        { provide: EFORMSIGN_DOCUMENT_MIRROR_REPOSITORY, useClass: SbEformsignDocumentMirrorRepository },
        { provide: RECEIPT_LINK_TOKEN_REPOSITORY, useClass: SbReceiptLinkTokenRepository },
        { provide: MESSAGE_TRIGGER_RULE_REPOSITORY, useClass: SbMessageTriggerRuleRepository },
        RateLimitGuard,
        PdfPageRasterizerService,
        ReceiptLinkTokenService,
        ReceiptLinkIssueService,
        ReceiptLinkDeliveryEnricher,
        ReceiptLinkManualSendService,
        ReceiptLinkCleanupSchedulerService,
    ],
    exports: [ReceiptLinkIssueService, ReceiptLinkTokenService],
})
export class ReceiptLinkModule {}
