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

    it("retries a timed-out popup send click on the next poll", async () => {
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

        expect(result).toBe("request-send-clicked");
        expect(popupSendButton.click).toHaveBeenCalledTimes(2);
        expect(page.waitForTimeout).toHaveBeenCalledWith(500);
        expect(log).toHaveBeenCalledTimes(1);
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
