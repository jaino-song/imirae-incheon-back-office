import SwiftUI
import shared

enum AppRoute: Hashable {
    case login
    case register
    case forgotPassword
    case resetPassword(token: String)
    case verifyEmail
    case selectBranch
    case dashboard
    case clientList
    case clientDetail(id: String)
    case clientNew
    case employeeList
    case contractList
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

    var body: some View {
        NavigationStack(path: $path) {
            LoginView(
                viewModel: authWrapper,
                onNavigateToRegister: { path.append(AppRoute.register) },
                onNavigateToForgotPassword: { path.append(AppRoute.forgotPassword) },
                onNavigateToVerifyEmail: { path.append(AppRoute.verifyEmail) },
                onNavigateToDashboard: { path = NavigationPath(); path.append(AppRoute.dashboard) },
                onNavigateToSelectBranch: { path.append(AppRoute.selectBranch) }
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
                        onNavigateToLogin: { path = NavigationPath() }
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
                    EmployeeListView()
                case .contractList:
                    ContractListView(onNavigateToCreate: { path.append(AppRoute.contractCreate) })
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
                        onLogout: { path = NavigationPath() }
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
                        onNavigateToSelectBranch: { path.append(AppRoute.selectBranch) }
                    )
                }
            }
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
        let secureStorage = IosSecureStorage()
        let apiBaseURL = IOSApiEndpointConfiguration.requireBaseURL()
        let anonymousClient = ApiClient(baseUrl: apiBaseURL, tokenProvider: nil)
        let authService = AuthServiceImpl(apiClient: anonymousClient)
        let authManager = AuthManager(
            authService: authService,
            secureStorage: secureStorage,
            apiBaseUrl: apiBaseURL
        )
        let authenticatedClient = ApiClient(baseUrl: apiBaseURL, tokenProvider: authManager)

        self.templateService = TemplateServiceImpl(apiClient: authenticatedClient)
        self.chatService = ChatServiceImpl(apiClient: authenticatedClient)
        self.fileService = FileServiceImpl(apiClient: authenticatedClient)
        self.settingsService = SettingsServiceImpl(apiClient: authenticatedClient)
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
