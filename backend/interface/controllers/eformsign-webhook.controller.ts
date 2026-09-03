import { Body, Controller, Post, HttpCode, HttpStatus, Logger, ServiceUnavailableException, UseGuards } from "@nestjs/common";
import { EformsignWebhookEventWriter } from "application/services/eformsign-webhook-event.service";
import { EformsignWebhookService } from "application/services/eformsign-webhook.service";
import { sanitizeEformsignErrorMessage } from "application/utils/eformsign-error-message";
import {
    EFORMSIGN_WEBHOOK_OUTCOME,
    type EformsignWebhookOutcome,
} from "domain/constants/eformsign-webhook-outcome.constants";
import { EformsignWebhookPayloadDto } from "interface/dto/eformsign-webhook.dto";
import { WebhookGuard } from "infrastructure/auth/webhook.guard";
import { captureServiceRecordError } from "infrastructure/observability/service-record-sentry";
import { EformsignDocumentMirrorService } from "application/services/eformsign-document-mirror.service";
import { isEformsignDocumentAbsentError } from "infrastructure/api/eformsign-api.error";
import { normalizeEformsignStatusCode } from "domain/utils/eformsign-status-code";
import { createEformsignGlobalWorkerPrincipal } from "application/services/eformsign-credential-boundary.service";

const COMPLETED_EFORMSIGN_STATUS_TYPES = new Set([
    "003", "012", "022", "032", "050", "062", "072", "092",
]);

type WebhookMirrorSyncResult =
    | { ready: true; ownershipChanged: boolean }
    | {
        ready: false;
        ownershipChanged: false;
        dropOutcome: EformsignWebhookOutcome;
        dropReason: string;
    };

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
        private readonly webhookEventWriter: EformsignWebhookEventWriter,
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
                        await this.recordDroppedWebhook(
                            payload,
                            documentId,
                            mirrorSync.dropOutcome,
                            mirrorSync.dropReason,
                        );
                        return { success: true };
                    }
                    const mirroredDocument =
                        await this.documentMirrorService.getStoredDetail(documentId);
                    if (
                        !mirroredDocument
                        || !this.isWebhookCurrentEnough(payload, mirroredDocument.updated_date)
                    ) {
                        await this.recordDroppedWebhook(
                            payload,
                            documentId,
                            mirroredDocument
                                ? EFORMSIGN_WEBHOOK_OUTCOME.IGNORED_STALE_EVENT
                                : EFORMSIGN_WEBHOOK_OUTCOME.MIRROR_FAILED,
                            mirroredDocument
                                ? "mirror is newer"
                                : "local mirror is unavailable",
                        );
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
                        await this.recordDroppedWebhook(
                            payload,
                            documentId,
                            mirrorAvailable.dropOutcome,
                            mirrorAvailable.dropReason,
                        );
                        return { success: true };
                    }
                    const mirroredDocument =
                        await this.documentMirrorService.getStoredDetail(documentId);
                    if (!mirroredDocument) {
                        this.logger.warn(
                            `Skipping webhook ${payload.webhook_id}; local mirror is unavailable for ${documentId}`,
                        );
                        await this.recordDroppedWebhook(
                            payload,
                            documentId,
                            EFORMSIGN_WEBHOOK_OUTCOME.MIRROR_FAILED,
                            "local mirror is unavailable",
                        );
                        return { success: true };
                    }
                    if (!this.isWebhookCurrentEnough(payload, mirroredDocument.updated_date)) {
                        await this.recordDroppedWebhook(
                            payload,
                            documentId,
                            EFORMSIGN_WEBHOOK_OUTCOME.IGNORED_STALE_EVENT,
                            "mirror is newer",
                        );
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
    ): Promise<WebhookMirrorSyncResult> {
        try {
            const syncResult = await this.documentMirrorService.syncDocument(
                documentId,
                createEformsignGlobalWorkerPrincipal("webhook"),
                {
                force: true,
                skipBranchOwnedProjection: true,
                ...(options.requireCompletionReady
                    ? {}
                    : { skipHealthySameVersionFileRepair: true }),
                ...(options.requireCompletionReady
                    ? {
                        strictCompletionReconciliation: true,
                        deferServiceRecordLifecycle: true,
                    }
                    : {}),
                },
            );
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
                    return {
                        ready: false,
                        ownershipChanged: false,
                        dropOutcome: mirroredDocument
                            ? EFORMSIGN_WEBHOOK_OUTCOME.IGNORED_STALE_MIRROR
                            : EFORMSIGN_WEBHOOK_OUTCOME.MIRROR_FAILED,
                        dropReason: mirroredDocument
                            ? `mirror is ${mirroredStatusType}`
                            : "local mirror is unavailable",
                    };
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
            return {
                ready: false,
                ownershipChanged: false,
                dropOutcome: EFORMSIGN_WEBHOOK_OUTCOME.DOCUMENT_NOT_FOUND,
                dropReason: sanitizeEformsignErrorMessage(error),
            };
        }
    }

    private async recordDroppedWebhook(
        payload: EformsignWebhookPayloadDto,
        documentId: string,
        outcome: EformsignWebhookOutcome,
        outcomeReason: string,
    ): Promise<void> {
        try {
            await this.webhookEventWriter.append({
                webhookId: payload.webhook_id,
                eventType: payload.event_type,
                companyId: payload.company_id,
                documentId,
                rawStatus: payload.document?.status
                    ?? payload.ready_document_pdf?.document_status
                    ?? null,
                sourceUpdatedDate: webhookSourceUpdatedAt(payload),
                outcome,
                outcomeReason,
            });
        } catch {
            this.logger.warn(
                `Failed to record dropped eformsign webhook ${payload.webhook_id}`,
            );
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
    return webhookSourceUpdatedAt(payload) ?? new Date();
}

function webhookSourceUpdatedAt(payload: EformsignWebhookPayloadDto): Date | null {
    const timestamp = payload.document?.updated_date;
    if (typeof timestamp === "number" && Number.isFinite(timestamp)) {
        const date = new Date(timestamp);
        if (!Number.isNaN(date.getTime())) {
            return date;
        }
    }
    return null;
}
