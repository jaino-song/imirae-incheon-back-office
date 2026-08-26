import Foundation
import shared

enum IOSApiEndpointConfiguration {
    private static let infoPlistKey = "API_BASE_URL"

    static func requireBaseURL(bundle: Bundle = .main) -> String {
        let configuredBaseURL = bundle.object(forInfoDictionaryKey: infoPlistKey) as? String

        #if targetEnvironment(simulator)
        let platform = ApiEndpointPlatform.iosSimulator
        #else
        let platform = ApiEndpointPlatform.iosDevice
        #endif

        #if DEBUG
        let buildVariant = ApiBuildVariant.debug
        #else
        let buildVariant = ApiBuildVariant.release_
        #endif

        guard let baseURL = ApiEndpointConfiguration.shared.resolveOrNull(
            rawUrl: configuredBaseURL,
            platform: platform,
            buildVariant: buildVariant
        ) else {
            // Do not include the configured value in a crash message: build
            // settings can accidentally contain credentials or private hosts.
            fatalError("Invalid API endpoint configuration")
        }

        return baseURL
    }
}
