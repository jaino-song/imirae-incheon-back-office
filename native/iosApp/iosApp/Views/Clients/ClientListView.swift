import SwiftUI
import shared

struct ClientListView: View {
    @StateObject private var viewModel = ClientListViewModelWrapper()
    @State private var searchQuery = ""
    @State private var statusFilter: String?

    var onNavigateToDetail: (Int32) -> Void = { _ in }
    var onNavigateToNew: () -> Void = {}

    var body: some View {
        VStack(alignment: .leading, spacing: AppTheme.Spacing.md) {
            HStack {
                Text("고객 관리")
                    .font(.appHeading2)
                    .fontWeight(.bold)
                    .accessibilityIdentifier("client-list-title")
                Spacer()
                Button(action: onNavigateToNew) {
                    Image(systemName: "plus.circle.fill")
                        .font(.appHeading4)
                        .foregroundColor(.appPrimary)
                }
                .accessibilityIdentifier("client-list-add-button")
            }

            AppSearchBar(query: $searchQuery, placeholder: "고객 검색...")
                .onChange(of: searchQuery) { _, value in
                    viewModel.search(value)
                }

            FilterChipRow(
                filters: [(nil, "전체"), ("pre_booking", "예약 전"), ("waiting", "대기"), ("active", "진행 중"), ("completed", "완료")],
                selectedFilter: $statusFilter
            )
            .onChange(of: statusFilter) { _, value in
                viewModel.filterByStatus(value)
            }

            Text("총 \(viewModel.totalCount)명")
                .font(.appCaption)
                .foregroundColor(.appMutedForeground)

            Group {
                if viewModel.isLoading && viewModel.clients.isEmpty {
                    LoadingView()
                } else if let errorMessage = viewModel.errorMessage, viewModel.clients.isEmpty {
                    ErrorView(message: errorMessage) {
                        viewModel.refresh()
                    }
                } else if viewModel.filteredClients.isEmpty {
                    EmptyView_(message: "등록된 고객이 없습니다")
                } else {
                    ScrollView {
                        LazyVStack(spacing: AppTheme.Spacing.sm) {
                            ForEach(viewModel.filteredClients, id: \.id) { client in
                                Button(action: { onNavigateToDetail(client.id) }) {
                                    HStack(spacing: AppTheme.Spacing.md) {
                                        VStack(alignment: .leading, spacing: AppTheme.Spacing.xs) {
                                            Text(client.name)
                                                .font(.appBody)
                                                .fontWeight(.semibold)
                                                .foregroundColor(.appForeground)
                                            if let phone = client.phone, !phone.isEmpty {
                                                Text(phone)
                                                    .font(.appCaption)
                                                    .foregroundColor(.appMutedForeground)
                                            }
                                        }
                                        Spacer()
                                        Text(statusLabel(client.serviceStatus))
                                            .font(.appCaption)
                                            .foregroundColor(.appPrimary)
                                        Image(systemName: "chevron.right")
                                            .font(.appCaption)
                                            .foregroundColor(.appMutedForeground)
                                    }
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .padding(AppTheme.Spacing.lg)
                                    .background(Color.appCard)
                                    .overlay(
                                        RoundedRectangle(cornerRadius: AppTheme.Radius.lg)
                                            .stroke(Color.appBorder, lineWidth: 1)
                                    )
                                    .cornerRadius(AppTheme.Radius.lg)
                                }
                                .buttonStyle(.plain)
                                .accessibilityIdentifier("client-item-\(client.id)")
                            }
                        }
                    }
                }
            }
        }
        .padding(AppTheme.Spacing.lg)
        .background(Color.appBackground)
        .onAppear {
            viewModel.loadClients()
        }
        .accessibilityIdentifier("client-list-screen")
    }

    private func statusLabel(_ status: String?) -> String {
        switch status {
        case "pre_booking": return "예약 전"
        case "waiting": return "대기"
        case "active": return "진행 중"
        case "completed": return "완료"
        default: return status ?? "상태 없음"
        }
    }
}

@MainActor
final class ClientListViewModelWrapper: ObservableObject {
    private let viewModel: ClientListViewModel
    private var stateCollector: IOSStateFlowCollector?

    @Published var isLoading: Bool = true
    @Published var clients: [Client] = []
    @Published var filteredClients: [Client] = []
    @Published var totalCount: Int32 = 0
    @Published var errorMessage: String?
    @Published var isCreating: Bool = false
    @Published var createSuccess: Bool = false

    init(viewModel: ClientListViewModel = KoinHelper.shared.clientListViewModel()) {
        self.viewModel = viewModel
        observeUiState()
    }

    deinit {
        stateCollector?.stop()
    }

    private func observeUiState() {
        let collector = IOSStateFlowCollector { [weak self] value in
            guard let state = value as? ClientListUiState else { return }
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.isLoading = state.isLoading
                self.clients = state.clients
                self.filteredClients = state.filteredClients
                self.totalCount = state.totalCount
                self.errorMessage = state.error
                self.isCreating = state.isCreating
                self.createSuccess = state.createSuccess
            }
        }
        stateCollector = collector
        viewModel.uiState.collect(collector: collector) { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.stateCollector?.stop()
            }
        }
    }

    func loadClients() {
        viewModel.loadClients(page: 1)
    }

    func search(_ query: String) {
        viewModel.search(query: query)
    }

    func filterByStatus(_ status: String?) {
        viewModel.filterByStatus(status: status)
    }

    func refresh() {
        viewModel.refresh()
    }

    func createClient(_ request: CreateClientRequest) {
        viewModel.createClient(request: request)
    }
}
