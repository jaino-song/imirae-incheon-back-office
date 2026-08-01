import * as webpush from "web-push";

import { WebPushAdapter } from "../web-push.adapter";

jest.mock("web-push", () => ({
    setVapidDetails: jest.fn(),
    sendNotification: jest.fn(),
}));

describe("WebPushAdapter", () => {
    const configService = {
        get: jest.fn((key: string) => ({
            VAPID_PUBLIC_KEY: "public-key",
            VAPID_PRIVATE_KEY: "private-key",
            VAPID_EMAIL: "admin@example.com",
        })[key]),
    };

    afterEach(() => {
        delete process.env["PWA_NOTIFICATIONS_ENABLED"];
        jest.clearAllMocks();
    });

    it("does not expose or send push notifications when globally disabled", async () => {
        process.env["PWA_NOTIFICATIONS_ENABLED"] = "false";
        const adapter = new WebPushAdapter(configService as never);

        expect(adapter.isEnabled()).toBe(false);
        expect(adapter.getVapidPublicKey()).toBe("");
        await expect(adapter.sendNotificationToMany([], "payload")).resolves.toEqual(new Map());
        expect(webpush.setVapidDetails).not.toHaveBeenCalled();
        expect(webpush.sendNotification).not.toHaveBeenCalled();
    });
});
