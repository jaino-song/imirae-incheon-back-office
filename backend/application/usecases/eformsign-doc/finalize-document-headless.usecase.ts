import { Injectable, Logger } from "@nestjs/common";
import { EformsignService } from "application/services/eformsign.service";
import { EformsignHeadlessService } from "infrastructure/automation/eformsign-headless.service";
import { EformsignHeadlessProgressService } from "application/services/eformsign-headless-progress.service";
import type { EformsignHeadlessProgressStep } from "application/services/eformsign-headless-progress.service";
import { GetEformsignAccessTokenUsecase } from "./get-eformsign-access-token.usecase";
import { EFORMSIGN_COMPLETED_STATUS_CODES } from "domain/constants/eformsign-doc-status.constants";

export interface FinalizeHeadlessParams {
    documentId: string;
    prefillEndDate?: string;
    progressId?: string;
}

export interface FinalizeHeadlessSuccess {
    ok: true;
    durationMs: number;
}

export interface FinalizeHeadlessFailure {
    ok: false;
    reason: string;
    /**
     * "iframe" reopens the editor so a human can finish the step. It is only
     * safe once we know the step is genuinely unfinished — "manual_check" is
     * for the runs where the vendor could not be asked.
     */
    fallbackHint: "iframe" | "manual_check";
    durationMs: number;
    failedStep?: EformsignHeadlessProgressStep;
}

export type FinalizeHeadlessResult = FinalizeHeadlessSuccess | FinalizeHeadlessFailure;

/**
 * Backend-driven mode:"02" finalize flow. Mirrors the staff-completion iframe
 * modal: builds the same SDK option payload, then runs the gate sequence
 * (top-level 전송 → popup 전송) headlessly. Falls back to iframe on errors.
 */
@Injectable()
export class FinalizeDocumentHeadlessUsecase {
    private readonly logger = new Logger(FinalizeDocumentHeadlessUsecase.name);

    constructor(
        private readonly eformsignService: EformsignService,
        private readonly headlessService: EformsignHeadlessService,
        private readonly getAccessTokenUsecase: GetEformsignAccessTokenUsecase,
        private readonly progressService: EformsignHeadlessProgressService,
    ) {}

    async execute(params: FinalizeHeadlessParams): Promise<FinalizeHeadlessResult> {
        const start = Date.now();
        let latestProgressStep: EformsignHeadlessProgressStep | undefined;
        try {
            const tokenResponse = await this.getAccessTokenUsecase.execute(Date.now());
            const accessToken = tokenResponse.oauth_token.access_token;
            const refreshToken = tokenResponse.oauth_token.refresh_token;

            const documentOption = (await this.eformsignService.generateStaffCompletionOptions(
                params.documentId,
                accessToken,
                refreshToken,
                params.prefillEndDate,
            )) as Record<string, unknown>;

            const result = await this.headlessService.dispatchFinalize({
                documentOption,
                documentId: params.documentId,
                onProgress: (step) => {
                    latestProgressStep = step;
                    this.progressService.emit(params.progressId, step);
                },
            });

            if (!result.ok) {
                // The gate emits "creating" the moment it clicks 전송, so a failure
                // at or after that step sits on an unknown side of the submit.
                // Reopening the editor then can ask a human to re-approve a step
                // eformsign already completed, so ask the vendor before guessing.
                const sendWasAttempted =
                    latestProgressStep === "creating" || latestProgressStep === "sent";
                const settled = sendWasAttempted
                    ? await this.readVendorOutcome(params.documentId, accessToken)
                    : "pending";

                if (settled === "completed") {
                    this.logger.log(
                        `Headless finalize for ${params.documentId} reported "${result.reason}" but eformsign shows the document completed; treating as success.`,
                    );
                    this.progressService.emit(params.progressId, "sent");
                    return { ok: true, durationMs: result.durationMs };
                }

                this.progressService.emit(params.progressId, "failed", result.reason, latestProgressStep);
                return {
                    ok: false,
                    reason: result.reason,
                    fallbackHint: settled === "pending" ? "iframe" : "manual_check",
                    durationMs: result.durationMs,
                    failedStep: latestProgressStep,
                };
            }

            // A run that ended on the success latch stopped at the SDK callback
            // without necessarily having clicked the popup 전송 that submits —
            // exactly how a finalize once reported a completion eformsign never
            // performed. The SDK's completion code is inferred, not documented,
            // so this one path is settled by the vendor rather than by us.
            if (result.gateOutcome === "success-latched") {
                const settled = await this.readVendorOutcome(params.documentId, accessToken);
                if (settled !== "completed") {
                    const reason = "eformsign reported success without submitting the document";
                    this.logger.warn(
                        `Headless finalize for ${params.documentId}: ${reason} (vendor status: ${settled}).`,
                    );
                    this.progressService.emit(params.progressId, "failed", reason, latestProgressStep);
                    return {
                        ok: false,
                        reason,
                        fallbackHint: settled === "pending" ? "iframe" : "manual_check",
                        durationMs: result.durationMs,
                        failedStep: latestProgressStep,
                    };
                }
            }

            return { ok: true, durationMs: result.durationMs };
        } catch (error) {
            const reason = error instanceof Error ? error.message : "unknown headless finalize error";
            this.logger.error(`FinalizeDocumentHeadlessUsecase failed: ${reason}`);
            this.progressService.emit(params.progressId, "failed", reason, latestProgressStep);
            return {
                ok: false,
                reason,
                fallbackHint: "iframe",
                durationMs: Date.now() - start,
                failedStep: latestProgressStep,
            };
        }
    }

    /**
     * Whether eformsign considers the document finished. "unknown" is deliberately
     * distinct from "pending": a status we could not read must not be reported as
     * an unfinished step, because that is what sends a human back into the editor.
     */
    private async readVendorOutcome(
        documentId: string,
        accessToken: string,
    ): Promise<"completed" | "pending" | "unknown"> {
        try {
            const statusCode = await this.eformsignService.fetchDocumentStatusCode(
                documentId,
                accessToken,
            );
            if (!statusCode) {
                this.logger.warn(`eformsign returned no status for ${documentId} after a post-send failure.`);
                return "unknown";
            }
            return EFORMSIGN_COMPLETED_STATUS_CODES.has(statusCode) ? "completed" : "pending";
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            this.logger.warn(`Could not read eformsign status for ${documentId}: ${reason}`);
            return "unknown";
        }
    }
}
