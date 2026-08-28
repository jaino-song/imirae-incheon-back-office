import Foundation
import shared

struct SharedViewModels {
    let auth: AuthViewModel
    let dashboard: DashboardViewModel
    let clientList: ClientListViewModel
    let clientDetail: ClientDetailViewModel
    let employeeList: EmployeeListViewModel
    let employeeDetail: EmployeeDetailViewModel
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

    private lazy var secureStorage: SecureStorage = SecureStorage()
    private lazy var apiBaseURL: String = IOSApiEndpointConfiguration.requireBaseURL()
    private lazy var anonymousApiClient: ApiClient = ApiClient(baseUrl: apiBaseURL, tokenProvider: nil)
    private lazy var authService: AuthServiceImpl = AuthServiceImpl(client: anonymousApiClient)
    private lazy var authManager: AuthManager = AuthManager(
        authService: authService,
        secureStorage: secureStorage,
        apiBaseUrl: apiBaseURL
    )
    private lazy var authenticatedApiClient: ApiClient = ApiClient(baseUrl: apiBaseURL, tokenProvider: authManager)

    private lazy var clientService: ClientServiceImpl = ClientServiceImpl(client: authenticatedApiClient)
    private lazy var employeeService: EmployeeServiceImpl = EmployeeServiceImpl(client: authenticatedApiClient)
    private lazy var documentService: DocumentServiceImpl = DocumentServiceImpl(client: authenticatedApiClient)

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
        ClientDetailViewModel(clientService: clientService)
    }

    func employeeListViewModel() -> EmployeeListViewModel {
        EmployeeListViewModel(employeeService: employeeService)
    }

    func employeeDetailViewModel() -> EmployeeDetailViewModel {
        EmployeeDetailViewModel(employeeService: employeeService)
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
            employeeDetail: employeeDetailViewModel(),
            contractList: contractListViewModel(),
            messageTemplate: messageTemplateViewModel(),
            chat: chatViewModel(),
            fileList: fileListViewModel(),
            settings: settingsViewModel(),
            admin: adminViewModel()
        )
    }
}
