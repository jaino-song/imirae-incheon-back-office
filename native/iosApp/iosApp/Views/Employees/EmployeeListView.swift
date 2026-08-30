import SwiftUI
import shared

struct EmployeeListView: View {
    @StateObject private var viewModel = EmployeeListViewModelWrapper()
    @State private var searchQuery = ""
    @State private var statusFilter: String?

    var onNavigateToDetail: (Int32) -> Void = { _ in }

    var body: some View {
        VStack(alignment: .leading, spacing: AppTheme.Spacing.md) {
            Text("직원 관리")
                .font(.appHeading2)
                .fontWeight(.bold)
                .accessibilityIdentifier("employee-list-title")

            AppSearchBar(query: $searchQuery, placeholder: "직원 검색...")
                .onChange(of: searchQuery) { _, value in
                    viewModel.search(value)
                }

            FilterChipRow(
                filters: [(nil, "전체"), ("available", "가능"), ("working", "근무 중"), ("unavailable", "불가")],
                selectedFilter: $statusFilter
            )
            .onChange(of: statusFilter) { _, value in
                viewModel.filterByStatus(value)
            }

            Text("총 \(viewModel.totalCount)명")
                .font(.appCaption)
                .foregroundColor(.appMutedForeground)

            Group {
                if viewModel.isLoading && viewModel.employees.isEmpty {
                    LoadingView()
                } else if let errorMessage = viewModel.errorMessage, viewModel.employees.isEmpty {
                    ErrorView(message: errorMessage) {
                        viewModel.refresh()
                    }
                } else if viewModel.filteredEmployees.isEmpty {
                    EmptyView_(message: "등록된 직원이 없습니다")
                } else {
                    ScrollView {
                        LazyVStack(spacing: AppTheme.Spacing.sm) {
                            ForEach(viewModel.filteredEmployees, id: \.id) { employee in
                                Button(action: { onNavigateToDetail(employee.id) }) {
                                    HStack(spacing: AppTheme.Spacing.md) {
                                        VStack(alignment: .leading, spacing: AppTheme.Spacing.xs) {
                                            Text(employee.name)
                                                .font(.appBody)
                                                .fontWeight(.semibold)
                                                .foregroundColor(.appForeground)
                                            Text(employee.workArea.joined(separator: " · "))
                                                .font(.appCaption)
                                                .foregroundColor(.appMutedForeground)
                                            Text(employee.phone)
                                                .font(.appCaption)
                                                .foregroundColor(.appMutedForeground)
                                        }
                                        Spacer()
                                        Text(statusLabel(employee.status))
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
                                .accessibilityIdentifier("employee-item-\(employee.id)")
                            }
                        }
                    }
                }
            }
        }
        .padding(AppTheme.Spacing.lg)
        .background(Color.appBackground)
        .onAppear {
            viewModel.loadEmployees()
        }
        .accessibilityIdentifier("employee-list-screen")
    }

    private func statusLabel(_ status: String?) -> String {
        switch status {
        case "available": return "가능"
        case "working": return "근무 중"
        case "unavailable": return "불가"
        default: return status ?? "상태 없음"
        }
    }
}

@MainActor
final class EmployeeListViewModelWrapper: ObservableObject {
    private let viewModel: EmployeeListViewModel
    private var stateCollector: IOSStateFlowCollector?

    @Published var isLoading: Bool = true
    @Published var employees: [Employee] = []
    @Published var filteredEmployees: [Employee] = []
    @Published var totalCount: Int32 = 0
    @Published var errorMessage: String?

    init(viewModel: EmployeeListViewModel = KoinHelper.shared.employeeListViewModel()) {
        self.viewModel = viewModel
        observeUiState()
    }

    deinit {
        stateCollector?.stop()
    }

    private func observeUiState() {
        let collector = IOSStateFlowCollector { [weak self] value in
            guard let state = value as? EmployeeListUiState else { return }
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.isLoading = state.isLoading
                self.employees = state.employees
                self.filteredEmployees = state.filteredEmployees
                self.totalCount = state.totalCount
                self.errorMessage = state.error
            }
        }
        stateCollector = collector
        viewModel.uiState.collect(collector: collector) { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.stateCollector?.stop()
            }
        }
    }

    func loadEmployees() {
        viewModel.loadEmployees(page: 1)
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
}
