import SwiftUI
import shared

struct SelectBranchView: View {
    @ObservedObject var viewModel: AuthViewModelWrapper
    @State private var hasLoadedBranches = false

    var onNavigateToDashboard: () -> Void = {}
    var onNavigateToLogin: () -> Void = {}

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "building.2.fill")
                .font(.system(size: 48))
                .foregroundColor(.appPrimary)

            Text("지점 선택")
                .font(.appHeading2)
                .fontWeight(.bold)
                .accessibilityIdentifier("auth-select-branch-title")

            Text("사용할 지점을 선택해 주세요.")
                .font(.appBody)
                .foregroundColor(.appMuted)

            branchContent

            if viewModel.authState is AuthState.Error {
                selectionErrorContent
            }
        }
        .padding(24)
        .background(Color.appCard)
        .cornerRadius(CGFloat(AppTheme.Radius.lg))
        .shadow(color: .black.opacity(0.05), radius: 8, y: 4)
        .padding(16)
        .frame(maxWidth: 400)
        .onAppear(perform: loadBranchesIfNeeded)
        .onChange(of: viewModel.authState) { _, newState in
            if newState is AuthState.Authenticated {
                onNavigateToDashboard()
            }
        }
    }

    @ViewBuilder
    private var branchContent: some View {
        switch viewModel.branchSelectionState {
        case .idle, .loading:
            VStack(spacing: 12) {
                ProgressView()
                    .accessibilityIdentifier("auth-select-branch-loading")
                Text("지점 목록을 불러오는 중...")
                    .font(.appCaption)
                    .foregroundColor(.appMuted)
            }

        case .error:
            VStack(spacing: 12) {
                Text("지점 목록을 불러오지 못했습니다.")
                    .font(.appBody)
                    .foregroundColor(.appDestructive)
                    .multilineTextAlignment(.center)
                    .accessibilityIdentifier("auth-select-branch-error")

                actionButtons(retryTitle: "다시 시도")
            }

        case .loaded(let branches):
            if branches.isEmpty {
                VStack(spacing: 12) {
                    Text("접근 가능한 지점이 없습니다.\n관리자에게 지점 접근 권한을 요청해 주세요.")
                        .font(.appBody)
                        .foregroundColor(.appMuted)
                        .multilineTextAlignment(.center)
                        .accessibilityIdentifier("auth-select-branch-empty")

                    actionButtons(retryTitle: "새로고침")
                }
            } else {
                branchList(branches)
            }
        }
    }

    private func branchList(_ branches: [BranchItem]) -> some View {
        VStack(spacing: 12) {
            if viewModel.isLoading {
                ProgressView()
                    .accessibilityIdentifier("auth-select-branch-selecting")
            }

            ForEach(branches) { branch in
                Button(action: { viewModel.selectBranch(branchId: branch.id) }) {
                    HStack {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(branch.name)
                                .font(.appBody)
                                .fontWeight(.semibold)
                                .foregroundColor(.appForeground)
                            Text(branch.role)
                                .font(.appCaption)
                                .foregroundColor(.appMuted)
                        }
                        Spacer()
                        Image(systemName: "chevron.right")
                            .foregroundColor(.appMuted)
                    }
                    .padding(16)
                    .background(Color.appBackground)
                    .cornerRadius(CGFloat(AppTheme.Radius.md))
                }
                .buttonStyle(.plain)
                .disabled(viewModel.isLoading)
                .accessibilityIdentifier("auth-select-branch-item-\(branch.id)")
            }
        }
    }

    private var selectionErrorContent: some View {
        VStack(spacing: 8) {
            Text("지점 선택에 실패했습니다. 다시 시도해 주세요.")
                .font(.appCaption)
                .foregroundColor(.appDestructive)
                .multilineTextAlignment(.center)
                .accessibilityIdentifier("auth-select-branch-selection-error")

            actionButtons(retryTitle: "지점 목록 새로고침")
        }
    }

    private func actionButtons(retryTitle: String) -> some View {
        HStack(spacing: 12) {
            Button(retryTitle, action: viewModel.loadBranches)
                .buttonStyle(.borderedProminent)
                .tint(.appPrimary)
                .disabled(viewModel.isLoading)
                .accessibilityIdentifier("auth-select-branch-retry")

            Button("로그아웃", action: logout)
                .buttonStyle(.bordered)
                .accessibilityIdentifier("auth-select-branch-logout")
        }
    }

    private func loadBranchesIfNeeded() {
        guard !hasLoadedBranches else {
            return
        }

        hasLoadedBranches = true
        viewModel.loadBranches()
    }

    private func logout() {
        viewModel.logout()
        onNavigateToLogin()
    }
}
