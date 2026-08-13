import type { FrameLocator, Locator, Page } from "playwright-core";
import type { Logger as NestLogger } from "@nestjs/common";
import {
    EFORMSIGN_GATE_DIAGNOSTIC_INTERVAL_MS,
    EFORMSIGN_GATE_POLL_MS,
    EFORMSIGN_PRE_SEND_CLICK_TIMEOUT_LIMIT,
    FINALIZE_REQUEST_SEND_DIALOG_SELECTOR,
    createGateErrorWithSnapshot,
    findVisibleEnabledLocator,
    getGateClickOutcome,
    getEformsignGateSnapshot,
    isSuccessLatched,
    throwIfEformsignErrorLatched,
    tryClickGateLocator,
} from "./eformsign-gate-utils";
import type { EformsignHeadlessProgressStep } from "application/services/eformsign-headless-progress.service";

// Same split as the creation gates: eformsign's editor render time varies by an
// order of magnitude, so waiting for the first actionable gate gets its own
// budget and must not eat into the click sequence that follows.
const EFORMSIGN_FINALIZE_GATE_WAIT_TIMEOUT_MS = 70_000;
const EFORMSIGN_FINALIZE_GATE_ACTION_TIMEOUT_MS = 30_000;
const EFORMSIGN_TOP_LEVEL_SEND_POPUP_WAIT_POLLS = 4;

/**
 * Drive the staff-finalize iframe (mode:"02") through its short gate sequence:
 * top-level 전송 → popup 전송. The doc is already filled, so there is no
 * 입력 시작 / 회사 도장 / 다음 cycle. Selectors mirror the creation gates so
 * an eformsign UI refactor only needs one update.
 */
export async function runEformsignFinalizeGates(
    page: Page,
    eformsignFrame: FrameLocator,
    logger: NestLogger | Console = console,
    onProgress?: (step: EformsignHeadlessProgressStep) => void | Promise<void>,
): Promise<"success-latched" | "request-send-clicked" | "request-send-attempted"> {
    const startedAt = Date.now();
    let deadline = startedAt + EFORMSIGN_FINALIZE_GATE_WAIT_TIMEOUT_MS;
    let lastAction = "none";
    let creatingEmitted = false;
    let lastDiagnosticAt = startedAt;
    let firstActionAt: number | null = null;
    let topLevelSendAttempted = false;
    let topLevelSendClickCount = 0;
    let topLevelSendPopupWaitPolls = 0;
    let preSendClickTimeoutCount = 0;

    const logMessage = (message: string): void => {
        const log = (logger as NestLogger).log;
        if (typeof log === "function") log.call(logger, message);
        else console.log(message);
    };

    const noteAction = (action: string): void => {
        lastAction = action;
        if (firstActionAt !== null) return;
        firstActionAt = Date.now();
        deadline = firstActionAt + EFORMSIGN_FINALIZE_GATE_ACTION_TIMEOUT_MS;
    };

    const emitIdleDiagnostic = async (): Promise<void> => {
        if (Date.now() - lastDiagnosticAt < EFORMSIGN_GATE_DIAGNOSTIC_INTERVAL_MS) return;
        lastDiagnosticAt = Date.now();
        const snapshot = await getEformsignGateSnapshot(
            eformsignFrame,
            FINALIZE_REQUEST_SEND_DIALOG_SELECTOR,
        ).catch((error: unknown) => `unavailable (${error instanceof Error ? error.message : String(error)})`);
        const line =
            `[finalize-gate] waiting ${Date.now() - startedAt}ms; lastAction: ${lastAction}; ` +
            `snapshot: ${JSON.stringify(snapshot)}`;
        logMessage(line);
    };

    // Finalize prefill (서비스 종료일) is applied via the SDK options before the
    // iframe even renders, so as soon as we reach the gate loop the data is
    // effectively "inserted". Mirrors creation's info-inserted semantics.
    await onProgress?.("info-inserted");

    const emitCreating = async () => {
        if (creatingEmitted) return;
        creatingEmitted = true;
        await onProgress?.("creating");
    };

    const tryPreSendClick = async (locator: Locator, action: string): Promise<boolean> => {
        const outcome = await getGateClickOutcome(locator);
        if (outcome === "clicked") return true;

        if (outcome === "timed-out") {
            preSendClickTimeoutCount += 1;
            lastAction =
                `${action} click timed out ` +
                `(${preSendClickTimeoutCount}/${EFORMSIGN_PRE_SEND_CLICK_TIMEOUT_LIMIT})`;
            if (preSendClickTimeoutCount >= EFORMSIGN_PRE_SEND_CLICK_TIMEOUT_LIMIT) {
                throw new Error(
                    "Pre-send eformsign finalize click timed out twice; opening iframe fallback",
                );
            }
        } else {
            lastAction = `${action} click failed; retrying`;
        }
        return false;
    };

    try {
        while (Date.now() < deadline) {
            await throwIfEformsignErrorLatched(page);

            if (await isSuccessLatched(page)) {
                // A no-popup template can complete or advance directly from the
                // top-level 전송. The caller always verifies this latch against the
                // vendor's current workflow state; an unchanged document is still
                // rejected and sent to the iframe fallback.
                logMessage(
                    `[finalize-gate] terminal success latched after ${Date.now() - startedAt}ms; ` +
                        `lastAction: ${lastAction}`,
                );
                return "success-latched";
            }

            await emitIdleDiagnostic();

            const requestSendDialog = eformsignFrame.locator(FINALIZE_REQUEST_SEND_DIALOG_SELECTOR);

            const requestSendButton = await findVisibleEnabledLocator(
                requestSendDialog.getByRole("button", { name: "전송" }),
            );
            if (requestSendButton) {
                // The durable fence must commit before any provider-side send.
                await emitCreating();
                if (!(await tryClickGateLocator(requestSendButton))) {
                    lastAction = "popup 전송 click outcome ambiguous; reconciling";
                    const message =
                        "[finalize-gate] popup 전송 click outcome is ambiguous; reconciling without retry";
                    logMessage(message);
                    return "request-send-attempted";
                }
                logMessage("[finalize-gate] clicked popup 전송");
                return "request-send-clicked";
            }

            const requestSendDialogVisible = await requestSendDialog.isVisible().catch(() => false);
            if (topLevelSendAttempted && !requestSendDialogVisible) {
                topLevelSendPopupWaitPolls += 1;
            }
            const popupWaitExpired =
                topLevelSendPopupWaitPolls >= EFORMSIGN_TOP_LEVEL_SEND_POPUP_WAIT_POLLS;
            if (
                popupWaitExpired
                && topLevelSendClickCount >= EFORMSIGN_PRE_SEND_CLICK_TIMEOUT_LIMIT
            ) {
                throw new Error(
                    "Pre-send eformsign finalize confirmation popup timed out twice; opening iframe fallback",
                );
            }

            const topLevelSendButton = requestSendDialogVisible
                || (topLevelSendAttempted && !popupWaitExpired)
                ? null
                : await findVisibleEnabledLocator(eformsignFrame.getByRole("button", { name: "전송" }));
            if (topLevelSendButton) {
                topLevelSendAttempted = true;
                topLevelSendClickCount += 1;
                topLevelSendPopupWaitPolls = 0;
                await emitCreating();
                if (!(await tryClickGateLocator(topLevelSendButton))) {
                    lastAction = "top-level 전송 click outcome ambiguous; waiting for popup";
                    noteAction(lastAction);
                    await page.waitForTimeout(EFORMSIGN_GATE_POLL_MS);
                    continue;
                }
                logMessage("[finalize-gate] clicked top-level 전송");
                noteAction("clicked top-level 전송");
                await page.waitForTimeout(250);
                continue;
            }

            if (topLevelSendAttempted) {
                await page.waitForTimeout(EFORMSIGN_GATE_POLL_MS);
                continue;
            }

            // mode:"02" sometimes shows a 확인 dialog before allowing 전송.
            const confirmButton = await findVisibleEnabledLocator(
                eformsignFrame.getByRole("button", { name: "확인" }),
            );
            if (confirmButton) {
                if (!(await tryPreSendClick(confirmButton, "확인"))) {
                    await page.waitForTimeout(EFORMSIGN_GATE_POLL_MS);
                    continue;
                }
                logMessage("[finalize-gate] clicked 확인");
                noteAction("clicked 확인");
                await page.waitForTimeout(250);
                continue;
            }

            await page.waitForTimeout(EFORMSIGN_GATE_POLL_MS);
        }
    } catch (error) {
        throw await createGateErrorWithSnapshot(
            error,
            eformsignFrame,
            FINALIZE_REQUEST_SEND_DIALOG_SELECTOR,
        );
    }

    const phase = firstActionAt === null
        ? `no gate became actionable within ${EFORMSIGN_FINALIZE_GATE_WAIT_TIMEOUT_MS}ms`
        : `sequence stalled ${Date.now() - firstActionAt}ms after its first click `
            + `(budget ${EFORMSIGN_FINALIZE_GATE_ACTION_TIMEOUT_MS}ms)`;
    throw await createGateErrorWithSnapshot(
        new Error(
            `Timed out after ${Date.now() - startedAt}ms while advancing eformsign finalize gates: ${phase}. ` +
                `Last action: ${lastAction}`,
        ),
        eformsignFrame,
        FINALIZE_REQUEST_SEND_DIALOG_SELECTOR,
    );
}
