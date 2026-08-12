/**
 * Headless service spec. Playwright is heavyweight, so we mock chromium.launch
 * and verify:
 *   - creation dispatch reaches the gate runner with the iframe found
 *   - SDK success callback (`__eformsignSuccess.document_id`) is propagated
 *   - failures (gate runner throws, success callback timeout) are wrapped
 *     into ok=false envelopes
 */

const launchMock = jest.fn();

jest.mock("playwright-core", () => ({
    chromium: { launch: (...args: unknown[]) => launchMock(...args) },
}));

jest.mock("../../infrastructure/automation/eformsign-creation-gates", () => ({
    runEformsignCreationGates: jest.fn().mockResolvedValue("success-latched"),
}));

jest.mock("../../infrastructure/automation/eformsign-finalize-gates", () => ({
    runEformsignFinalizeGates: jest.fn().mockResolvedValue("success-latched"),
}));

import { EformsignHeadlessService } from "../../infrastructure/automation/eformsign-headless.service";
import { runEformsignCreationGates } from "../../infrastructure/automation/eformsign-creation-gates";
import { runEformsignFinalizeGates } from "../../infrastructure/automation/eformsign-finalize-gates";

describe("EformsignHeadlessService", () => {
    let service: EformsignHeadlessService;
    const configGetMock = jest.fn();
    let pageMock: ReturnType<typeof buildPageMock>;
    let contextMock: ReturnType<typeof buildContextMock>;
    let browserMock: ReturnType<typeof buildBrowserMock>;

    function buildPageMock() {
        return {
            setContent: jest.fn().mockResolvedValue(undefined),
            route: jest.fn().mockResolvedValue(undefined),
            goto: jest.fn().mockResolvedValue(undefined),
            waitForFunction: jest.fn().mockResolvedValue(undefined),
            close: jest.fn().mockResolvedValue(undefined),
            evaluate: jest.fn().mockImplementation((fn: unknown) => {
                const source = String(fn);
                if (source.includes("__eformsignSuccess") && source.includes("__eformsignError")) {
                    return Promise.resolve({
                        hasSuccess: true,
                        hasError: false,
                        success: { document_id: "doc-from-callback" },
                    });
                }
                if (source.includes("__eformsignSuccess")) {
                    return Promise.resolve(true);
                }
                return Promise.resolve(undefined);
            }),
            frameLocator: jest.fn().mockReturnValue({}),
        };
    }

    function buildContextMock() {
        return {
            newPage: jest.fn().mockImplementation(() => Promise.resolve(pageMock)),
            close: jest.fn().mockResolvedValue(undefined),
        };
    }

    function buildBrowserMock() {
        return {
            isConnected: jest.fn().mockReturnValue(true),
            newContext: jest.fn().mockImplementation(() => Promise.resolve(contextMock)),
            close: jest.fn().mockResolvedValue(undefined),
        };
    }

    beforeEach(() => {
        jest.clearAllMocks();
        configGetMock.mockReturnValue(undefined);
        delete process.env["EFORMSIGN_BROWSER_HEADLESS"];
        pageMock = buildPageMock();
        contextMock = buildContextMock();
        browserMock = buildBrowserMock();
        launchMock.mockResolvedValue(browserMock);
        service = new EformsignHeadlessService({ get: configGetMock } as never);
    });

    /**
     * Pulls the SDK success callback out of the generated page and returns it
     * bound to a stand-in `window`, so the assertions below exercise the source
     * that actually ships to the browser rather than a restatement of it.
     */
    function extractSuccessCallback(html: string) {
        const start = html.indexOf("function (resp) {");
        expect(start).toBeGreaterThan(-1);
        let depth = 0;
        let end = start;
        for (let index = html.indexOf("{", start); index < html.length; index += 1) {
            if (html[index] === "{") depth += 1;
            if (html[index] === "}") {
                depth -= 1;
                if (depth === 0) {
                    end = index + 1;
                    break;
                }
            }
        }
        const source = html.slice(start, end);
        return new Function("window", `return (${source});`) as (
            win: Record<string, unknown>,
        ) => (resp: unknown) => void;
    }

    it("latches the SDK success callback only for the completion code", () => {
        const html = (
            service as unknown as {
                buildEmbeddedSdkHtml: (option: Record<string, unknown>, iframeId: string) => string;
            }
        ).buildEmbeddedSdkHtml({ mode: { type: "02" } }, "eformsign_finalize_iframe");

        const win: Record<string, unknown> = {};
        const onSuccess = extractSuccessCallback(html)(win);

        // eformsign fires this callback for non-terminal events too — the
        // top-level 전송 that only opens the confirm popup is one. Latching on
        // it reported a finalize as complete that eformsign never performed.
        onSuccess({ code: "200", type: "document" });
        expect(win["__eformsignSuccess"]).toBeUndefined();

        onSuccess({ code: "-1", document_id: "doc-1" });
        expect(win["__eformsignSuccess"]).toEqual({ code: "-1", document_id: "doc-1" });

        // Both payloads stay on the diagnostic log so a run that never reaches a
        // terminal callback can still say what the SDK did report.
        expect(win["__eformsignSuccessLog"]).toEqual([
            { code: "200", type: "document" },
            { code: "-1", document_id: "doc-1" },
        ]);
    });

    it("dispatchCreation short-circuits vendor stubs without launching Chromium", async () => {
        configGetMock.mockImplementation((key: string) => key === "E2E_VENDOR_STUBS" ? "1" : undefined);
        const onProgress = jest.fn();

        const result = await service.dispatchCreation({
            documentOption: { mode: { type: "01" } },
            onProgress,
        });

        expect(result).toEqual(expect.objectContaining({
            ok: true,
            documentId: expect.stringMatching(/^doc-stub-headless-/),
        }));
        expect(onProgress.mock.calls.map(([step]) => step)).toEqual([
            "client-started",
            "info-inserted",
            "creating",
            "sent",
        ]);
        expect(launchMock).not.toHaveBeenCalled();
    });

    it("dispatchCreation runs the creation gates and returns the SDK document_id", async () => {
        const result = await service.dispatchCreation({
            documentOption: { mode: { type: "01" } },
        });

        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.documentId).toBe("doc-from-callback");
        }
        expect(runEformsignCreationGates).toHaveBeenCalledTimes(1);
        // Authentication piggybacks on documentOption.user.access_token, so
        // exactly one context per dispatch.
        expect(browserMock.newContext).toHaveBeenCalledTimes(1);
    });

    it("launches Chromium headed when EFORMSIGN_BROWSER_HEADLESS=false", async () => {
        process.env["EFORMSIGN_BROWSER_HEADLESS"] = "false";

        const result = await service.dispatchCreation({
            documentOption: { mode: { type: "01" } },
        });

        expect(result.ok).toBe(true);
        expect(launchMock).toHaveBeenCalledWith(expect.objectContaining({
            headless: false,
        }));
    });

    it("dispatchCreation returns ok=false when the SDK success callback never fires", async () => {
        // First waitForFunction (iframe src) resolves; second (terminal SDK callback)
        // rejects to simulate eformsign never confirming dispatch.
        (pageMock.waitForFunction as jest.Mock)
            .mockResolvedValueOnce(undefined)
            .mockRejectedValueOnce(new Error("Timeout 30000ms exceeded"));

        const result = await service.dispatchCreation({ documentOption: { mode: { type: "01" } } });

        expect(result.ok).toBe(false);
        if (!result.ok) {
            // The bare Playwright timeout used to surface here and said nothing
            // about what the SDK had reported, which is what made the finalize
            // false-success incident unexplainable from logs alone.
            expect(result.reason).toContain("no terminal callback");
            expect(result.reason).toContain("Observed success callbacks");
        }
    });

    it("dispatchCreation returns ok=false when the SDK error callback fires", async () => {
        pageMock.evaluate = jest.fn().mockImplementation((fn: unknown) => {
            const source = String(fn);
            if (source.includes("__eformsignSuccess") && source.includes("__eformsignError")) {
                return Promise.resolve({
                    hasSuccess: false,
                    hasError: true,
                    error: { code: "EFORM_TEST", message: "request rejected" },
                });
            }
            if (source.includes("__eformsignSuccess")) {
                return Promise.resolve(false);
            }
            return Promise.resolve(undefined);
        });

        const result = await service.dispatchCreation({ documentOption: { mode: { type: "01" } } });

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.reason).toContain("eformsign SDK error");
            expect(result.reason).toContain("request rejected");
        }
    });

    it("dispatchCreation falls back to ok=false when the gate runner throws", async () => {
        pageMock.evaluate = jest.fn().mockImplementation((fn: unknown) => {
            const source = String(fn);
            if (source.includes("__eformsignSuccess") && source.includes("__eformsignError")) {
                return Promise.resolve({ hasSuccess: false, hasError: false });
            }
            if (source.includes("__eformsignSuccess")) return Promise.resolve(false);
            return Promise.resolve(undefined);
        });
        (runEformsignCreationGates as jest.Mock).mockRejectedValueOnce(new Error("selector miss"));

        const result = await service.dispatchCreation({ documentOption: { mode: { type: "01" } } });

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.reason).toContain("selector miss");
        }
    });

    it("recovers a creation when a no-popup template returns a terminal document id", async () => {
        (runEformsignCreationGates as jest.Mock).mockRejectedValueOnce(
            new Error("confirmation popup timed out twice"),
        );
        const onProgress = jest.fn();

        await expect(service.dispatchCreation({
            documentOption: { mode: { type: "01" } },
            onProgress,
        })).resolves.toEqual(expect.objectContaining({
            ok: true,
            documentId: "doc-from-callback",
            gateOutcome: "success-latched",
        }));
        expect(onProgress).toHaveBeenCalledWith("sent");
    });

    it("dispatchFinalize calls the finalize gate runner", async () => {
        const result = await service.dispatchFinalize({
            documentOption: { mode: { type: "02", document_id: "doc-9" } },
            documentId: "doc-9",
        });

        expect(result.ok).toBe(true);
        if (result.ok) {
            // SDK callback is preferred; falls back to the param when the callback omits the id.
            expect(result.documentId).toBe("doc-from-callback");
        }
        expect(runEformsignFinalizeGates).toHaveBeenCalledTimes(1);
    });

    it("dispatchFinalize forwards onProgress and emits client-started + sent", async () => {
        const onProgress = jest.fn();
        (runEformsignFinalizeGates as jest.Mock).mockImplementationOnce(
            async (
                _page: unknown,
                _frame: unknown,
                _logger: unknown,
                cb?: (step: string) => void,
            ) => {
                cb?.("info-inserted");
                cb?.("creating");
                return "success-latched";
            },
        );

        const result = await service.dispatchFinalize({
            documentOption: { mode: { type: "02", document_id: "doc-9" } },
            documentId: "doc-9",
            onProgress,
        });

        expect(result.ok).toBe(true);
        // Driver emits client-started after iframe boot, then forwards
        // info-inserted/creating from the gate runner, then sent on success.
        expect(onProgress).toHaveBeenCalledWith("client-started");
        expect(onProgress).toHaveBeenCalledWith("info-inserted");
        expect(onProgress).toHaveBeenCalledWith("creating");
        expect(onProgress).toHaveBeenCalledWith("sent");
        const gateCallArgs = (runEformsignFinalizeGates as jest.Mock).mock.calls[0];
        expect(typeof gateCallArgs[3]).toBe("function");
    });
});
