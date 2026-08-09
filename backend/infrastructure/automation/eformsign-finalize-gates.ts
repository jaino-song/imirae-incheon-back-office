import type { FrameLocator, Page } from "playwright-core";
import type { Logger as NestLogger } from "@nestjs/common";
import {
    EFORMSIGN_GATE_DIAGNOSTIC_INTERVAL_MS,
    EFORMSIGN_GATE_POLL_MS,
    FINALIZE_REQUEST_SEND_DIALOG_SELECTOR,
    createGateErrorWithSnapshot,
    findVisibleEnabledLocator,
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
    onProgress?: (step: EformsignHeadlessProgressStep) => void,
): Promise<"success-latched" | "request-send-clicked"> {
    const startedAt = Date.now();
    let deadline = startedAt + EFORMSIGN_FINALIZE_GATE_WAIT_TIMEOUT_MS;
    let lastAction = "none";
    let creatingEmitted = false;
    let lastDiagnosticAt = startedAt;
    let firstActionAt: number | null = null;

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
        (logger as NestLogger).log?.(line) ?? console.log(line);
    };

    // Finalize prefill (서비스 종료일) is applied via the SDK options before the
    // iframe even renders, so as soon as we reach the gate loop the data is
    // effectively "inserted". Mirrors creation's info-inserted semantics.
    onProgress?.("info-inserted");

    const emitCreating = () => {
        if (creatingEmitted) return;
        creatingEmitted = true;
        onProgress?.("creating");
    };

    try {
        while (Date.now() < deadline) {
            await throwIfEformsignErrorLatched(page);

            if (await isSuccessLatched(page)) {
                // The one exit that used to leave no trace, which is why an
                // incident here could only be reconstructed from log silence.
                (logger as NestLogger).log?.(
                    `[finalize-gate] terminal success latched after ${Date.now() - startedAt}ms; ` +
                        `lastAction: ${lastAction}`,
                ) ?? console.log("[finalize-gate] terminal success latched");
                return "success-latched";
            }

            await emitIdleDiagnostic();

            const requestSendDialog = eformsignFrame.locator(FINALIZE_REQUEST_SEND_DIALOG_SELECTOR);

            const requestSendButton = await findVisibleEnabledLocator(
                requestSendDialog.getByRole("button", { name: "전송" }),
            );
            if (requestSendButton) {
                if (!(await tryClickGateLocator(requestSendButton))) {
                    lastAction = "popup 전송 click failed; retrying";
                    await page.waitForTimeout(EFORMSIGN_GATE_POLL_MS);
                    continue;
                }
                (logger as NestLogger).log?.("[finalize-gate] clicked popup 전송") ??
                    console.log("[finalize-gate] clicked popup 전송");
                emitCreating();
                return "request-send-clicked";
            }

            const requestSendDialogVisible = await requestSendDialog.isVisible().catch(() => false);
            const topLevelSendButton = requestSendDialogVisible
                ? null
                : await findVisibleEnabledLocator(eformsignFrame.getByRole("button", { name: "전송" }));
            if (topLevelSendButton) {
                if (!(await tryClickGateLocator(topLevelSendButton))) {
                    lastAction = "top-level 전송 click failed; retrying";
                    await page.waitForTimeout(EFORMSIGN_GATE_POLL_MS);
                    continue;
                }
                (logger as NestLogger).log?.("[finalize-gate] clicked top-level 전송") ??
                    console.log("[finalize-gate] clicked top-level 전송");
                emitCreating();
                noteAction("clicked top-level 전송");
                await page.waitForTimeout(250);
                continue;
            }

            // mode:"02" sometimes shows a 확인 dialog before allowing 전송.
            const confirmButton = await findVisibleEnabledLocator(
                eformsignFrame.getByRole("button", { name: "확인" }),
            );
            if (confirmButton) {
                if (!(await tryClickGateLocator(confirmButton))) {
                    lastAction = "확인 click failed; retrying";
                    await page.waitForTimeout(EFORMSIGN_GATE_POLL_MS);
                    continue;
                }
                (logger as NestLogger).log?.("[finalize-gate] clicked 확인") ??
                    console.log("[finalize-gate] clicked 확인");
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
