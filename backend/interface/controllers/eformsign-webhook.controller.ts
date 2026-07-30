import { Body, Controller, Post, HttpCode, HttpStatus, Logger, ServiceUnavailableException, UseGuards } from "@nestjs/common";
import { EformsignWebhookService } from "application/services/eformsign-webhook.service";
import { EformsignWebhookPayloadDto } from "interface/dto/eformsign-webhook.dto";
import { WebhookGuard } from "infrastructure/auth/webhook.guard";
import { captureServiceRecordError } from "infrastructure/observability/service-record-sentry";
import { EformsignDocumentMirrorService } from "application/services/eformsign-document-mirror.service";
import { isEformsignDocumentAbsentError } from "infrastructure/api/eformsign-api.error";
import { normalizeEformsignStatusCode } from "domain/utils/eformsign-status-code";

const COMPLETED_EFORMSIGN_STATUS_TYPES = new Set([
    "003", "012", "022", "032", "050", "062", "072", "092",
]);

/**
 * Controller for handling eformsign webhook callbacks
 * This endpoint is called by eformsign when document status changes
 * Protected by bearer token authentication configured in eformsign console
 *
 * NOTE: this payload is exempt from the global forbidNonWhitelisted rule via
 * GlobalValidationPipe (eformsign sends undeclared fields like document.comment
 * and document.recipients[]). The exemption keys on EformsignWebhookPayloadDto.
 */
@Controller("webhooks/eformsign")
@UseGuards(WebhookGuard)
export class EformsignWebhookController {
    private readonly logger = new Logger(EformsignWebhookController.name);

    constructor(
        private readonly webhookService: EformsignWebhookService,
        private readonly documentMirrorService: EformsignDocumentMirrorService,
    ) {}

    @Post()
    @HttpCode(HttpStatus.OK)
    async handleWebhook(@Body() payload: EformsignWebhookPayloadDto) {
        const documentId =
            payload.document?.id
            || payload.ready_document_pdf?.document_id
            || payload.document_action?.document_id
            || "unknown";
        this.logger.log(`Received eformsign webhook: ${payload.event_type} for document ${documentId}`);

        try {
            if (documentId !== "unknown") {
                if (isCompletionWebhook(payload)) {
                    // Mirror detail and files first, but leave the branch-owned status
                    // projection for the webhook CAS. A failed sync therefore cannot
                    // consume the completion claim, and a replay cannot republish it.
                    const mirrorSync =
                        await this.syncWebhookDocument(documentId, payload, {
                            requireCompletionReady: true,
                        });
                    if (!mirrorSync.ready) {
                        return { success: true };
                    }
                    const mirroredDocument =
                        await this.documentMirrorService.getStoredDetail(documentId);
                    if (
                        !mirroredDocument
                        || !this.isWebhookCurrentEnough(payload, mirroredDocument.updated_date)
                    ) {
                        return { success: true };
                    }
                    const result = await this.webhookService.processWebhook(payload, {
                        mirroredDocument,
                        deferCompletionEvent: true,
                        deferCompletionEffects: true,
                    });
                    if (
                        result?.completionBranchId
                        && (result.completionClaim === "claimed"
                            || result.duplicateServiceRecordLifecycleChanged === true
                            || mirrorSync.ownershipChanged)
                    ) {
                        await this.webhookService.publishCompletionEvent(payload, {
                            branchId: result.completionBranchId,
                            mirroredDocument,
                        });
                    }
                } else {
                    const mirrorAvailable = await this.syncWebhookDocument(documentId, payload);
                    if (!mirrorAvailable.ready) {
                        return { success: true };
                    }
                    const mirroredDocument =
                        await this.documentMirrorService.getStoredDetail(documentId);
                    if (!mirroredDocument) {
                        this.logger.warn(
                            `Skipping webhook ${payload.webhook_id}; local mirror is unavailable for ${documentId}`,
                        );
                        return { success: true };
                    }
                    if (!this.isWebhookCurrentEnough(payload, mirroredDocument.updated_date)) {
                        return { success: true };
                    }
                    await this.webhookService.processWebhook(payload, {
                        mirroredDocument,
                    });
                }
            } else {
                await this.webhookService.processWebhook(payload);
            }
            return { success: true };
        } catch (error) {
            captureServiceRecordError(error, {
                operation: "webhook",
                handled: true,
                statusCode: HttpStatus.SERVICE_UNAVAILABLE,
            });
            const errorType = error instanceof Error
                ? error.name
                : "UnknownError";
            this.logger.error(
                `Webhook processing failed for document ${documentId} (${errorType})`,
            );
            throw new ServiceUnavailableException({
                success: false,
                error: "Webhook processing failed",
                webhookId: payload.webhook_id,
                documentId,
            });
        }
    }

    private async syncWebhookDocument(
        documentId: string,
        payload: EformsignWebhookPayloadDto,
        options: { requireCompletionReady?: boolean } = {},
    ): Promise<{ ready: boolean; ownershipChanged: boolean }> {
        try {
            const syncResult = await this.documentMirrorService.syncDocument(documentId, {
                force: true,
                skipBranchOwnedProjection: true,
                ...(options.requireCompletionReady
                    ? {}
                    : { skipHealthySameVersionFileRepair: true }),
                ...(options.requireCompletionReady
                    ? { strictCompletionReconciliation: true }
                    : {}),
            });
            if (options.requireCompletionReady) {
                const mirroredDocument =
                    await this.documentMirrorService.getStoredDetail(documentId);
                const mirroredStatusType = normalizeEformsignStatusCode(
                    mirroredDocument?.current_status?.status_type,
                );
                if (!COMPLETED_EFORMSIGN_STATUS_TYPES.has(mirroredStatusType)) {
                    this.logger.log(
                        `Ignoring stale completion webhook; mirror ${documentId} is ${mirroredStatusType}`,
                    );
                    return { ready: false, ownershipChanged: false };
                }
                if (!(await this.documentMirrorService.isDocumentReady(documentId))) {
                    throw new Error(
                        `Eformsign mirror is not ready after sync for ${documentId}`,
                    );
                }
            }
            return {
                ready: true,
                ownershipChanged: syncResult?.ownershipChanged === true,
            };
        } catch (error) {
            // A deleted vendor document cannot be fetched again. The webhook
            // status update is the last authoritative state and must not be
            // retried forever for a resource that intentionally disappeared.
            if (!isEformsignDocumentAbsentError(error)) {
                throw error;
            }
            await this.documentMirrorService.markDocumentsDeleted(
                [documentId],
                webhookUpdatedAt(payload),
            );
            await this.webhookService.publishLocalDocumentChange(documentId);
            this.logger.warn(
                `Stored deletion tombstone for eformsign document ${documentId}`,
            );
            return { ready: false, ownershipChanged: false };
        }
    }

    private isWebhookCurrentEnough(
        payload: EformsignWebhookPayloadDto,
        mirrorUpdatedDate: unknown,
    ): boolean {
        const webhookTimestamp = payload.document?.updated_date;
        if (
            typeof webhookTimestamp !== "number"
            || !Number.isFinite(webhookTimestamp)
            || typeof mirrorUpdatedDate !== "number"
            || !Number.isFinite(mirrorUpdatedDate)
        ) {
            return true;
        }
        if (webhookTimestamp > mirrorUpdatedDate) {
            throw new Error(
                `Eformsign mirror is older than webhook ${payload.webhook_id}`,
            );
        }
        if (webhookTimestamp < mirrorUpdatedDate) {
            this.logger.log(
                `Ignoring stale webhook ${payload.webhook_id}; mirror is newer`,
            );
            return false;
        }
        return true;
    }
}

function isCompletionWebhook(payload: EformsignWebhookPayloadDto): boolean {
    return payload.document?.status === "doc_complete"
        || payload.ready_document_pdf?.document_status === "doc_complete";
}

function webhookUpdatedAt(payload: EformsignWebhookPayloadDto): Date {
    const timestamp = payload.document?.updated_date;
    if (typeof timestamp === "number" && Number.isFinite(timestamp)) {
        const date = new Date(timestamp);
        if (!Number.isNaN(date.getTime())) {
            return date;
        }
    }
    return new Date();
}
