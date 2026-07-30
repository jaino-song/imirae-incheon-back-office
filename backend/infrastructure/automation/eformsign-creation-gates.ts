import type { FrameLocator, Logger, Page } from "playwright-core";
import type { Logger as NestLogger } from "@nestjs/common";
import {
    EFORMSIGN_GATE_DIAGNOSTIC_INTERVAL_MS,
    EFORMSIGN_GATE_POLL_MS,
    EFORMSIGN_READY_TEXT,
    REQUEST_SEND_DIALOG_SELECTOR,
    createGateErrorWithSnapshot,
    findVisibleEnabledLocator,
    findVisibleLocator,
    getEformsignGateSnapshot,
    isSuccessLatched,
    throwIfEformsignErrorLatched,
    tryClickGateLocator,
} from "./eformsign-gate-utils";
import type { EformsignHeadlessProgressStep } from "application/services/eformsign-headless-progress.service";

// How long eformsign gets to render the editor far enough to expose its first
// actionable gate button. Measured spread on the same template/client is wide —
// 6s on a healthy run, 64s when the vendor is slow — so this budget is sized for
// the slow end, not the median.
const EFORMSIGN_CREATION_GATE_WAIT_TIMEOUT_MS = 70_000;
// How long the click sequence itself gets, measured from the first successful
// click. Kept separate from the wait budget on purpose: sharing one deadline let
// a slow editor render starve the sequence, which needs only ~2s in practice.
const EFORMSIGN_CREATION_GATE_ACTION_TIMEOUT_MS = 30_000;

/**
 * Drive the creation iframe (mode:"01") through the deterministic gate
 * sequence: 입력 시작 → 회사 도장 ×3 (확인 ×3) → 다음 ×2 → 전송 → popup 전송.
 * Lifted from `frontend/tests/contract-creation.smoke.spec.ts`. Selectors are
 * Korean accessibility names so they survive eformsign DOM refactors.
 */
export async function runEformsignCreationGates(
    page: Page,
    eformsignFrame: FrameLocator,
    logger: NestLogger | Logger | Console = console,
    onProgress?: (step: EformsignHeadlessProgressStep) => void,
): Promise<"success-latched" | "request-send-clicked"> {
    const startedAt = Date.now();
    let deadline = startedAt + EFORMSIGN_CREATION_GATE_WAIT_TIMEOUT_MS;
    let lastAction = "none";
    let stampConfirmCount = 0;
    let infoInsertedEmitted = false;
    let lastDiagnosticAt = startedAt;
    let firstActionAt: number | null = null;

    // Records a *successful* gate click. The first one hands the sequence its own
    // budget so however long the editor took to appear, the clicks still get a
    // full window. Failed-click retries deliberately don't come through here.
    const noteAction = (action: string): void => {
        lastAction = action;
        if (firstActionAt !== null) return;
        firstActionAt = Date.now();
        deadline = firstActionAt + EFORMSIGN_CREATION_GATE_ACTION_TIMEOUT_MS;
    };

    const emitIdleDiagnostic = async (): Promise<void> => {
        if (Date.now() - lastDiagnosticAt < EFORMSIGN_GATE_DIAGNOSTIC_INTERVAL_MS) return;
        lastDiagnosticAt = Date.now();
        const snapshot = await getEformsignGateSnapshot(eformsignFrame, REQUEST_SEND_DIALOG_SELECTOR).catch(
            (error: unknown) => `unavailable (${error instanceof Error ? error.message : String(error)})`,
        );
        const line =
            `[creation-gate] waiting ${Date.now() - startedAt}ms; lastAction: ${lastAction}; ` +
            `snapshot: ${JSON.stringify(snapshot)}`;
        (logger as NestLogger).log?.(line) ?? console.log(line);
    };

    const emitInfoInserted = () => {
        if (infoInsertedEmitted) return;
        infoInsertedEmitted = true;
        onProgress?.("info-inserted");
    };

    try {
        while (Date.now() < deadline) {
            await throwIfEformsignErrorLatched(page);

            if (await isSuccessLatched(page)) {
                return "success-latched";
            }

            await emitIdleDiagnostic();

            const requestSendDialog = eformsignFrame.locator(REQUEST_SEND_DIALOG_SELECTOR);

            // 회사 도장 dialog: appears 3 times, "확인" each time.
            const confirmButton = await findVisibleEnabledLocator(
                eformsignFrame.getByRole("button", { name: "확인" }),
            );
            if (confirmButton) {
                if (!(await tryClickGateLocator(confirmButton))) {
                    lastAction = "회사 도장 확인 click failed; retrying";
                    await page.waitForTimeout(EFORMSIGN_GATE_POLL_MS);
                    continue;
                }
                (logger as NestLogger).log?.("[creation-gate] clicked 회사 도장 확인") ??
                    console.log("[creation-gate] clicked 회사 도장 확인");
                stampConfirmCount++;
                if (stampConfirmCount >= 3) {
                    emitInfoInserted();
                }
                noteAction("clicked 회사 도장 확인");
                await page.waitForTimeout(250);
                continue;
            }

            // popup-level 전송 inside #requestWithInputCommentPopup terminates the gate loop.
            const requestSendButton = await findVisibleEnabledLocator(
                requestSendDialog.getByRole("button", { name: "전송" }),
            );
            if (requestSendButton) {
                if (!(await tryClickGateLocator(requestSendButton))) {
                    lastAction = "popup 전송 click failed; retrying";
                    await page.waitForTimeout(EFORMSIGN_GATE_POLL_MS);
                    continue;
                }
                (logger as NestLogger).log?.("[creation-gate] clicked popup 전송") ??
                    console.log("[creation-gate] clicked popup 전송");
                emitInfoInserted();
                onProgress?.("creating");
                return "request-send-clicked";
            }

            const requestSendDialogVisible = await requestSendDialog.isVisible().catch(() => false);
            const topLevelSendButton = requestSendDialogVisible
                ? null
                : await findVisibleEnabledLocator(eformsignFrame.getByRole("button", { name: "전송" }));
            if (topLevelSendButton) {
                const isFinalTopLevelSend = stampConfirmCount >= 3 || infoInsertedEmitted;

                if (!(await tryClickGateLocator(topLevelSendButton))) {
                    lastAction = "top-level 전송 click failed; retrying";
                    await page.waitForTimeout(EFORMSIGN_GATE_POLL_MS);
                    continue;
                }
                (logger as NestLogger).log?.("[creation-gate] clicked top-level 전송") ??
                    console.log("[creation-gate] clicked top-level 전송");
                if (isFinalTopLevelSend) {
                    emitInfoInserted();
                    onProgress?.("creating");
                }
                noteAction("clicked top-level 전송");
                await page.waitForTimeout(250);
                continue;
            }

            const nextButton = await findVisibleEnabledLocator(eformsignFrame.getByRole("button", { name: "다음" }));
            if (nextButton) {
                if (!(await tryClickGateLocator(nextButton))) {
                    lastAction = "다음 click failed; retrying";
                    await page.waitForTimeout(EFORMSIGN_GATE_POLL_MS);
                    continue;
                }
                (logger as NestLogger).log?.("[creation-gate] clicked 다음") ??
                    console.log("[creation-gate] clicked 다음");
                noteAction("clicked 다음");
                await page.waitForTimeout(250);
                continue;
            }

            const startButton = await findVisibleEnabledLocator(
                eformsignFrame.getByRole("button", { name: "입력 시작" }),
            );
            if (startButton) {
                if (!(await tryClickGateLocator(startButton))) {
                    lastAction = "입력 시작 click failed; retrying";
                    await page.waitForTimeout(EFORMSIGN_GATE_POLL_MS);
                    continue;
                }
                (logger as NestLogger).log?.("[creation-gate] clicked 입력 시작") ??
                    console.log("[creation-gate] clicked 입력 시작");
                noteAction("clicked 입력 시작");
                await page.waitForTimeout(250);
                continue;
            }

            const readyMessage = await findVisibleLocator(
                eformsignFrame.getByText(EFORMSIGN_READY_TEXT, { exact: true }),
            );
            if (readyMessage) {
                await page.waitForTimeout(EFORMSIGN_GATE_POLL_MS);
                continue;
            }

            await page.waitForTimeout(EFORMSIGN_GATE_POLL_MS);
        }
    } catch (error) {
        throw await createGateErrorWithSnapshot(
            error,
            eformsignFrame,
            REQUEST_SEND_DIALOG_SELECTOR,
        );
    }

    const phase = firstActionAt === null
        ? `no gate became actionable within ${EFORMSIGN_CREATION_GATE_WAIT_TIMEOUT_MS}ms`
        : `sequence stalled ${Date.now() - firstActionAt}ms after its first click `
            + `(budget ${EFORMSIGN_CREATION_GATE_ACTION_TIMEOUT_MS}ms)`;
    throw await createGateErrorWithSnapshot(
        new Error(
            `Timed out after ${Date.now() - startedAt}ms while advancing eformsign creation gates: ${phase}. ` +
                `Last action: ${lastAction}`,
        ),
        eformsignFrame,
        REQUEST_SEND_DIALOG_SELECTOR,
    );
}
