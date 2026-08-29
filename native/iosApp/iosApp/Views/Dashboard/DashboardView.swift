import SwiftUI
import shared

struct DashboardView: View {
    @StateObject private var viewModel = DashboardViewModelWrapper()

    var onNavigateToClients: () -> Void = {}
    var onNavigateToEmployees: () -> Void = {}
    var onNavigateToContracts: () -> Void = {}
    var onNavigateToClientDetail: (Int32) -> Void = { _ in }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: AppTheme.Spacing.lg) {
                Text("대시보드")
                    .font(.appHeading2)
                    .fontWeight(.bold)
                    .accessibilityIdentifier("dashboard-title")

                if viewModel.isLoading && viewModel.stats == nil {
                    LoadingView()
                        .frame(minHeight: 180)
                } else if let errorMessage = viewModel.errorMessage {
                    ErrorView(message: errorMessage) {
                        viewModel.loadDashboard()
                    }
                    .frame(minHeight: 180)
                } else if let stats = viewModel.stats {
                    statsGrid(stats: stats)

                    Text("최근 고객")
                        .font(.appHeading4)
                        .fontWeight(.semibold)

                    if viewModel.recentClients.isEmpty {
                        EmptyView_(message: "최근 고객이 없습니다")
                            .frame(minHeight: 120)
                    } else {
                        LazyVStack(spacing: AppTheme.Spacing.sm) {
                            ForEach(viewModel.recentClients, id: \.id) { client in
                                Button(action: { onNavigateToClientDetail(client.id) }) {
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
                                .accessibilityIdentifier("dashboard-recent-client-\(client.id)")
                            }
                        }
                    }
                }
            }
            .padding(AppTheme.Spacing.lg)
        }
        .background(Color.appBackground)
        .onAppear {
            viewModel.loadDashboard()
        }
        .accessibilityIdentifier("dashboard-screen")
    }

    @ViewBuilder
    private func statsGrid(stats: DashboardStats) -> some View {
        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: AppTheme.Spacing.md) {
            StatCard(
                title: "고객",
                value: String(stats.totalClients),
                icon: "person.2.fill",
                color: .appPrimary,
                onTap: onNavigateToClients,
                identifier: "dashboard-stat-clients"
            )
            StatCard(
                title: "직원",
                value: String(stats.totalEmployees),
                icon: "person.badge.shield.checkmark.fill",
                color: .appSecondary,
                onTap: onNavigateToEmployees,
                identifier: "dashboard-stat-employees"
            )
            StatCard(
                title: "활성 계약",
                value: stats.contractsSupported ? String(stats.activeContracts) : "—",
                icon: "doc.text.fill",
                color: .appSuccess,
                onTap: onNavigateToContracts,
                identifier: "dashboard-stat-active-contracts"
            )
            StatCard(
                title: "대기 계약",
                value: stats.contractsSupported ? String(stats.pendingContracts) : "—",
                icon: "clock.fill",
                color: Color(hex: "F59E0B"),
                onTap: onNavigateToContracts,
                identifier: "dashboard-stat-pending-contracts"
            )
        }
    }
}

private struct StatCard: View {
    let title: String
    let value: String
    let icon: String
    let color: Color
    var onTap: () -> Void = {}
    var identifier: String = ""

    var body: some View {
        Button(action: onTap) {
            VStack(alignment: .leading, spacing: AppTheme.Spacing.sm) {
                Image(systemName: icon)
                    .font(.appHeading4)
                    .foregroundColor(color)
                Text(value)
                    .font(.appHeading3)
                    .fontWeight(.bold)
                    .foregroundColor(.appForeground)
                Text(title)
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
        .accessibilityIdentifier(identifier)
    }
}

@MainActor
final class DashboardViewModelWrapper: ObservableObject {
    private let viewModel: DashboardViewModel
    private var stateCollector: IOSStateFlowCollector?

    @Published var isLoading: Bool = true
    @Published var stats: DashboardStats?
    @Published var recentClients: [Client] = []
    @Published var errorMessage: String?

    init(viewModel: DashboardViewModel = KoinHelper.shared.dashboardViewModel()) {
        self.viewModel = viewModel
        observeUiState()
    }

    deinit {
        stateCollector?.stop()
    }

    private func observeUiState() {
        let collector = IOSStateFlowCollector { [weak self] value in
            guard let state = value as? DashboardUiState else { return }
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.isLoading = state.isLoading
                self.stats = state.isLoading && state.stats.totalClients == 0 && state.stats.totalEmployees == 0 && state.stats.totalDocuments == 0 ? nil : state.stats
                self.recentClients = state.recentClients
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

    func loadDashboard() {
        viewModel.loadDashboard()
    }
}
