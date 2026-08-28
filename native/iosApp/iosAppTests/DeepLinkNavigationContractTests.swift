import XCTest
import shared

final class DeepLinkNavigationContractTests: XCTestCase {
    func testAllowlistedRouteUsesSharedCanonicalMapping() {
        let router = DeepLinkRouter()

        XCTAssertEqual(
            router.routePath(uri: "https://app.imirae-incheon.com/clients/client-42"),
            "/clients/client-42"
        )
        XCTAssertEqual(
            router.routePath(uri: "imirae://app/messages/templates/template-7"),
            "/messages/templates/template-7"
        )
    }

    func testForeignAndMalformedDestinationsAreRejected() {
        let router = DeepLinkRouter()

        XCTAssertNil(router.routePath(uri: "https://evil.example/clients/client-42"))
        XCTAssertNil(router.routePath(uri: "imirae://app/clients/../../settings"))
    }
}
