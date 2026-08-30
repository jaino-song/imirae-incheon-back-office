import SwiftUI
import shared

struct SettingsView: View {
    @StateObject private var viewModel = SettingsViewModelWrapper()
    @State private var notificationsEnabled = true
    @State private var selectedLanguage = "ko"
    @State private var selectedTheme = "system"
    @State private var isInitialized = false

    var onNavigateToVoucherPrices: () -> Void = {}
    var onLogout: () -> Void = {}

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: AppTheme.Spacing.md) {
                Text("설정")
                    .font(.appHeading2)
                    .foregroundColor(.appForeground)
                    .accessibilityIdentifier("settings-title")

                if let errorMessage = viewModel.errorMessage {
                    HStack(spacing: AppTheme.Spacing.sm) {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .foregroundColor(.appDestructive)
                        Text(errorMessage)
                            .font(.appBodySmall)
                            .foregroundColor(.appDestructive)
                    }
                    .padding(AppTheme.Spacing.md)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.appDestructive.opacity(0.12))
                    .cornerRadius(AppTheme.Radius.md)
                    .accessibilityIdentifier("settings-error")
                }

                if viewModel.isLoading && viewModel.settings == nil {
                    LoadingView()
                }

                SettingsRow(
                    icon: "wonsign.circle.fill",
                    title: "바우처 가격 관리",
                    subtitle: "바우처 가격 정보를 관리합니다",
                    action: onNavigateToVoucherPrices,
                    identifier: "settings-voucher-prices"
                )

                settingsFormCard

                Spacer().frame(height: AppTheme.Spacing.md)

                Button(action: onLogout) {
                    HStack {
                        Image(systemName: "rectangle.portrait.and.arrow.right")
                            .font(.appBody)
                        Text("로그아웃")
                            .font(.appLabel)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, AppTheme.Spacing.md)
                    .foregroundColor(.appDestructive)
                    .overlay(
                        RoundedRectangle(cornerRadius: AppTheme.Radius.md)
                            .stroke(Color.appDestructive, lineWidth: 1)
                    )
                }
                .accessibilityIdentifier("settings-logout")
            }
            .padding(AppTheme.Spacing.lg)
        }
        .background(Color.appBackground)
        .onAppear {
            viewModel.refresh()
        }
        .onChange(of: viewModel.settings?.language) { _, _ in
            applySettingsIfNeeded()
        }
        .accessibilityIdentifier("settings-screen")
    }

    private var settingsFormCard: some View {
        VStack(alignment: .leading, spacing: AppTheme.Spacing.md) {
            Toggle(isOn: $notificationsEnabled) {
                Text("알림 받기")
                    .font(.appBody)
                    .foregroundColor(.appForeground)
            }
            .tint(.appPrimary)
            .accessibilityIdentifier("settings-notifications")

            VStack(alignment: .leading, spacing: AppTheme.Spacing.xs) {
                Text("언어 (현재 백엔드 미지원)")
                    .font(.appLabel)
                    .foregroundColor(.appForeground)

                Picker("언어", selection: $selectedLanguage) {
                    Text("한국어").tag("ko")
                    Text("English").tag("en")
                }
                .pickerStyle(.segmented)
                .disabled(true)
                .accessibilityIdentifier("settings-language")
            }

            VStack(alignment: .leading, spacing: AppTheme.Spacing.xs) {
                Text("테마 (현재 백엔드 미지원)")
                    .font(.appLabel)
                    .foregroundColor(.appForeground)

                Picker("테마", selection: $selectedTheme) {
                    Text("시스템").tag("system")
                    Text("라이트").tag("light")
                    Text("다크").tag("dark")
                }
                .pickerStyle(.segmented)
                .disabled(true)
                .accessibilityIdentifier("settings-theme")
            }

            Button(action: saveSettings) {
                HStack {
                    if viewModel.isSaving {
                        ProgressView()
                            .tint(Color.appPrimaryForeground)
                    }

                    Text(viewModel.isSaving ? "저장 중..." : "설정 저장")
                        .font(.appLabel)
                        .foregroundColor(.appPrimaryForeground)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, AppTheme.Spacing.md)
                .background(Color.appPrimary)
                .cornerRadius(AppTheme.Radius.md)
            }
            .disabled(viewModel.isSaving)
            .accessibilityIdentifier("settings-save")
        }
        .padding(AppTheme.Spacing.lg)
        .background(Color.appCard)
        .overlay(
            RoundedRectangle(cornerRadius: AppTheme.Radius.lg)
                .stroke(Color.appBorder, lineWidth: 1)
        )
        .cornerRadius(AppTheme.Radius.lg)
    }

    private func applySettingsIfNeeded() {
        guard !isInitialized, let settings = viewModel.settings else {
            return
        }

        notificationsEnabled = settings.notifications
        selectedLanguage = settings.language
        selectedTheme = settings.theme
        isInitialized = true
    }

    private func saveSettings() {
        let updatedSettings = UserSettings(
            notifications: notificationsEnabled,
            language: selectedLanguage,
            theme: selectedTheme
        )
        viewModel.updateSettings(updatedSettings)
    }
}

private struct SettingsRow: View {
    let icon: String
    let title: String
    let subtitle: String
    let action: () -> Void
    let identifier: String

    var body: some View {
        Button(action: action) {
            HStack(spacing: AppTheme.Spacing.md) {
                Image(systemName: icon)
                    .foregroundColor(.appPrimary)
                    .font(.appHeading5)

                VStack(alignment: .leading, spacing: AppTheme.Spacing.xs) {
                    Text(title)
                        .font(.appBody)
                        .foregroundColor(.appForeground)

                    Text(subtitle)
                        .font(.appCaption)
                        .foregroundColor(.appMutedForeground)
                }

                Spacer()

                Image(systemName: "chevron.right")
                    .foregroundColor(.appMutedForeground)
                    .font(.appCaption)
            }
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
final class SettingsViewModelWrapper: ObservableObject {
    private let viewModel: SettingsViewModel
    private var stateCollector: IOSStateFlowCollector?

    @Published var isLoading: Bool = true
    @Published var settings: UserSettings?
    @Published var voucherPrices: [VoucherPrice] = []
    @Published var isSaving: Bool = false
    @Published var saveSuccess: Bool = false
    @Published var errorMessage: String?

    init(viewModel: SettingsViewModel = KoinHelper.shared.settingsViewModel()) {
        self.viewModel = viewModel
        observeUiState()
    }

    deinit {
        stateCollector?.stop()
    }

    private func observeUiState() {
        let collector = IOSStateFlowCollector { [weak self] value in
            guard let state = value as? SettingsUiState else { return }
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.isLoading = state.isLoading
                self.settings = state.settings
                self.voucherPrices = state.voucherPrices
                self.isSaving = state.isSaving
                self.saveSuccess = state.saveSuccess
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

    func updateSettings(_ settings: UserSettings) {
        viewModel.updateSettings(settings: settings)
    }

    func refresh() {
        viewModel.refresh()
    }
}
