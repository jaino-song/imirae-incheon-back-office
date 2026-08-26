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
    @StateObject private var deepLinkHandler = DeepLinkHandler()

    var body: some Scene {
        WindowGroup {
            AppNavigation()
                .environmentObject(deepLinkHandler)
                .onOpenURL { url in
                    deepLinkHandler.handle(url: url)
                }
                .onReceive(NotificationCenter.default.publisher(for: .deepLinkNotification)) { notification in
                    guard let rawURL = notification.userInfo?["url"] as? String,
                        let url = URL(string: rawURL)
                    else {
                        return
                    }
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
        configurePushNotifications(for: application)

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

    private func configurePushNotifications(for application: UIApplication) {
        UNUserNotificationCenter.current().delegate = APNsDelegate.shared

        APNsDelegate.shared.requestPermission { granted in
            guard granted else {
                return
            }
            DispatchQueue.main.async {
                application.registerForRemoteNotifications()
            }
        }
    }

    private func forwardDeepLink(from payload: [AnyHashable: Any]) {
        guard let deepLink = payload["deepLink"] as? String ?? payload["link"] as? String else {
            return
        }

        NotificationCenter.default.post(
            name: .deepLinkNotification,
            object: nil,
            userInfo: ["url": deepLink]
        )
    }
}

@MainActor
final class DeepLinkHandler: ObservableObject {
    @Published private(set) var lastDeepLink: URL?

    func handle(url: URL) {
        guard isSupported(url: url) else {
            return
        }

        lastDeepLink = url
        NotificationCenter.default.post(
            name: .appDeepLinkReceived,
            object: nil,
            userInfo: ["url": url.absoluteString]
        )
    }

    private func isSupported(url: URL) -> Bool {
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

extension Notification.Name {
    static let deepLinkNotification = Notification.Name("DeepLinkNotification")
    static let appDeepLinkReceived = Notification.Name("AppDeepLinkReceived")
}
#endif
