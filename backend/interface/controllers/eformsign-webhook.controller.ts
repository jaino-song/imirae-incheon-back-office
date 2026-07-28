import { Body, Controller, Post, HttpCode, HttpStatus, Logger, ServiceUnavailableException, UseGuards } from "@nestjs/common";
import { EformsignWebhookService } from "application/services/eformsign-webhook.service";
import { EformsignWebhookPayloadDto } from "interface/dto/eformsign-webhook.dto";
import { WebhookGuard } from "infrastructure/auth/webhook.guard";
import { captureServiceRecordError } from "infrastructure/observability/service-record-sentry";

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

    constructor(private readonly webhookService: EformsignWebhookService) {}

    @Post()
    @HttpCode(HttpStatus.OK)
    async handleWebhook(@Body() payload: EformsignWebhookPayloadDto) {
        const documentId = payload.document?.id || payload.ready_document_pdf?.document_id || "unknown";
        this.logger.log(`Received eformsign webhook: ${payload.event_type} for document ${documentId}`);

        try {
            await this.webhookService.processWebhook(payload);
            return { success: true };
        } catch (error) {
            captureServiceRecordError(error, {
                operation: "webhook",
                handled: true,
                statusCode: HttpStatus.SERVICE_UNAVAILABLE,
            });
            this.logger.error(`Webhook processing failed: ${error}`);
            throw new ServiceUnavailableException({
                success: false,
                error: "Webhook processing failed",
                webhookId: payload.webhook_id,
                documentId,
            });
        }
    }
}
