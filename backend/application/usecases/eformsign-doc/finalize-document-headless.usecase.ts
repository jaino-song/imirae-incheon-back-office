import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { createHash } from "node:crypto";
import {
    EformsignDocumentWorkflowState,
    EformsignService,
} from "application/services/eformsign.service";
import { EformsignHeadlessService } from "infrastructure/automation/eformsign-headless.service";
import { EformsignHeadlessProgressService } from "application/services/eformsign-headless-progress.service";
import type { EformsignHeadlessProgressStep } from "application/services/eformsign-headless-progress.service";
import { EformsignDocumentMirrorService } from "application/services/eformsign-document-mirror.service";
import { EformsignDispatchBoundaryService } from "application/services/eformsign-dispatch-boundary.service";
import { ContractClientAssignmentGuardService } from "application/services/contract-client-assignment-guard.service";
import {
    EFORMSIGN_DOC_REPOSITORY,
    IEformsignDocRepository,
} from "domain/repositories/eformsign-doc.repository.interface";
import { EFORMSIGN_DOCUMENT_KIND } from "domain/entities/eformsign-doc.entity";
import type { EformsignDocEntity } from "domain/entities/eformsign-doc.entity";
import { sanitizeEformsignErrorMessage } from "application/utils/eformsign-error-message";
import {
    EformsignCredentialBoundary,
    type EformsignProviderPrincipal,
} from "application/services/eformsign-credential-boundary.service";
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
    /** Authenticated tenant branch. Direct unit callers may omit this for compatibility. */
    branchId?: string;
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
    dispatchIntentId?: string;
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
        private readonly credentialBoundary: EformsignCredentialBoundary,
        private readonly progressService: EformsignHeadlessProgressService,
        @Optional() private readonly operationLock?: EformsignOperationLockService,
        @Optional() private readonly documentMirrorService?: EformsignDocumentMirrorService,
        @Optional()
        @Inject(EFORMSIGN_DOC_REPOSITORY)
        private readonly eformsignDocRepository?: IEformsignDocRepository,
        @Optional() private readonly assignmentGuard?: ContractClientAssignmentGuardService,
        @Optional() private readonly dispatchBoundary?: EformsignDispatchBoundaryService,
    ) {}

    async execute(
        params: FinalizeHeadlessParams,
        principal: EformsignProviderPrincipal,
    ): Promise<FinalizeHeadlessResult> {
        if (!this.operationLock) {
            return this.executeUnlocked(params, principal);
        }
        const start = Date.now();
        try {
            return await this.operationLock.runExclusive(
                `finalize:${params.documentId}`,
                (lease) => this.executeUnlocked(params, principal, lease),
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
                this.logger.error(sanitizeEformsignErrorMessage(error));
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
        principal: EformsignProviderPrincipal,
        lease?: EformsignOperationLease,
    ): Promise<FinalizeHeadlessResult> {
        const start = Date.now();
        let latestProgressStep: EformsignHeadlessProgressStep | undefined;
        let dispatchIntent: Awaited<ReturnType<EformsignDispatchBoundaryService["claim"]>>["intent"] | undefined;
        let sendWasAttempted = false;
        try {
            const target = await this.assertOwnedTarget(params);
            if (!target.ok) {
                return {
                    ok: false,
                    reason: "authorization_denied",
                    fallbackHint: "manual_check",
                    durationMs: Date.now() - start,
                };
            }

            if (this.dispatchBoundary && target.document) {
                const generation = target.document.updatedDate.toISOString();
                const fingerprint = createHash("sha256")
                    .update(JSON.stringify({
                        documentId: params.documentId,
                        prefillEndDate: params.prefillEndDate ?? null,
                        templateId: target.document.templateId,
                        generation,
                    }))
                    .digest("hex");
                const claim = await this.dispatchBoundary.claim({
                    branchId: params.branchId!,
                    clientId: target.document.clientId,
                    localDocumentId: target.document.id ?? null,
                    assignmentId: target.document.employeeScheduleId,
                    providerDocumentId: params.documentId,
                    templateId: target.document.templateId,
                    action: "finalize",
                    generation,
                    fingerprint,
                });
                if (claim.disposition === "already_accepted") {
                    return {
                        ok: false,
                        reason: "dispatch_already_accepted",
                        fallbackHint: "manual_check",
                        dispatchIntentId: claim.intent.id,
                        durationMs: Date.now() - start,
                    };
                }
                if (claim.disposition === "uncertain") {
                    return {
                        ok: false,
                        reason: "dispatch_uncertain_manual_reconciliation_required",
                        fallbackHint: "manual_check",
                        dispatchIntentId: claim.intent.id,
                        durationMs: Date.now() - start,
                    };
                }
                dispatchIntent = claim.intent;
            }
            return await this.credentialBoundary.withCredentials(
                principal,
                "contract.finalize",
                async ({ accessToken, refreshToken }) => {

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
                if (dispatchIntent) {
                    await this.dispatchBoundary?.releaseBeforeSend(
                        dispatchIntent,
                        "operation_lock_lost",
                    ).catch(() => undefined);
                }
                return {
                    ok: false,
                    reason: "operation_lock_lost",
                    fallbackHint: "manual_check",
                    dispatchIntentId: dispatchIntent?.id,
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
            sendWasAttempted =
                latestProgressStep === "creating" || latestProgressStep === "sent";
            const resultReason = result.ok ? undefined : sanitizeEformsignErrorMessage(result.reason);
            if (!result.ok && !sendWasAttempted) {
                if (dispatchIntent) {
                    await this.dispatchBoundary?.releaseBeforeSend(dispatchIntent, resultReason!).catch(() => undefined);
                }
                this.progressService.emit(params.progressId, "failed", resultReason, latestProgressStep);
                return {
                    ok: false,
                    reason: resultReason!,
                    fallbackHint: "iframe",
                    dispatchIntentId: dispatchIntent?.id,
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
                if (dispatchIntent) {
                    await this.dispatchBoundary?.markAccepted(
                        dispatchIntent,
                        params.documentId,
                        { outcome: "sdk_send_confirmed" },
                    ).catch((error) => {
                        this.logger.error(`Failed to persist eformsign finalize outcome: ${error}`);
                    });
                }
                return this.buildSuccessfulResult(params.documentId, result.durationMs, principal);
            }

            const settled = await this.waitForVendorOutcome(
                params.documentId,
                accessToken,
                initialWorkflowState,
            );
            if (settled === "completed") {
                if (!result.ok) {
                    this.logger.log(
                        `Headless finalize for ${params.documentId} reported "${resultReason}" but eformsign completed the document.`,
                    );
                }
                this.progressService.emit(params.progressId, "sent");
                if (dispatchIntent) {
                    await this.dispatchBoundary?.markAccepted(dispatchIntent, params.documentId, {
                        outcome: "completed",
                    }).catch((error) => {
                        this.logger.error(`Failed to persist eformsign finalize outcome: ${error}`);
                    });
                }
                return this.buildSuccessfulResult(params.documentId, result.durationMs, principal);
            }
            if (settled === "advanced") {
                this.logger.log(
                    `Headless finalize advanced ${params.documentId} to the next provider step.`,
                );
                if (dispatchIntent) {
                    await this.dispatchBoundary?.markAccepted(dispatchIntent, params.documentId, {
                        outcome: "advanced",
                    }).catch((error) => {
                        this.logger.error(`Failed to persist eformsign finalize outcome: ${error}`);
                    });
                }
                return { ok: true, completed: false, durationMs: result.durationMs };
            }

            const reason = settled === "failed"
                ? "eformsign_terminal_failure"
                : result.ok
                    ? "eformsign reported success without submitting the document"
                    : resultReason!;
            this.logger.warn(
                `Headless finalize for ${params.documentId}: ${reason} (vendor status: ${settled}).`,
            );
            this.progressService.emit(params.progressId, "failed", reason, latestProgressStep);
            if (dispatchIntent && sendWasAttempted) {
                await this.dispatchBoundary?.markUncertain(dispatchIntent, reason, params.documentId).catch((error) => {
                    this.logger.error(`Failed to persist uncertain eformsign finalize outcome: ${error}`);
                });
            } else if (dispatchIntent) {
                await this.dispatchBoundary?.releaseBeforeSend(dispatchIntent, reason).catch(() => undefined);
            }
            return {
                ok: false,
                reason,
                fallbackHint: settled === "pending" ? "iframe" : "manual_check",
                dispatchIntentId: dispatchIntent?.id,
                durationMs: result.durationMs,
                failedStep: latestProgressStep,
            };
                },
            );
        } catch (error) {
            const reason = sanitizeEformsignErrorMessage(error || "unknown headless finalize error");
            if (dispatchIntent) {
                if (sendWasAttempted) {
                    await this.dispatchBoundary?.markUncertain(dispatchIntent, reason, params.documentId).catch((persistError) => {
                        this.logger.error(`Failed to persist uncertain eformsign finalize outcome: ${sanitizeEformsignErrorMessage(persistError)}`);
                    });
                } else {
                    await this.dispatchBoundary?.releaseBeforeSend(dispatchIntent, reason).catch(() => undefined);
                }
            }
            this.logger.error(`FinalizeDocumentHeadlessUsecase failed: ${reason}`);
            this.progressService.emit(params.progressId, "failed", reason, latestProgressStep);
            return {
                ok: false,
                reason,
                fallbackHint: "iframe",
                dispatchIntentId: dispatchIntent?.id,
                durationMs: Date.now() - start,
                failedStep: latestProgressStep,
            };
        }
    }

    /**
     * The provider document id is not an ownership proof. The only acceptable
     * target is a live local row selected through the authenticated branch.
     */
    private async assertOwnedTarget(
        params: FinalizeHeadlessParams,
    ): Promise<{ ok: true; document?: EformsignDocEntity } | { ok: false }> {
        // Existing direct usecase tests and narrowly scoped callers predate the
        // tenant boundary. HTTP and worker paths always provide branchId.
        if (!params.branchId && !this.eformsignDocRepository) return { ok: true, document: undefined as never };
        if (!params.branchId || !this.eformsignDocRepository || !this.assignmentGuard) return { ok: false };

        let document: EformsignDocEntity | null;
        try {
            document = await this.eformsignDocRepository.findByDocumentId(
                params.branchId,
                params.documentId,
            );
        } catch {
            // A repository outage is not evidence of ownership. Keep the
            // provider boundary closed and expose the same safe denial as a
            // missing or cross-branch row.
            return { ok: false };
        }
        if (!document
            || !document.id
            || !document.documentKind
            || ![
                EFORMSIGN_DOCUMENT_KIND.CONTRACT,
                EFORMSIGN_DOCUMENT_KIND.SERVICE_RECORD_SNAPSHOT,
            ].includes(document.documentKind)
            || TERMINAL_STATUS_CODES.has(document.statusType)
            || document.expired
            || document.clientId === null) {
            return { ok: false };
        }

        try {
            const assignment = await this.assignmentGuard.assertAssignedClient(
                params.branchId,
                document.clientId,
            );
            if (document.employeeScheduleId !== null
                && assignment.scheduleId !== document.employeeScheduleId) {
                return { ok: false };
            }
        } catch {
            return { ok: false };
        }

        return { ok: true, document };
    }

    private buildSuccessfulResult(
        documentId: string,
        durationMs: number,
        principal: EformsignProviderPrincipal,
    ): FinalizeHeadlessSuccess {
        // Finalization and our document mirror are separate systems. Trigger an
        // exact-document refresh as soon as eformsign confirms completion so
        // contracts, service-record review state, and stored files converge
        // without waiting for a broad periodic reconciliation. A mirror delay
        // must not turn a confirmed vendor completion back into a UI failure.
        if (this.documentMirrorService) {
            this.queueMirrorSync(documentId, principal);
        }

        return { ok: true, completed: true, durationMs };
    }

    private queueMirrorSync(documentId: string, principal: EformsignProviderPrincipal): void {
        const previous = this.mirrorSyncs.get(documentId) ?? Promise.resolve();
        const queued = previous
            .catch(() => undefined)
            .then(() => this.syncMirrorWithRetry(documentId, principal));
        this.mirrorSyncs.set(documentId, queued);
        void queued.finally(() => {
            if (this.mirrorSyncs.get(documentId) === queued) {
                this.mirrorSyncs.delete(documentId);
            }
        });
    }

    private async syncMirrorWithRetry(
        documentId: string,
        principal: EformsignProviderPrincipal,
    ): Promise<void> {
        if (!this.documentMirrorService) return;
        let lastError: unknown;
        for (const delayMs of POST_FINALIZE_MIRROR_RETRY_DELAYS_MS) {
            if (delayMs > 0) {
                await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
            }
            try {
                await this.documentMirrorService.syncDocument(documentId, principal, {
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
        const reason = sanitizeEformsignErrorMessage(lastError);
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
            const reason = sanitizeEformsignErrorMessage(error);
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
            const reason = sanitizeEformsignErrorMessage(error);
            this.logger.warn(`Could not capture starting eformsign workflow for ${documentId}: ${reason}`);
            return null;
        }
    }
}
