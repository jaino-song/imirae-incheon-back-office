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

    it("stops for iframe fallback after two pre-send click timeouts", async () => {
        const startButton = visibleLocator({
            click: jest.fn().mockRejectedValue(new Error("Timeout 2000ms exceeded")),
        });
        const requestSendDialog = visibleLocator({
            isVisible: jest.fn().mockResolvedValue(false),
            getByRole: jest.fn().mockReturnValue(locatorList([])),
        });
        const body = { evaluate: jest.fn().mockResolvedValue({ visibleButtons: ["입력 시작"] }) };
        const eformsignFrame = {
            locator: jest.fn().mockImplementation((selector: string) =>
                selector === "body" ? body : requestSendDialog,
            ),
            getByRole: jest.fn().mockImplementation(
                (_role: string, options: { name: string }) =>
                    options.name === "입력 시작"
                        ? locatorList([startButton])
                        : locatorList([]),
            ),
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
                .mockResolvedValueOnce(true),
            waitForTimeout: jest.fn().mockResolvedValue(undefined),
        } as unknown as Page;

        await expect(runEformsignCreationGates(page, eformsignFrame)).rejects.toThrow(
            "Pre-send eformsign creation click timed out twice; opening iframe fallback",
        );
        expect(startButton.click).toHaveBeenCalledTimes(2);
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
            getByText: jest.fn().mockReturnValue(locatorList([])),
        } as unknown as FrameLocator;
        const page = {
            evaluate: jest.fn().mockResolvedValue(false),
            waitForTimeout: jest.fn().mockResolvedValue(undefined),
        } as unknown as Page;
        const onProgress = jest.fn();

        await expect(
            runEformsignCreationGates(page, eformsignFrame, console, onProgress),
        ).rejects.toThrow(
            "Pre-send eformsign creation confirmation popup timed out twice; opening iframe fallback",
        );
        expect(topLevelSendButton.click).toHaveBeenCalledTimes(2);
        expect(onProgress).not.toHaveBeenCalledWith("creating");
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

        expect(result).toBe("request-send-attempted");
        expect((eformsignFrame as unknown as { locator: jest.Mock }).locator).toHaveBeenCalledWith(
            "#requestWithInputCommentPopup",
        );
        expect(popupSendButton.click).toHaveBeenCalledTimes(1);
        expect(frameGetByRole).not.toHaveBeenCalledWith("button", { name: "전송" });
        expect(log).toHaveBeenCalledTimes(1);
        expect(log).toHaveBeenCalledWith(
            "[creation-gate] popup 전송 click outcome is ambiguous; reconciling without retry",
        );
    });

    it("keeps advancing to popup send when the SDK latches success after top-level send", async () => {
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
                .mockResolvedValueOnce({ hasSuccess: true, hasError: false })
                .mockResolvedValueOnce(true),
            waitForTimeout: jest.fn().mockResolvedValue(undefined),
        } as unknown as Page;
        const log = jest.fn();
        const logger = { log } as unknown as Console;

        const result = await runEformsignCreationGates(page, eformsignFrame, logger);

        expect(result).toBe("request-send-clicked");
        expect(topLevelSendButton.click).toHaveBeenCalledTimes(1);
        expect(popupSendButton.click).toHaveBeenCalledTimes(1);
        expect(log).toHaveBeenCalledWith(
            "[creation-gate] ignoring SDK success latched before popup 전송",
        );
    });

    it("accepts a direct-send template only when the terminal callback has a document id", async () => {
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
            getByText: jest.fn().mockReturnValue(locatorList([])),
        } as unknown as FrameLocator;
        const page = {
            evaluate: jest.fn()
                .mockResolvedValueOnce({ hasSuccess: false, hasError: false })
                .mockResolvedValueOnce(false)
                .mockResolvedValueOnce({ hasSuccess: true, hasError: false })
                .mockResolvedValueOnce(true)
                .mockResolvedValueOnce({
                    hasSuccess: true,
                    hasError: false,
                    success: { code: "-1", document_id: "created-directly" },
                }),
            waitForTimeout: jest.fn().mockResolvedValue(undefined),
        } as unknown as Page;

        await expect(runEformsignCreationGates(page, eformsignFrame)).resolves.toBe(
            "success-latched",
        );
        expect(topLevelSendButton.click).toHaveBeenCalledTimes(1);
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
