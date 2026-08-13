import type { FrameLocator, Locator, Page } from "playwright-core";

import { runEformsignFinalizeGates } from "../../infrastructure/automation/eformsign-finalize-gates";

describe("runEformsignFinalizeGates", () => {
    function visibleLocator(overrides: Partial<Locator> = {}): Locator {
        return {
            isVisible: jest.fn().mockResolvedValue(true),
            isEnabled: jest.fn().mockResolvedValue(true),
            getAttribute: jest.fn().mockResolvedValue(null),
            click: jest.fn().mockResolvedValue(undefined),
            ...overrides,
        } as unknown as Locator;
    }

    function locatorList(items: Locator[]): Locator {
        return {
            count: jest.fn().mockResolvedValue(items.length),
            nth: jest.fn((index: number) => items[index]),
        } as unknown as Locator;
    }

    it("stops for iframe fallback after two pre-send click timeouts", async () => {
        const confirmButton = visibleLocator({
            click: jest.fn().mockRejectedValue(new Error("Timeout 2000ms exceeded")),
        });
        const requestSendDialog = visibleLocator({
            isVisible: jest.fn().mockResolvedValue(false),
            getByRole: jest.fn().mockReturnValue(locatorList([])),
        });
        const body = { evaluate: jest.fn().mockResolvedValue({ visibleButtons: ["확인"] }) };
        const eformsignFrame = {
            locator: jest.fn().mockImplementation((selector: string) =>
                selector === "body" ? body : requestSendDialog,
            ),
            getByRole: jest.fn().mockImplementation(
                (_role: string, options: { name: string }) =>
                    options.name === "확인"
                        ? locatorList([confirmButton])
                        : locatorList([]),
            ),
        } as unknown as FrameLocator;
        const page = {
            evaluate: jest
                .fn()
                .mockResolvedValueOnce({ hasSuccess: false, hasError: false })
                .mockResolvedValueOnce(false)
                .mockResolvedValueOnce({ hasSuccess: false, hasError: false })
                .mockResolvedValueOnce(false)
                .mockResolvedValueOnce({ hasSuccess: false, hasError: false })
                .mockResolvedValueOnce(true),
            waitForTimeout: jest.fn().mockResolvedValue(undefined),
        } as unknown as Page;
        const onProgress = jest.fn();

        await expect(
            runEformsignFinalizeGates(page, eformsignFrame, console, onProgress),
        ).rejects.toThrow(
            "Pre-send eformsign finalize click timed out twice; opening iframe fallback",
        );
        expect(confirmButton.click).toHaveBeenCalledTimes(2);
        expect(onProgress).toHaveBeenCalledTimes(1);
        expect(onProgress).toHaveBeenCalledWith("info-inserted");
    });

    it("retries a missing confirmation popup once, then opens the iframe fallback", async () => {
        const topLevelSendButton = visibleLocator();
        const requestSendDialog = visibleLocator({
            isVisible: jest.fn().mockResolvedValue(false),
            getByRole: jest.fn().mockReturnValue(locatorList([])),
        });
        const eformsignFrame = {
            locator: jest.fn().mockReturnValue(requestSendDialog),
            getByRole: jest.fn().mockImplementation(
                (_role: string, options: { name: string }) =>
                    options.name === "전송"
                        ? locatorList([topLevelSendButton])
                        : locatorList([]),
            ),
        } as unknown as FrameLocator;
        const page = {
            evaluate: jest.fn().mockResolvedValue(false),
            waitForTimeout: jest.fn().mockResolvedValue(undefined),
        } as unknown as Page;
        const onProgress = jest.fn();

        await expect(
            runEformsignFinalizeGates(page, eformsignFrame, console, onProgress),
        ).rejects.toThrow(
            "Pre-send eformsign finalize confirmation popup timed out twice; opening iframe fallback",
        );
        expect(topLevelSendButton.click).toHaveBeenCalledTimes(2);
        expect(onProgress).toHaveBeenCalledWith("info-inserted");
        expect(onProgress).toHaveBeenCalledWith("creating");
    });

    it("clicks the #inputCommentPopup send button instead of retrying top-level send", async () => {
        const popupSendButton = visibleLocator();
        const requestSendDialog = visibleLocator({
            getByRole: jest.fn().mockReturnValue(locatorList([popupSendButton])),
        });
        const eformsignFrame = {
            locator: jest.fn().mockReturnValue(requestSendDialog),
            getByRole: jest.fn(),
        } as unknown as FrameLocator;
        const page = {
            evaluate: jest.fn().mockResolvedValue(false),
            waitForTimeout: jest.fn().mockResolvedValue(undefined),
        } as unknown as Page;
        const log = jest.fn();
        const logger = { log } as unknown as Console;

        const result = await runEformsignFinalizeGates(page, eformsignFrame, logger);

        expect(result).toBe("request-send-clicked");
        expect((eformsignFrame as unknown as { locator: jest.Mock }).locator).toHaveBeenCalledWith(
            "#inputCommentPopup",
        );
        expect(popupSendButton.click).toHaveBeenCalledTimes(1);
        expect((eformsignFrame as unknown as { getByRole: jest.Mock }).getByRole).not.toHaveBeenCalled();
        expect(log).toHaveBeenCalledWith("[finalize-gate] clicked popup 전송");
    });

    it("returns a success latch after top-level send for vendor-state reconciliation", async () => {
        const popupSendButton = visibleLocator({
            isVisible: jest
                .fn()
                .mockResolvedValueOnce(false)
                .mockResolvedValueOnce(true),
        });
        const requestSendDialog = visibleLocator({
            isVisible: jest.fn().mockResolvedValue(false),
            getByRole: jest.fn().mockReturnValue(locatorList([popupSendButton])),
        });
        const topLevelSendButton = visibleLocator();
        const eformsignFrame = {
            locator: jest.fn().mockReturnValue(requestSendDialog),
            getByRole: jest.fn().mockReturnValue(locatorList([topLevelSendButton])),
        } as unknown as FrameLocator;
        const page = {
            evaluate: jest
                .fn()
                .mockResolvedValueOnce({ hasSuccess: false, hasError: false })
                .mockResolvedValueOnce(false)
                .mockResolvedValueOnce({ hasSuccess: true, hasError: false })
                .mockResolvedValueOnce(true),
            waitForTimeout: jest.fn().mockResolvedValue(undefined),
        } as unknown as Page;
        const log = jest.fn();
        const logger = { log } as unknown as Console;

        const result = await runEformsignFinalizeGates(page, eformsignFrame, logger);

        expect(result).toBe("success-latched");
        expect(topLevelSendButton.click).toHaveBeenCalledTimes(1);
        expect(popupSendButton.click).not.toHaveBeenCalled();
        expect(log).toHaveBeenCalledWith(
            expect.stringContaining("[finalize-gate] terminal success latched"),
        );
    });

    it("treats a timed-out popup send click as attempted without clicking twice", async () => {
        const popupSendButton = visibleLocator({
            click: jest
                .fn()
                .mockRejectedValueOnce(new Error("Timeout 2000ms exceeded"))
                .mockResolvedValueOnce(undefined),
        });
        const requestSendDialog = visibleLocator({
            getByRole: jest.fn().mockReturnValue(locatorList([popupSendButton])),
        });
        const eformsignFrame = {
            locator: jest.fn().mockReturnValue(requestSendDialog),
            getByRole: jest.fn(),
        } as unknown as FrameLocator;
        const page = {
            evaluate: jest
                .fn()
                .mockResolvedValueOnce({ hasSuccess: false, hasError: false })
                .mockResolvedValueOnce(false)
                .mockResolvedValueOnce({ hasSuccess: false, hasError: false })
                .mockResolvedValueOnce(false),
            waitForTimeout: jest.fn().mockResolvedValue(undefined),
        } as unknown as Page;
        const log = jest.fn();
        const logger = { log } as unknown as Console;

        const result = await runEformsignFinalizeGates(page, eformsignFrame, logger);

        expect(result).toBe("request-send-attempted");
        expect(popupSendButton.click).toHaveBeenCalledTimes(1);
        expect(log).toHaveBeenCalledTimes(1);
        expect(log).toHaveBeenCalledWith(
            "[finalize-gate] popup 전송 click outcome is ambiguous; reconciling without retry",
        );
    });

    it("uses the finalize dialog selector in an abort snapshot", async () => {
        const snapshot = {
            visibleButtons: ["전송"],
            guideButtonLabel: null,
            footerMessages: ["필수 입력 항목(1)"],
            requestSendDialogVisible: true,
        };
        const body = {
            evaluate: jest.fn().mockResolvedValue(snapshot),
        };
        const eformsignFrame = {
            locator: jest.fn().mockImplementation((selector: string) => {
                if (selector === "body") return body;
                return visibleLocator();
            }),
        } as unknown as FrameLocator;
        const page = {
            evaluate: jest.fn().mockResolvedValue({
                hasSuccess: false,
                hasError: true,
                error: { message: "request rejected" },
            }),
        } as unknown as Page;

        await expect(runEformsignFinalizeGates(page, eformsignFrame)).rejects.toThrow(
            `Snapshot: ${JSON.stringify(snapshot)}`,
        );
        expect(body.evaluate).toHaveBeenCalledWith(
            expect.any(Function),
            expect.objectContaining({
                requestDialogSelector: "#inputCommentPopup",
            }),
            { timeout: 3_000 },
        );
    });
});
