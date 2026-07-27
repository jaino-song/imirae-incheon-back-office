import type { FrameLocator, Locator, Page } from "playwright-core";

export const EFORMSIGN_GATE_POLL_MS = 500;
export const EFORMSIGN_CLICK_TIMEOUT_MS = 2_000;
export const EFORMSIGN_READY_TEXT = "필수 입력 항목을 모두 작성했습니다.";
// eformsign uses two different popup IDs depending on the SDK mode:
//   - mode "01" (creation): #requestWithInputCommentPopup
//   - mode "02" (finalize):  #inputCommentPopup
// Keeping these as separate single-id selectors avoids Playwright's multi-match
// isVisible() throw, which the gate's catch() masks as `not visible` and makes
// the loop fall back to the (now-blocked) top-level 전송.
export const REQUEST_SEND_DIALOG_SELECTOR = "#requestWithInputCommentPopup";
export const FINALIZE_REQUEST_SEND_DIALOG_SELECTOR = "#inputCommentPopup";

/**
 * Returns the first visible match in `locator`, or null if none are visible.
 * Selectors like getByRole(...) often resolve to multiple DOM nodes inside
 * the eformsign iframe (hidden duplicates for mobile/desktop). We need the
 * one currently shown on screen.
 */
export async function findVisibleLocator(locator: Locator): Promise<Locator | null> {
    const count = await locator.count();
    for (let index = 0; index < count; index += 1) {
        const candidate = locator.nth(index);
        if (await candidate.isVisible().catch(() => false)) {
            return candidate;
        }
    }
    return null;
}

export async function findVisibleEnabledLocator(locator: Locator): Promise<Locator | null> {
    const count = await locator.count();
    for (let index = 0; index < count; index += 1) {
        const candidate = locator.nth(index);
        const visible = await candidate.isVisible().catch(() => false);
        if (!visible) continue;
        const className = await candidate.getAttribute("class").catch(() => null);
        const classDisabled = className?.split(/\s+/).includes("disabled") ?? false;
        if (classDisabled) continue;
        const enabled = await candidate.isEnabled().catch(() => false);
        if (enabled) {
            return candidate;
        }
    }
    return null;
}

export async function tryClickGateLocator(locator: Locator): Promise<boolean> {
    try {
        await locator.click({ timeout: EFORMSIGN_CLICK_TIMEOUT_MS });
        return true;
    } catch {
        return false;
    }
}

export interface GateSnapshot {
    visibleButtons: string[];
    guideButtonLabel: string | null;
    footerMessages: string[];
    requestSendDialogVisible: boolean;
}

export interface EformsignCallbackState {
    hasSuccess: boolean;
    hasError: boolean;
    success?: unknown;
    error?: unknown;
}

export function formatEformsignCallbackPayload(payload: unknown): string {
    if (payload === null) return "null";
    if (payload === undefined) return "undefined";
    if (typeof payload === "string") return payload;
    try {
        return JSON.stringify(payload);
    } catch {
        return String(payload);
    }
}

export async function readEformsignCallbackState(page: Page): Promise<EformsignCallbackState> {
    return page.evaluate(() => {
        const w = window as unknown as {
            __eformsignSuccess?: unknown;
            __eformsignError?: unknown;
        };
        return {
            hasSuccess: w.__eformsignSuccess !== undefined,
            hasError: w.__eformsignError !== undefined,
            success: w.__eformsignSuccess,
            error: w.__eformsignError,
        };
    });
}

export async function throwIfEformsignErrorLatched(page: Page): Promise<void> {
    const state = await readEformsignCallbackState(page).catch(() => null);
    if (!state?.hasError) return;
    throw new Error(`eformsign SDK error: ${formatEformsignCallbackPayload(state.error)}`);
}

export async function getEformsignGateSnapshot(
    eformsignFrame: FrameLocator,
    requestDialogSelector = REQUEST_SEND_DIALOG_SELECTOR,
): Promise<GateSnapshot> {
    return eformsignFrame.locator("body").evaluate(
        (body, { readyText, requestDialogSelector }) => {
            const normalize = (value: string | null | undefined): string =>
                (value ?? "").replace(/\s+/g, " ").trim();

            const isVisible = (element: Element | null): element is HTMLElement => {
                if (!(element instanceof HTMLElement)) {
                    return false;
                }
                const style = window.getComputedStyle(element);
                if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
                    return false;
                }
                const rect = element.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0;
            };

            const visibleButtons = Array.from(body.querySelectorAll<HTMLButtonElement>("button"))
                .filter((button) => isVisible(button))
                .map((button) => normalize(button.innerText))
                .filter(Boolean);

            const footerMessages = Array.from(body.querySelectorAll<HTMLElement>("*"))
                .filter((element) => isVisible(element))
                .map((element) => normalize(element.innerText))
                .filter((text) => text.includes(readyText) || text.startsWith("필수 입력 항목("));

            const guideButton = body.querySelector<HTMLElement>("#guideBtn");
            const requestSendDialog = body.querySelector<HTMLElement>(requestDialogSelector);

            return {
                visibleButtons: Array.from(new Set(visibleButtons)),
                guideButtonLabel: isVisible(guideButton) ? normalize(guideButton.innerText) : null,
                footerMessages: Array.from(new Set(footerMessages)).slice(0, 5),
                requestSendDialogVisible: isVisible(requestSendDialog),
            };
        },
        {
            readyText: EFORMSIGN_READY_TEXT,
            requestDialogSelector,
        },
        // Diagnostics must never stall a failing dispatch: the body walk is
        // expensive and evaluate would otherwise inherit Playwright's 30s default.
        { timeout: 3_000 },
    );
}

export async function createGateErrorWithSnapshot(
    error: unknown,
    eformsignFrame: FrameLocator,
    requestDialogSelector: string,
): Promise<Error> {
    const reason = error instanceof Error ? error.message : String(error);
    try {
        const snapshot = await getEformsignGateSnapshot(eformsignFrame, requestDialogSelector);
        return new Error(`${reason}. Snapshot: ${JSON.stringify(snapshot)}`);
    } catch (snapshotError) {
        const snapshotReason = snapshotError instanceof Error ? snapshotError.message : String(snapshotError);
        return new Error(`${reason}. Snapshot: unavailable (${snapshotReason})`);
    }
}

/**
 * Watches `window.__eformsignSuccess`, set by the SDK success callback wired
 * in `buildEmbeddedSdkHtml`. Returns true once the dispatch is confirmed,
 * false if the timeout elapsed first.
 */
export async function isSuccessLatched(page: Page): Promise<boolean> {
    return page
        .evaluate(() => {
            const w = window as unknown as { __eformsignSuccess?: unknown };
            return w.__eformsignSuccess !== undefined;
        })
        .catch(() => false);
}

export async function pollSuccess(page: Page): Promise<boolean> {
    return isSuccessLatched(page);
}
