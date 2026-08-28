import SwiftUI
import shared

struct ContractListView: View {
    @StateObject private var viewModel = ContractListViewModelWrapper()

    var onNavigateToDetail: (String) -> Void = { _ in }
    var onNavigateToCreate: () -> Void = {}

    var body: some View {
        VStack(alignment: .leading, spacing: AppTheme.Spacing.md) {
            HStack {
                Text("계약 문서")
                    .font(.appHeading2)
                    .fontWeight(.bold)
                    .accessibilityIdentifier("contract-list-title")

                Spacer()

                Button(action: { viewModel.refresh() }) {
                    Image(systemName: "arrow.clockwise")
                        .font(.appHeading6)
                        .foregroundColor(.appSecondaryForeground)
                        .frame(width: 36, height: 36)
                        .background(Color.appSecondary)
                        .cornerRadius(AppTheme.Radius.md)
                }
                .accessibilityIdentifier("contract-list-refresh")

                Button(action: onNavigateToCreate) {
                    Image(systemName: "plus.circle.fill")
                        .font(.appHeading4)
                        .foregroundColor(.appPrimary)
                }
                .accessibilityIdentifier("contract-list-add-button")
            }

            if viewModel.isLoading && viewModel.documents.isEmpty {
                LoadingView()
            } else if let errorMessage = viewModel.errorMessage, viewModel.documents.isEmpty {
                ErrorView(message: errorMessage) {
                    viewModel.refresh()
                }
            } else if viewModel.documents.isEmpty {
                EmptyView_(message: "계약 문서가 없습니다")
            } else {
                ScrollView {
                    LazyVStack(spacing: AppTheme.Spacing.sm) {
                        ForEach(viewModel.documents, id: \.id) { document in
                            HStack(spacing: AppTheme.Spacing.md) {
                                Button(action: { onNavigateToDetail(document.id) }) {
                                    HStack(spacing: AppTheme.Spacing.md) {
                                        Image(systemName: "doc.text.fill")
                                            .foregroundColor(.appPrimary)

                                        VStack(alignment: .leading, spacing: AppTheme.Spacing.xs) {
                                            Text(document.name)
                                                .font(.appBody)
                                                .fontWeight(.semibold)
                                                .foregroundColor(.appForeground)
                                            if let category = document.categoryLabel, !category.isEmpty {
                                                Text(category)
                                                    .font(.appCaption)
                                                    .foregroundColor(.appMutedForeground)
                                            }
                                            if let description = document.description_, !description.isEmpty {
                                                Text(description)
                                                    .font(.appCaption)
                                                    .foregroundColor(.appMutedForeground)
                                                    .lineLimit(2)
                                            }
                                        }

                                        Spacer()
                                        Image(systemName: "chevron.right")
                                            .font(.appCaption)
                                            .foregroundColor(.appMutedForeground)
                                    }
                                }
                                .buttonStyle(.plain)

                                if document.canManage {
                                    Button(action: { viewModel.deleteContract(document.id) }) {
                                        Image(systemName: viewModel.isDeleting && viewModel.deletingId == document.id ? "hourglass" : "trash")
                                            .foregroundColor(.appDestructive)
                                    }
                                    .disabled(viewModel.isDeleting)
                                    .accessibilityIdentifier("contract-document-delete-\(document.id)")
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
                            .accessibilityIdentifier("contract-document-\(document.id)")
                        }
                    }
                }
            }
        }
        .padding(AppTheme.Spacing.lg)
        .background(Color.appBackground)
        .onAppear {
            viewModel.loadContracts()
        }
        .accessibilityIdentifier("contract-list-screen")
    }
}

@MainActor
final class ContractListViewModelWrapper: ObservableObject {
    private let viewModel: ContractListViewModel
    private var stateCollector: IOSStateFlowCollector?

    @Published var isLoading: Bool = false
    @Published var documents: [FileItem] = []
    @Published var selectedDocument: FileItem?
    @Published var isDetailLoading: Bool = false
    @Published var detailErrorMessage: String?
    @Published var errorMessage: String?
    @Published var isDeleting: Bool = false
    @Published var deletingId: String?
    @Published var isUpdating: Bool = false
    @Published var deleteSuccess: Bool = false

    init(viewModel: ContractListViewModel = KoinHelper.shared.contractListViewModel()) {
        self.viewModel = viewModel
        observeUiState()
    }

    deinit {
        stateCollector?.stop()
    }

    private func observeUiState() {
        let collector = IOSStateFlowCollector { [weak self] value in
            guard let state = value as? ContractListUiState else { return }
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.isLoading = state.isLoading
                self.documents = state.documents
                self.selectedDocument = state.selectedDocument
                self.isDetailLoading = state.isDetailLoading
                self.detailErrorMessage = state.detailError
                self.errorMessage = state.error
                self.isDeleting = state.isDeleting
                self.deletingId = state.deletingId
                self.isUpdating = state.isUpdating
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

    func loadContracts() {
        viewModel.loadContracts()
    }

    func refresh() {
        viewModel.refresh()
    }

    func loadDocument(id: String) {
        viewModel.loadContract(id: id)
    }

    func deleteContract(_ id: String) {
        viewModel.deleteContract(id: id)
    }

    func updateDocument(id: String, name: String, description: String) {
        viewModel.updateContract(
            id: id,
            request: UpdateDocumentRequest(
                name: name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : name,
                description: description.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : description,
                categoryId: nil,
                tags: nil
            )
        )
    }
}
