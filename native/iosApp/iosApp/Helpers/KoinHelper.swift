import Foundation
import shared

struct SharedViewModels {
    let auth: AuthViewModel
    let dashboard: DashboardViewModel
    let clientList: ClientListViewModel
    let clientDetail: ClientDetailViewModel
    let employeeList: EmployeeListViewModel
    let contractList: ContractListViewModel
    let messageTemplate: MessageTemplateViewModel
    let chat: ChatViewModel
    let fileList: FileListViewModel
    let settings: SettingsViewModel
    let admin: AdminViewModel
}

class KoinHelper {
    static let shared = KoinHelper()

    private init() {}

    private lazy var secureStorage: IosSecureStorage = IosSecureStorage()
    private lazy var apiBaseURL: String = IOSApiEndpointConfiguration.requireBaseURL()
    private lazy var anonymousApiClient: ApiClient = ApiClient(baseUrl: apiBaseURL, tokenProvider: nil)
    private lazy var authService: AuthServiceImpl = AuthServiceImpl(apiClient: anonymousApiClient)
    private lazy var authManager: AuthManager = AuthManager(
        authService: authService,
        secureStorage: secureStorage,
        apiBaseUrl: apiBaseURL
    )
    private lazy var authenticatedApiClient: ApiClient = ApiClient(baseUrl: apiBaseURL, tokenProvider: authManager)

    private lazy var clientService: ClientServiceImpl = ClientServiceImpl(apiClient: authenticatedApiClient)
    private lazy var employeeService: EmployeeServiceImpl = EmployeeServiceImpl(apiClient: authenticatedApiClient)
    private lazy var documentService: DocumentServiceImpl = DocumentServiceImpl(apiClient: authenticatedApiClient)

    func authViewModel() -> AuthViewModel {
        AuthViewModel(authManager: authManager)
    }

    func dashboardViewModel() -> DashboardViewModel {
        DashboardViewModel(
            clientService: clientService,
            employeeService: employeeService,
            documentService: documentService
        )
    }

    func clientListViewModel() -> ClientListViewModel {
        ClientListViewModel(clientService: clientService)
    }

    func clientDetailViewModel() -> ClientDetailViewModel {
        ClientDetailViewModel(clientService: clientService, documentService: documentService)
    }

    func employeeListViewModel() -> EmployeeListViewModel {
        EmployeeListViewModel(employeeService: employeeService)
    }

    func contractListViewModel() -> ContractListViewModel {
        ContractListViewModel(documentService: documentService)
    }

    func allViewModels() -> SharedViewModels {
        SharedViewModels(
            auth: authViewModel(),
            dashboard: dashboardViewModel(),
            clientList: clientListViewModel(),
            clientDetail: clientDetailViewModel(),
            employeeList: employeeListViewModel(),
            contractList: contractListViewModel(),
            messageTemplate: messageTemplateViewModel(),
            chat: chatViewModel(),
            fileList: fileListViewModel(),
            settings: settingsViewModel(),
            admin: adminViewModel()
        )
    }
}
