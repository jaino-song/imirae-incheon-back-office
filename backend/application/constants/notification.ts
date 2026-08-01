export function isNotificationEmailEnabled(): boolean {
    return process.env["NOTIFICATION_EMAIL_ENABLED"] === "true";
}

export function isPwaNotificationsEnabled(): boolean {
    return process.env["PWA_NOTIFICATIONS_ENABLED"] === "true";
}
