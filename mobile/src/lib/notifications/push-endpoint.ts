/**
 * Read the current browser PushSubscription endpoint without waiting for a
 * service worker registration that may not exist in a fresh profile.
 *
 * Logout uses this best-effort hint so the backend can remove only this
 * device's endpoint. The server still has a user-wide cleanup fallback when
 * an endpoint cannot be read.
 */
export async function getCurrentPushEndpoint(): Promise<string | undefined> {
    if (
        typeof navigator === "undefined"
        || !("serviceWorker" in navigator)
    ) {
        return undefined;
    }

    try {
        const registration = await navigator.serviceWorker.getRegistration("/");
        const subscription = await registration?.pushManager.getSubscription();
        return subscription?.endpoint;
    } catch {
        return undefined;
    }
}
