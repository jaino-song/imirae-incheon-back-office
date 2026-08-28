import SwiftUI
import shared
import UIKit

enum AppRoute: Hashable {
    case login
    case register
    case forgotPassword
    case resetPassword(token: String)
    case verifyEmail
    case selectBranch
    case dashboard
    case clientList
    case clientDetail(id: Int32)
    case clientNew
    case employeeList
    case employeeDetail(id: Int32)
    case contractList
    case contractDetail(id: String)
    case contractCreate
    // Phase 5 routes
    case messages
    case messageNew
    case messageEdit(id: String)
    case chat
    case files
    case settings
    case voucherPrices
    case admin
}

struct AppNavigation: View {
    @State private var path = NavigationPath()
    @StateObject private var authWrapper = AuthViewModelWrapper()
    @ObservedObject private var deepLinkHandler: DeepLinkHandler
    @State private var pendingDeepLinkPrincipal: String?
    @State private var didRequestSessionRestore = false

    init(deepLinkHandler: DeepLinkHandler) {
        _deepLinkHandler = ObservedObject(wrappedValue: deepLinkHandler)
    }

    var body: some View {
        NavigationStack(path: $path) {
            LoginView(
                viewModel: authWrapper,
                onNavigateToRegister: { path.append(AppRoute.register) },
                onNavigateToForgotPassword: { path.append(AppRoute.forgotPassword) },
                onNavigateToVerifyEmail: { path.append(AppRoute.verifyEmail) },
                onNavigateToDashboard: { path = NavigationPath(); path.append(AppRoute.dashboard) },
                onNavigateToSelectBranch: { path.append(AppRoute.selectBranch) },
                shouldNavigateToDashboard: { deepLinkHandler.pendingRoute == nil }
            )
            .navigationDestination(for: AppRoute.self) { route in
                switch route {
                case .register:
                    RegisterView(onNavigateToLogin: { path.removeLast() })
                case .forgotPassword:
                    ForgotPasswordView(onNavigateBack: { path.removeLast() })
                case .resetPassword(let token):
                    ResetPasswordView(token: token, onNavigateToLogin: { path = NavigationPath() })
                case .verifyEmail:
                    VerifyEmailView(onNavigateToLogin: { path = NavigationPath() })
                case .selectBranch:
                    SelectBranchView(
                        viewModel: authWrapper,
                        onNavigateToDashboard: { path = NavigationPath(); path.append(AppRoute.dashboard) },
                        onNavigateToLogin: { path = NavigationPath() },
                        shouldNavigateToDashboard: { deepLinkHandler.pendingRoute == nil }
                    )
                case .dashboard:
                    DashboardView(
                        onNavigateToClients: { path.append(AppRoute.clientList) },
                        onNavigateToEmployees: { path.append(AppRoute.employeeList) },
                        onNavigateToContracts: { path.append(AppRoute.contractList) },
                        onNavigateToClientDetail: { id in path.append(AppRoute.clientDetail(id: id)) }
                    )
                case .clientList:
                    ClientListView(
                        onNavigateToDetail: { id in path.append(AppRoute.clientDetail(id: id)) },
                        onNavigateToNew: { path.append(AppRoute.clientNew) }
                    )
                case .clientDetail(let id):
                    ClientDetailView(clientId: id, onNavigateBack: { path.removeLast() })
                case .clientNew:
                    ClientNewView(onNavigateBack: { path.removeLast() })
                case .employeeList:
                    EmployeeListView(
                        onNavigateToDetail: { id in path.append(AppRoute.employeeDetail(id: id)) }
                    )
                case .employeeDetail(let id):
                    EmployeeDetailView(employeeId: id, onNavigateBack: { path.removeLast() })
                case .contractList:
                    ContractListView(
                        onNavigateToDetail: { id in path.append(AppRoute.contractDetail(id: id)) },
                        onNavigateToCreate: { path.append(AppRoute.contractCreate) }
                    )
                case .contractDetail(let id):
                    ContractDetailView(documentId: id, onNavigateBack: { path.removeLast() })
                case .contractCreate:
                    ContractCreationView(onNavigateBack: { path.removeLast() })
                // Phase 5 routes
                case .messages:
                    TemplateListView(
                        onNavigateToNew: { path.append(AppRoute.messageNew) },
                        onNavigateToEdit: { id in path.append(AppRoute.messageEdit(id: id)) }
                    )
                case .messageNew:
                    TemplateNewView(onNavigateBack: { path.removeLast() })
                case .messageEdit(let id):
                    TemplateEditView(templateId: id, onNavigateBack: { path.removeLast() })
                case .chat:
                    ChatView()
                case .files:
                    FileListView()
                case .settings:
                    SettingsView(
                        onNavigateToVoucherPrices: { path.append(AppRoute.voucherPrices) },
                        onLogout: { authWrapper.logout() }
                    )
                case .voucherPrices:
                    VoucherPriceView(onNavigateBack: { path.removeLast() })
                case .admin:
                    AdminFeedbackView()
                case .login:
                    LoginView(
                        viewModel: authWrapper,
                        onNavigateToRegister: { path.append(AppRoute.register) },
                        onNavigateToForgotPassword: { path.append(AppRoute.forgotPassword) },
                        onNavigateToVerifyEmail: { path.append(AppRoute.verifyEmail) },
                        onNavigateToDashboard: { path = NavigationPath(); path.append(AppRoute.dashboard) },
                        onNavigateToSelectBranch: { path.append(AppRoute.selectBranch) },
                        shouldNavigateToDashboard: { deepLinkHandler.pendingRoute == nil }
                    )
                }
            }
        }
        .onAppear {
            guard !didRequestSessionRestore else {
                return
            }

            didRequestSessionRestore = true
            authWrapper.restoreSession()
        }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.didBecomeActiveNotification)) { _ in
            authWrapper.onAppResume()
        }
        .onChange(of: authWrapper.authState) { oldState, newState in
            reconcileAuthTransition(from: oldState, to: newState)
        }
        .onChange(of: deepLinkHandler.pendingRoute) { _, _ in
            reconcilePendingDeepLink()
        }
    }

    private func reconcileAuthTransition(from oldState: AuthState, to newState: AuthState) {
        if oldState is AuthState.Authenticated && !(newState is AuthState.Authenticated) {
            // Once a principal leaves the authenticated state, any queued
            // route must not survive a failed refresh into another account.
            deepLinkHandler.clearPendingRoute()
            pendingDeepLinkPrincipal = nil
        }

        if let oldAuthenticated = oldState as? AuthState.Authenticated,
           let newAuthenticated = newState as? AuthState.Authenticated,
           oldAuthenticated.userId != newAuthenticated.userId {
            deepLinkHandler.clearPendingRoute()
            pendingDeepLinkPrincipal = nil
            path = NavigationPath()
            return
        }

        if newState is AuthState.Unauthenticated {
            // A logout or abandoned branch selection must discard routes that
            // were bound to the previous principal.  A link received while
            // already logged out remains queued for the next successful login.
            if oldState is AuthState.Authenticated || oldState is AuthState.RequiresBranchSelection {
                deepLinkHandler.clearPendingRoute()
                pendingDeepLinkPrincipal = nil
            }
            path = NavigationPath()
            return
        }

        reconcilePendingDeepLink()
    }

    private func reconcilePendingDeepLink() {
        guard let canonicalPath = deepLinkHandler.pendingRoute else {
            return
        }

        guard let route = appRoute(for: canonicalPath) else {
            deepLinkHandler.clearPendingRoute()
            pendingDeepLinkPrincipal = nil
            return
        }

        switch authWrapper.authState {
        case let authenticated as AuthState.Authenticated:
            if let pendingDeepLinkPrincipal, pendingDeepLinkPrincipal != authenticated.userId {
                deepLinkHandler.clearPendingRoute()
                self.pendingDeepLinkPrincipal = nil
                return
            }

            if pendingDeepLinkPrincipal == nil {
                pendingDeepLinkPrincipal = authenticated.userId
            }
            path = NavigationPath()
            path.append(route)
            deepLinkHandler.consumePendingRoute(canonicalPath)

        case is AuthState.RequiresBranchSelection:
            path = NavigationPath()
            path.append(AppRoute.selectBranch)

        case is AuthState.Initial, is AuthState.Loading:
            // Keep the one pending route until restore/resume settles.
            return

        case is AuthState.Unauthenticated, is AuthState.Error:
            // The root LoginView remains visible; the route is replayed after
            // the user authenticates, without exposing a protected screen.
            path = NavigationPath()

        default:
            // Unknown future auth states fail closed at the root until the
            // shared lifecycle publishes a supported terminal state.
            path = NavigationPath()
        }
    }

    private func appRoute(for canonicalPath: String) -> AppRoute? {
        let segments = canonicalPath
            .split(separator: "/")
            .map(String.init)

        guard let root = segments.first else {
            return nil
        }

        switch root {
        case "dashboard":
            return segments.count == 1 ? .dashboard : nil
        case "clients":
            if segments.count == 1 {
                return .clientList
            }
            guard segments.count == 2, let id = Int32(segments[1]) else {
                return nil
            }
            return .clientDetail(id: id)
        case "employees":
            if segments.count == 1 {
                return .employeeList
            }
            guard segments.count == 2, let id = Int32(segments[1]) else {
                return nil
            }
            return .employeeDetail(id: id)
        case "contracts":
            if segments.count == 1 {
                return .contractList
            }
            return segments.count == 2 ? .contractDetail(id: segments[1]) : nil
        case "messages":
            if segments.count == 1 {
                return .messages
            }
            return segments.count == 3 && segments[1] == "templates"
                ? .messageEdit(id: segments[2])
                : nil
        case "chat":
            return segments.count == 1 ? .chat : nil
        case "settings":
            return segments.count == 1 ? .settings : nil
        default:
            return nil
        }
    }
}

private final class IOSFeatureDependencyContainer {
    static let shared = IOSFeatureDependencyContainer()

    let templateService: TemplateService
    let chatService: ChatService
    let fileService: FileService
    let settingsService: SettingsService

    private init() {
        let secureStorage = SecureStorage()
        let apiBaseURL = IOSApiEndpointConfiguration.requireBaseURL()
        let anonymousClient = ApiClient(baseUrl: apiBaseURL, tokenProvider: nil)
        let authService = AuthServiceImpl(client: anonymousClient)
        let authManager = AuthManager(
            authService: authService,
            secureStorage: secureStorage,
            apiBaseUrl: apiBaseURL
        )
        let authenticatedClient = ApiClient(baseUrl: apiBaseURL, tokenProvider: authManager)

        self.templateService = TemplateServiceImpl(client: authenticatedClient)
        self.chatService = ChatServiceImpl(client: authenticatedClient)
        self.fileService = FileServiceImpl(client: authenticatedClient)
        self.settingsService = SettingsServiceImpl(client: authenticatedClient)
    }
}

extension KoinHelper {
    func messageTemplateViewModel() -> MessageTemplateViewModel {
        MessageTemplateViewModel(templateService: IOSFeatureDependencyContainer.shared.templateService)
    }

    func chatViewModel() -> ChatViewModel {
        ChatViewModel(chatService: IOSFeatureDependencyContainer.shared.chatService)
    }

    func fileListViewModel() -> FileListViewModel {
        FileListViewModel(fileService: IOSFeatureDependencyContainer.shared.fileService)
    }

    func settingsViewModel() -> SettingsViewModel {
        SettingsViewModel(settingsService: IOSFeatureDependencyContainer.shared.settingsService)
    }

    func adminViewModel() -> AdminViewModel {
        AdminViewModel()
    }
}
