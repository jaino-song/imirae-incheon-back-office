import SwiftUI
import UserNotifications
import shared
#if canImport(UIKit)
import UIKit
#endif

#if canImport(UIKit)
private enum AppConstants {
    static let allowedDeepLinkHosts: Set<String> = [
        "imirae-incheon.vercel.app",
        "app.imirae-incheon.com"
    ]
}

@main
struct ImiraeIncheonApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var deepLinkHandler = DeepLinkHandler.shared

    var body: some Scene {
        WindowGroup {
            AppNavigation(deepLinkHandler: deepLinkHandler)
                .environmentObject(deepLinkHandler)
                .onOpenURL { url in
                    deepLinkHandler.handle(url: url)
                }
        }
    }
}

final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        #if DEBUG
        SafeLogger.shared.configureIos(debugBuild: true)
        #else
        SafeLogger.shared.configureIos(debugBuild: false)
        #endif

        AppBootstrapper.shared.initializeKoin()
        configurePushNotifications()

        if let remotePayload = launchOptions?[.remoteNotification] as? [AnyHashable: Any] {
            forwardDeepLink(from: remotePayload)
        }

        return true
    }

    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        APNsDelegate.shared.didRegisterForRemoteNotifications(deviceToken: deviceToken)
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        APNsDelegate.shared.didFailToRegisterForRemoteNotifications(error: error)
    }

    private func configurePushNotifications() {
        UNUserNotificationCenter.current().delegate = APNsDelegate.shared
        // Permission and receipt handling remain local-only until the mobile
        // APNs/FCM token backend contract is implemented. Do not register a
        // provider token or send one to the browser Web Push endpoint.
        APNsDelegate.shared.requestPermission { _ in }
    }

    private func forwardDeepLink(from payload: [AnyHashable: Any]) {
        guard let deepLink = payload["deepLink"] as? String ?? payload["link"] as? String else {
            return
        }

        guard let url = URL(string: deepLink) else {
            return
        }

        // Deliver directly to the shared handler so cold-start notification
        // payloads are retained before SwiftUI installs its observers.
        Task { @MainActor in
            DeepLinkHandler.shared.handle(url: url)
        }

    }
}

@MainActor
final class DeepLinkHandler: ObservableObject {
    static let shared = DeepLinkHandler()

    @Published private(set) var lastDeepLink: URL?
    @Published private(set) var pendingRoute: String?

    private let router = DeepLinkRouter()

    func handle(url: URL) {
        guard isSupported(url: url), let route = router.routePath(uri: url.absoluteString) else {
            // Fail closed and discard any stale pending protected destination.
            pendingRoute = nil
            return
        }

        if pendingRoute == route, lastDeepLink == url {
            return
        }

        lastDeepLink = url
        pendingRoute = route
        NotificationCenter.default.post(
            name: .appDeepLinkReceived,
            object: nil,
            userInfo: ["url": url.absoluteString]
        )
    }

    func consumePendingRoute(_ route: String) {
        guard pendingRoute == route else {
            return
        }
        pendingRoute = nil
    }

    func clearPendingRoute() {
        pendingRoute = nil
    }

    private func isSupported(url: URL) -> Bool {
        if url.scheme == nil {
            // Backend notification payloads may carry the canonical path
            // (for example `/clients/123`) instead of a full URL.
            return url.path.hasPrefix("/")
        }

        if url.scheme == "imirae" {
            return true
        }

        guard url.scheme == "https", let host = url.host else {
            return false
        }

        return AppConstants.allowedDeepLinkHosts.contains(host)
    }
}

private final class AppBootstrapper {
    static let shared = AppBootstrapper()

    private var didInitializeKoin = false

    private init() {}

    func initializeKoin() {
        guard !didInitializeKoin else {
            return
        }

        _ = KoinHelper.shared.authViewModel()
        didInitializeKoin = true
    }
}

extension Foundation.Notification.Name {
    static let deepLinkNotification = Foundation.Notification.Name("DeepLinkNotification")
    static let appDeepLinkReceived = Foundation.Notification.Name("AppDeepLinkReceived")
}
#endif
