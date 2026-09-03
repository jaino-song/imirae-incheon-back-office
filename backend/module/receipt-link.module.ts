import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { CLIENT_REPOSITORY } from "domain/repositories/client.repository.interface";
import { EFORMSIGN_DOCUMENT_MIRROR_REPOSITORY } from "domain/repositories/eformsign-document-mirror.repository.interface";
import { RECEIPT_LINK_TOKEN_REPOSITORY } from "domain/repositories/receipt-link-token.repository.interface";
import { FILE_STORAGE_PORT } from "domain/ports/file-storage.port";
import { DatabaseModule } from "infrastructure/database/database.module";
import { SbClientRepository } from "infrastructure/database/repositories/sb.client.repository";
import { SbEformsignDocumentMirrorRepository } from "infrastructure/database/repositories/sb.eformsign-document-mirror.repository";
import { SbReceiptLinkTokenRepository } from "infrastructure/database/repositories/sb.receipt-link-token.repository";
import { SupabaseStorageAdapter } from "infrastructure/adapters/supabase-storage.adapter";
import { RateLimitGuard } from "infrastructure/auth/rate-limit.guard";
import { PdfPageRasterizerService } from "infrastructure/pdf/pdf-page-rasterizer.service";
import { ReceiptLinkDeliveryEnricher } from "application/services/receipt-link-delivery-enricher.service";
import { ReceiptLinkIssueService } from "application/services/receipt-link-issue.service";
import { ReceiptLinkTokenService } from "application/services/receipt-link-token.service";
import { ReceiptLinkController } from "interface/controllers/receipt-link.controller";
import { EformsignDocModule } from "./eformsign-doc.module";
import { MessageModule } from "./message.module";

// Leaf module: imports MessageModule (registry, job repo, scheduler) and EformsignDocModule
// (mirror service). Nothing imports ReceiptLinkModule except AppModule, so there is no cycle
// even though EformsignDocModule itself imports MessageModule.
//
// CLIENT_REPOSITORY and EFORMSIGN_DOCUMENT_MIRROR_REPOSITORY are provided internally by
// EformsignDocModule/MessageModule but NOT exported by either, so ReceiptLinkModule rebinds
// them itself (mirroring the { provide, useClass } pattern in message.module.ts) rather than
// relying on an export that doesn't exist. RateLimitGuard is likewise provided directly here
// (DatabaseModule supplies its PrismaService dependency) instead of importing AuthModule.
@Module({
    imports: [DatabaseModule, ConfigModule, MessageModule, EformsignDocModule],
    controllers: [ReceiptLinkController],
    providers: [
        SupabaseStorageAdapter,
        { provide: FILE_STORAGE_PORT, useClass: SupabaseStorageAdapter },
        { provide: CLIENT_REPOSITORY, useClass: SbClientRepository },
        { provide: EFORMSIGN_DOCUMENT_MIRROR_REPOSITORY, useClass: SbEformsignDocumentMirrorRepository },
        { provide: RECEIPT_LINK_TOKEN_REPOSITORY, useClass: SbReceiptLinkTokenRepository },
        RateLimitGuard,
        PdfPageRasterizerService,
        ReceiptLinkTokenService,
        ReceiptLinkIssueService,
        ReceiptLinkDeliveryEnricher,
    ],
    exports: [ReceiptLinkIssueService, ReceiptLinkTokenService],
})
export class ReceiptLinkModule {}
