import Foundation
import Combine
import shared

private final class StateFlowCollector: NSObject, Kotlinx_coroutines_coreFlowCollector {
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

@MainActor
class AuthViewModelWrapper: ObservableObject {
    private let viewModel: AuthViewModel
    private var authCollector: StateFlowCollector?
    private var branchesCollector: StateFlowCollector?
    @Published var authState: AuthState = AuthState.Initial()
    @Published var isLoading: Bool = false
    @Published var errorMessage: String? = nil
    @Published private(set) var branchSelectionState: BranchSelectionState = .idle

    init(viewModel: AuthViewModel = KoinHelper.shared.authViewModel()) {
        self.viewModel = viewModel
        observeAuthState()
        observeBranchesState()
    }

    deinit {
        authCollector?.stop()
        branchesCollector?.stop()
    }

    private func observeAuthState() {
        let collector = StateFlowCollector { [weak self] value in
            guard let state = value as? AuthState else {
                return
            }

            Task { @MainActor [weak self] in
                guard let self else {
                    return
                }

                self.authState = state
                self.isLoading = state is AuthState.Loading
                if let error = state as? AuthState.Error {
                    self.errorMessage = error.message
                } else {
                    self.errorMessage = nil
                }
            }
        }
        authCollector = collector
        viewModel.authState.collect(collector: collector) { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.authCollector?.stop()
            }
        }
    }

    private func observeBranchesState() {
        let collector = StateFlowCollector { [weak self] value in
            guard let state = value as? BranchesUiState else {
                return
            }

            Task { @MainActor [weak self] in
                self?.branchSelectionState = BranchSelectionState.from(state)
            }
        }
        branchesCollector = collector
        viewModel.branchesState.collect(collector: collector) { [weak self] error in
            Task { @MainActor [weak self] in
                guard let self else {
                    return
                }

                self.branchesCollector?.stop()
                if error != nil {
                    self.branchSelectionState = .error
                }
            }
        }
    }

    func login(email: String, password: String) {
        viewModel.login(email: email, password: password)
    }

    func register(name: String, email: String, password: String, phone: String?) {
        viewModel.register(name: name, email: email, password: password, phone: phone)
    }

    func logout() {
        branchSelectionState = .idle
        viewModel.logout()
    }

    func forgotPassword(email: String) {
        viewModel.forgotPassword(email: email)
    }

    func resetPassword(token: String, password: String) {
        viewModel.resetPassword(token: token, password: password)
    }

    func selectBranch(branchId: String) {
        viewModel.selectBranch(branchId: branchId)
    }

    func loadBranches() {
        // Clear any branch list from a prior authenticated account before the
        // new request starts. The shared StateFlow is intentionally retained,
        // so this local transition prevents stale rows during account switch.
        branchSelectionState = .loading
        viewModel.loadBranches()
    }

    var isAuthenticated: Bool {
        authState is AuthState.Authenticated
    }

    var requiresBranchSelection: Bool {
        authState is AuthState.RequiresBranchSelection
    }
}
