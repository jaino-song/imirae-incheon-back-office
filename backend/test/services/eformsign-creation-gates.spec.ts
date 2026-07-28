import type { FrameLocator, Locator, Page } from "playwright-core";

import { runEformsignCreationGates } from "../../infrastructure/automation/eformsign-creation-gates";

describe("runEformsignCreationGates", () => {
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

    it("retries a timed-out click on the scoped request dialog send button", async () => {
        const popupSendButton = visibleLocator({
            click: jest
                .fn()
                .mockRejectedValueOnce(new Error("Timeout 2000ms exceeded"))
                .mockResolvedValueOnce(undefined),
        });
        const requestSendDialog = visibleLocator({
            getByRole: jest.fn().mockReturnValue(locatorList([popupSendButton])),
        });
        const frameGetByRole = jest.fn().mockReturnValue(locatorList([]));
        const eformsignFrame = {
            locator: jest.fn().mockReturnValue(requestSendDialog),
            getByRole: frameGetByRole,
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

        const result = await runEformsignCreationGates(page, eformsignFrame, logger);

        expect(result).toBe("request-send-clicked");
        expect((eformsignFrame as unknown as { locator: jest.Mock }).locator).toHaveBeenCalledWith(
            "#requestWithInputCommentPopup",
        );
        expect(popupSendButton.click).toHaveBeenCalledTimes(2);
        expect(frameGetByRole).not.toHaveBeenCalledWith("button", { name: "전송" });
        expect(page.waitForTimeout).toHaveBeenCalledWith(500);
        expect(log).toHaveBeenCalledTimes(1);
        expect(log).toHaveBeenCalledWith("[creation-gate] clicked popup 전송");
    });

    it("waits through a disabled top-level send before clicking the dialog send", async () => {
        const topLevelSendButton = visibleLocator({
            isEnabled: jest
                .fn()
                .mockResolvedValueOnce(true)
                .mockResolvedValueOnce(false),
        });
        const popupSendButton = visibleLocator();
        const requestSendDialog = visibleLocator({
            isVisible: jest
                .fn()
                .mockResolvedValueOnce(false)
                .mockResolvedValueOnce(false)
                .mockResolvedValueOnce(true),
            getByRole: jest
                .fn()
                .mockReturnValueOnce(locatorList([]))
                .mockReturnValueOnce(locatorList([]))
                .mockReturnValueOnce(locatorList([popupSendButton])),
        });
        const frameGetByRole = jest.fn().mockImplementation(
            (_role: string, options: { name: string }) =>
                options.name === "전송"
                    ? locatorList([topLevelSendButton])
                    : locatorList([]),
        );
        const eformsignFrame = {
            locator: jest.fn().mockReturnValue(requestSendDialog),
            getByRole: frameGetByRole,
            getByText: jest.fn().mockReturnValue(locatorList([])),
        } as unknown as FrameLocator;
        const page = {
            evaluate: jest
                .fn()
                .mockResolvedValueOnce({ hasSuccess: false, hasError: false })
                .mockResolvedValueOnce(false)
                .mockResolvedValueOnce({ hasSuccess: false, hasError: false })
                .mockResolvedValueOnce(false)
                .mockResolvedValueOnce({ hasSuccess: false, hasError: false })
                .mockResolvedValueOnce(false),
            waitForTimeout: jest.fn().mockResolvedValue(undefined),
        } as unknown as Page;

        await expect(runEformsignCreationGates(page, eformsignFrame)).resolves.toBe(
            "request-send-clicked",
        );
        expect(topLevelSendButton.click).toHaveBeenCalledTimes(1);
        expect(popupSendButton.click).toHaveBeenCalledTimes(1);
        expect(page.waitForTimeout).toHaveBeenNthCalledWith(1, 250);
        expect(page.waitForTimeout).toHaveBeenNthCalledWith(2, 500);
    });

    it("adds a gate snapshot when an SDK error aborts creation", async () => {
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

        await expect(runEformsignCreationGates(page, eformsignFrame)).rejects.toThrow(
            `Snapshot: ${JSON.stringify(snapshot)}`,
        );
        expect(body.evaluate).toHaveBeenCalledWith(
            expect.any(Function),
            expect.objectContaining({
                requestDialogSelector: "#requestWithInputCommentPopup",
            }),
            { timeout: 3_000 },
        );
    });
});
