import { Injectable, Logger, Optional } from "@nestjs/common";
import {
    EformsignDocumentWorkflowState,
    EformsignService,
} from "application/services/eformsign.service";
import { EformsignHeadlessService } from "infrastructure/automation/eformsign-headless.service";
import { EformsignHeadlessProgressService } from "application/services/eformsign-headless-progress.service";
import type { EformsignHeadlessProgressStep } from "application/services/eformsign-headless-progress.service";
import { EformsignDocumentMirrorService } from "application/services/eformsign-document-mirror.service";
import { GetEformsignAccessTokenUsecase } from "./get-eformsign-access-token.usecase";
import {
    EFORMSIGN_COMPLETED_STATUS_CODES,
    TERMINAL_STATUS_CODES,
} from "domain/constants/eformsign-doc-status.constants";
import {
    EformsignOperationAlreadyRunningError,
    EformsignOperationLease,
    EformsignOperationLockService,
    EformsignOperationLockUnavailableError,
} from "infrastructure/locking/eformsign-operation-lock.service";

export interface FinalizeHeadlessParams {
    documentId: string;
    prefillEndDate?: string;
    progressId?: string;
    onProgress?: (step: EformsignHeadlessProgressStep) => void | Promise<void>;
}

export interface FinalizeHeadlessSuccess {
    ok: true;
    completed: true;
    durationMs: number;
}

export interface FinalizeHeadlessAdvanced {
    ok: true;
    completed: false;
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

export type FinalizeHeadlessResult =
    | FinalizeHeadlessSuccess
    | FinalizeHeadlessAdvanced
    | FinalizeHeadlessFailure;

// The embedded SDK callback and the document-detail API are not atomic. Keep
// this bounded below the frontend proxy timeout while giving the vendor enough
// time to expose the 070 -> 072 transition and recover from a transient read.
const VENDOR_OUTCOME_RETRY_DELAYS_MS = [0, 500, 1_000, 2_000, 4_000, 8_000] as const;
const POST_FINALIZE_MIRROR_RETRY_DELAYS_MS = [0, 1_000, 3_000, 8_000] as const;

type VendorOutcome = "completed" | "advanced" | "failed" | "pending" | "unknown";

function workflowStateAdvanced(
    initial: EformsignDocumentWorkflowState,
    current: EformsignDocumentWorkflowState,
): boolean {
    const comparableKeys: Array<keyof EformsignDocumentWorkflowState> = [
        "statusCode",
        "stepType",
        "stepIndex",
        "stepName",
    ];
    for (const key of comparableKeys) {
        const before = initial[key];
        const after = current[key];
        if (!before || !after) continue;
        if (before !== after) return true;
    }
    return false;
}

/**
 * Backend-driven mode:"02" finalize flow. Mirrors the staff-completion iframe
 * modal: builds the same SDK option payload, then runs the gate sequence
 * (top-level 전송 → popup 전송) headlessly. Falls back to iframe on errors.
 */
@Injectable()
export class FinalizeDocumentHeadlessUsecase {
    private readonly logger = new Logger(FinalizeDocumentHeadlessUsecase.name);
    private readonly mirrorSyncs = new Map<string, Promise<void>>();

    constructor(
        private readonly eformsignService: EformsignService,
        private readonly headlessService: EformsignHeadlessService,
        private readonly getAccessTokenUsecase: GetEformsignAccessTokenUsecase,
        private readonly progressService: EformsignHeadlessProgressService,
        @Optional() private readonly operationLock?: EformsignOperationLockService,
        @Optional() private readonly documentMirrorService?: EformsignDocumentMirrorService,
    ) {}

    async execute(params: FinalizeHeadlessParams): Promise<FinalizeHeadlessResult> {
        if (!this.operationLock) {
            return this.executeUnlocked(params);
        }
        const start = Date.now();
        try {
            return await this.operationLock.runExclusive(
                `finalize:${params.documentId}`,
                (lease) => this.executeUnlocked(params, lease),
            );
        } catch (error) {
            if (error instanceof EformsignOperationAlreadyRunningError) {
                return {
                    ok: false,
                    reason: "operation_in_progress",
                    fallbackHint: "manual_check",
                    durationMs: Date.now() - start,
                };
            }
            if (error instanceof EformsignOperationLockUnavailableError) {
                this.logger.error(error.message);
                return {
                    ok: false,
                    reason: "operation_lock_unavailable",
                    fallbackHint: "manual_check",
                    durationMs: Date.now() - start,
                };
            }
            throw error;
        }
    }

    private async executeUnlocked(
        params: FinalizeHeadlessParams,
        lease?: EformsignOperationLease,
    ): Promise<FinalizeHeadlessResult> {
        const start = Date.now();
        let latestProgressStep: EformsignHeadlessProgressStep | undefined;
        try {
            const tokenResponse = await this.getAccessTokenUsecase.execute(Date.now());
            const accessToken = tokenResponse.oauth_token.access_token;
            const refreshToken = tokenResponse.oauth_token.refresh_token;

            // A contract can contain consecutive provider-owned steps
            // (제공기관 확인 -> 제공기관 검토). Each HTTP request handles one
            // step so even a slow valid step remains below the 170s proxy limit.
            const initialWorkflowState = await this.readInitialWorkflowState(
                params.documentId,
                accessToken,
            );
            const documentOption = (await this.eformsignService.generateStaffCompletionOptions(
                params.documentId,
                accessToken,
                refreshToken,
                params.prefillEndDate,
            )) as Record<string, unknown>;

            if (lease && !lease.isHeld()) {
                return {
                    ok: false,
                    reason: "operation_lock_lost",
                    fallbackHint: "manual_check",
                    durationMs: Date.now() - start,
                };
            }

            const result = await this.headlessService.dispatchFinalize({
                documentOption,
                documentId: params.documentId,
                onProgress: async (step) => {
                    latestProgressStep = step;
                    await params.onProgress?.(step);
                    // The SDK's sent callback confirms this step's submission,
                    // not whole-document completion. Hold it until the vendor
                    // status read proves that no provider step remains.
                    if (step !== "sent") {
                        this.progressService.emit(params.progressId, step);
                    }
                },
            });
            const sendWasAttempted =
                latestProgressStep === "creating" || latestProgressStep === "sent";
            if (!result.ok && !sendWasAttempted) {
                this.progressService.emit(params.progressId, "failed", result.reason, latestProgressStep);
                return {
                    ok: false,
                    reason: result.reason,
                    fallbackHint: "iframe",
                    durationMs: result.durationMs,
                    failedStep: latestProgressStep,
                };
            }

            // Production adapters expose the workflow reader. Older adapters
            // and narrow unit stubs may not, so preserve the documented gate
            // result there except for the ambiguous success-latch path.
            const workflowReaderAvailable = typeof this.eformsignService.fetchDocumentWorkflowState === "function";
            const mustConfirmWithVendor = workflowReaderAvailable
                || !result.ok
                || result.gateOutcome === "success-latched";
            if (!mustConfirmWithVendor) {
                return this.buildSuccessfulResult(params.documentId, result.durationMs);
            }

            const settled = await this.waitForVendorOutcome(
                params.documentId,
                accessToken,
                initialWorkflowState,
            );
            if (settled === "completed") {
                if (!result.ok) {
                    this.logger.log(
                        `Headless finalize for ${params.documentId} reported "${result.reason}" but eformsign completed the document.`,
                    );
                }
                this.progressService.emit(params.progressId, "sent");
                return this.buildSuccessfulResult(params.documentId, result.durationMs);
            }
            if (settled === "advanced") {
                this.logger.log(
                    `Headless finalize advanced ${params.documentId} to the next provider step.`,
                );
                return { ok: true, completed: false, durationMs: result.durationMs };
            }

            const reason = settled === "failed"
                ? "eformsign_terminal_failure"
                : result.ok
                    ? "eformsign reported success without submitting the document"
                    : result.reason;
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

    private buildSuccessfulResult(
        documentId: string,
        durationMs: number,
    ): FinalizeHeadlessSuccess {
        // Finalization and our document mirror are separate systems. Trigger an
        // exact-document refresh as soon as eformsign confirms completion so
        // contracts, service-record review state, and stored files converge
        // without waiting for a broad periodic reconciliation. A mirror delay
        // must not turn a confirmed vendor completion back into a UI failure.
        if (this.documentMirrorService) {
            this.queueMirrorSync(documentId);
        }

        return { ok: true, completed: true, durationMs };
    }

    private queueMirrorSync(documentId: string): void {
        const previous = this.mirrorSyncs.get(documentId) ?? Promise.resolve();
        const queued = previous
            .catch(() => undefined)
            .then(() => this.syncMirrorWithRetry(documentId));
        this.mirrorSyncs.set(documentId, queued);
        void queued.finally(() => {
            if (this.mirrorSyncs.get(documentId) === queued) {
                this.mirrorSyncs.delete(documentId);
            }
        });
    }

    private async syncMirrorWithRetry(documentId: string): Promise<void> {
        if (!this.documentMirrorService) return;
        let lastError: unknown;
        for (const delayMs of POST_FINALIZE_MIRROR_RETRY_DELAYS_MS) {
            if (delayMs > 0) {
                await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
            }
            try {
                await this.documentMirrorService.syncDocument(documentId, {
                    force: true,
                    suppressOutboundAutomation: true,
                    // A ready PDF is not enough: contract end-date projection and
                    // service-record lifecycle effects must also converge. Strict
                    // failures are retried by this bounded queue.
                    strictCompletionReconciliation: true,
                    publishChangeReason: "mirror:finalize",
                });
                return;
            } catch (error) {
                lastError = error;
            }
        }
        const reason = lastError instanceof Error ? lastError.message : String(lastError);
        this.logger.warn(`Post-finalize mirror sync failed for ${documentId}: ${reason}`);
    }

    /**
     * Whether eformsign considers the document finished. "unknown" is deliberately
     * distinct from "pending": a status we could not read must not be reported as
     * an unfinished step, because that is what sends a human back into the editor.
     */
    private async readVendorOutcome(
        documentId: string,
        accessToken: string,
        initialWorkflowState: EformsignDocumentWorkflowState | null,
    ): Promise<VendorOutcome> {
        try {
            if (initialWorkflowState) {
                const current = await this.eformsignService.fetchDocumentWorkflowState(
                    documentId,
                    accessToken,
                );
                if (current.statusCode && EFORMSIGN_COMPLETED_STATUS_CODES.has(current.statusCode)) {
                    return "completed";
                }
                if (current.statusCode && TERMINAL_STATUS_CODES.has(current.statusCode)) {
                    return "failed";
                }
                if (workflowStateAdvanced(initialWorkflowState, current)) {
                    return "advanced";
                }
                return current.statusCode ? "pending" : "unknown";
            }

            const statusCode = await this.eformsignService.fetchDocumentStatusCode(
                documentId,
                accessToken,
            );
            if (!statusCode) {
                this.logger.warn(`eformsign returned no status while confirming finalize for ${documentId}.`);
                return "unknown";
            }
            if (EFORMSIGN_COMPLETED_STATUS_CODES.has(statusCode)) return "completed";
            return TERMINAL_STATUS_CODES.has(statusCode) ? "failed" : "pending";
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            this.logger.warn(`Could not read eformsign status for ${documentId}: ${reason}`);
            return "unknown";
        }
    }

    private async waitForVendorOutcome(
        documentId: string,
        accessToken: string,
        initialWorkflowState: EformsignDocumentWorkflowState | null,
    ): Promise<VendorOutcome> {
        let latest: "pending" | "unknown" = "unknown";

        for (const delayMs of VENDOR_OUTCOME_RETRY_DELAYS_MS) {
            if (delayMs > 0) {
                await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
            }

            const outcome = await this.readVendorOutcome(
                documentId,
                accessToken,
                initialWorkflowState,
            );
            if (outcome === "completed" || outcome === "advanced" || outcome === "failed") {
                return outcome;
            }
            latest = outcome;
        }

        return latest;
    }

    private async readInitialWorkflowState(
        documentId: string,
        accessToken: string,
    ): Promise<EformsignDocumentWorkflowState | null> {
        // Keeping this guard makes the use case tolerant of older adapters while
        // every production EformsignService instance provides the richer reader.
        const reader = this.eformsignService.fetchDocumentWorkflowState?.bind(this.eformsignService);
        if (!reader) return null;
        try {
            const state = await reader(documentId, accessToken);
            return state.statusCode || state.stepType || state.stepIndex || state.stepName
                ? state
                : null;
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            this.logger.warn(`Could not capture starting eformsign workflow for ${documentId}: ${reason}`);
            return null;
        }
    }
}
