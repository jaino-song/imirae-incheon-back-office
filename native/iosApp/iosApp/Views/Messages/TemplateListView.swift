import SwiftUI
import shared

struct TemplateListView: View {
    @StateObject private var viewModel = MessageTemplateViewModelWrapper()

    var onNavigateToNew: () -> Void = {}
    var onNavigateToEdit: (String) -> Void = { _ in }

    var body: some View {
        VStack(alignment: .leading, spacing: AppTheme.Spacing.md) {
            header

            if viewModel.isLoading {
                LoadingView()
            } else if let errorMessage = viewModel.errorMessage {
                ErrorView(message: errorMessage) {
                    viewModel.refresh()
                }
            } else if viewModel.templates.isEmpty {
                EmptyView_(message: "템플릿이 없습니다")
            } else {
                ScrollView {
                    LazyVStack(spacing: AppTheme.Spacing.sm) {
                        ForEach(viewModel.templates, id: \.id) { template in
                            Button(action: { onNavigateToEdit(template.id) }) {
                                VStack(alignment: .leading, spacing: AppTheme.Spacing.xs) {
                                    HStack(spacing: AppTheme.Spacing.sm) {
                                        Text(template.title)
                                            .font(.appHeading5)
                                            .foregroundColor(.appForeground)
                                            .lineLimit(1)
                                            .frame(maxWidth: .infinity, alignment: .leading)

                                        Image(systemName: "chevron.right")
                                            .font(.appCaption)
                                            .foregroundColor(.appMutedForeground)
                                    }

                                    Text(template.content)
                                        .font(.appBody)
                                        .foregroundColor(.appMutedForeground)
                                        .lineLimit(3)

                                    if let category = template.category, !category.isEmpty {
                                        Text(category)
                                            .font(.appCaption)
                                            .foregroundColor(.appPrimary)
                                            .padding(.horizontal, AppTheme.Spacing.sm)
                                            .padding(.vertical, AppTheme.Spacing.xs)
                                            .background(Color.appPrimary.opacity(0.1))
                                            .cornerRadius(AppTheme.Radius.pill)
                                    }
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
                            .accessibilityIdentifier("template-item-\(template.id)")
                        }
                    }
                }
            }
        }
        .padding(AppTheme.Spacing.lg)
        .background(Color.appBackground)
        .onAppear {
            viewModel.loadTemplates()
        }
        .accessibilityIdentifier("template-list-screen")
    }

    private var header: some View {
        HStack(spacing: AppTheme.Spacing.sm) {
            Text("메시지 템플릿")
                .font(.appHeading2)
                .foregroundColor(.appForeground)
                .accessibilityIdentifier("template-list-title")

            Spacer()

            Button(action: { viewModel.refresh() }) {
                Image(systemName: "arrow.clockwise")
                    .font(.appHeading6)
                    .foregroundColor(.appSecondaryForeground)
                    .frame(width: 36, height: 36)
                    .background(Color.appSecondary)
                    .cornerRadius(AppTheme.Radius.md)
            }
            .accessibilityIdentifier("template-list-refresh")

            Button(action: onNavigateToNew) {
                Image(systemName: "plus")
                    .font(.appHeading6)
                    .foregroundColor(.appPrimaryForeground)
                    .frame(width: 36, height: 36)
                    .background(Color.appPrimary)
                    .cornerRadius(AppTheme.Radius.md)
            }
            .accessibilityIdentifier("template-list-add")
        }
    }
}

@MainActor
final class MessageTemplateViewModelWrapper: ObservableObject {
    private let viewModel: MessageTemplateViewModel
    private var stateCollector: IOSStateFlowCollector?

    @Published var isLoading: Bool = true
    @Published var templates: [MessageTemplate] = []
    @Published var selectedTemplate: MessageTemplate?
    @Published var errorMessage: String?
    @Published var isSaving: Bool = false
    @Published var saveSuccess: Bool = false
    @Published var deleteSuccess: Bool = false

    init(viewModel: MessageTemplateViewModel = KoinHelper.shared.messageTemplateViewModel()) {
        self.viewModel = viewModel
        observeUiState()
    }

    deinit {
        stateCollector?.stop()
    }

    private func observeUiState() {
        let collector = IOSStateFlowCollector { [weak self] value in
            guard let state = value as? MessageTemplateUiState else { return }
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.isLoading = state.isLoading
                self.templates = state.templates
                self.selectedTemplate = state.selectedTemplate
                self.errorMessage = state.error
                self.isSaving = state.isSaving
                self.saveSuccess = state.saveSuccess
                self.deleteSuccess = state.deleteSuccess
            }
        }
        stateCollector = collector
        viewModel.uiState.collect(collector: collector) { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.stateCollector?.stop()
            }
        }
    }

    func loadTemplates() {
        viewModel.loadTemplates()
    }

    func loadTemplate(id: String) {
        viewModel.loadTemplate(id: id)
    }

    func createTemplate(title: String, content: String, category: String?) {
        viewModel.createTemplate(title: title, content: content, category: category)
    }

    func updateTemplate(id: String, title: String, content: String, category: String?) {
        viewModel.updateTemplate(id: id, title: title, content: content, category: category)
    }

    func deleteTemplate(id: String) {
        viewModel.deleteTemplate(id: id)
    }

    func refresh() {
        viewModel.refresh()
    }
}
