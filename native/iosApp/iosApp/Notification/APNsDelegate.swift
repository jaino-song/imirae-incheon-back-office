import Foundation
import UserNotifications
import shared

/// APNs delegate for iOS push notification handling.
/// Handles permission and foreground/background/terminated notification events.
class APNsDelegate: NSObject, UNUserNotificationCenterDelegate {
    static let shared = APNsDelegate()

    private override init() {
        super.init()
    }

    // MARK: - Permission Request

    func requestPermission(completion: @escaping (Bool) -> Void) {
        UNUserNotificationCenter.current().requestAuthorization(
            options: [.alert, .badge, .sound]
        ) { granted, error in
            DispatchQueue.main.async {
                if error != nil {
                    SafeLogger.shared.notificationPermissionFailed()
                    completion(false)
                    return
                }
                completion(granted)
            }
        }
    }

    // MARK: - Remote Notification Registration

    func didRegisterForRemoteNotifications(deviceToken _: Data) {
        SafeLogger.shared.apnsRegistered()
        // Native token registration remains unsupported until the CR-PUSH
        // mobile-token backend contract is implemented. Do not persist or
        // forward the provider token here.
    }

    func didFailToRegisterForRemoteNotifications(error: Error) {
        SafeLogger.shared.apnsRegistrationFailed()
    }

    // MARK: - UNUserNotificationCenterDelegate

    /// Called when notification received while app is in foreground
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        SafeLogger.shared.notificationReceived()

        // Show banner even in foreground
        completionHandler([.banner, .badge, .sound])
    }

    /// Called when user taps on notification
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let userInfo = response.notification.request.content.userInfo
        SafeLogger.shared.notificationTapped()

        // Extract deep link and route
        if let deepLink = userInfo["deepLink"] as? String ?? userInfo["link"] as? String {
            if let url = URL(string: deepLink) {
                Task { @MainActor in
                    DeepLinkHandler.shared.handle(url: url)
                }
            }
        }

        completionHandler()
    }
}
