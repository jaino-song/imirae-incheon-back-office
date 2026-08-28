import Foundation
import shared

/// Bridges a Kotlin StateFlow to Swift without relying on an AsyncSequence
/// adapter that is not exposed by the generated KMP framework.
final class IOSStateFlowCollector: NSObject, Kotlinx_coroutines_coreFlowCollector {
    private let onValue: (Any?) -> Void
    private(set) var isActive = true

    init(onValue: @escaping (Any?) -> Void) {
        self.onValue = onValue
    }

    func emit(value: Any?, completionHandler: @escaping (Error?) -> Void) {
        if isActive {
            onValue(value)
        }
        completionHandler(nil)
    }

    func stop() {
        isActive = false
    }
}
