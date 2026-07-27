import type { Locator } from "playwright-core";

import {
    EFORMSIGN_CLICK_TIMEOUT_MS,
    findVisibleEnabledLocator,
    tryClickGateLocator,
} from "../../infrastructure/automation/eformsign-gate-utils";

describe("eformsign gate utils", () => {
    function candidate(overrides: Partial<Locator> = {}): Locator {
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

    it("skips class-disabled and natively disabled candidates", async () => {
        const classDisabled = candidate({
            getAttribute: jest.fn().mockResolvedValue("btn_header_main disabled"),
        });
        const nativeDisabled = candidate({
            isEnabled: jest.fn().mockResolvedValue(false),
        });
        const active = candidate();

        const result = await findVisibleEnabledLocator(
            locatorList([classDisabled, nativeDisabled, active]),
        );

        expect(result).toBe(active);
    });

    it("returns false when a gate click times out so the caller can retry", async () => {
        const locator = candidate({
            click: jest.fn().mockRejectedValue(new Error("Timeout 2000ms exceeded")),
        });

        const result = await tryClickGateLocator(locator);

        expect(result).toBe(false);
        expect(locator.click).toHaveBeenCalledWith({
            timeout: EFORMSIGN_CLICK_TIMEOUT_MS,
        });
    });
});
