import SwiftUI
import shared

struct ContractDetailView: View {
    let documentId: String
    @StateObject private var viewModel = ContractListViewModelWrapper()
    @State private var isEditing = false
    @State private var editName = ""
    @State private var editDescription = ""

    var onNavigateBack: () -> Void = {}

    var body: some View {
        VStack(alignment: .leading, spacing: AppTheme.Spacing.md) {
            HStack {
                Button(action: onNavigateBack) {
                    Image(systemName: "chevron.left")
                        .font(.appHeading5)
                }
                .accessibilityIdentifier("contract-detail-back")

                Text("계약 문서")
                    .font(.appHeading2)
                    .fontWeight(.bold)
                    .accessibilityIdentifier("contract-detail-title")

                Spacer()
            }

            if viewModel.isDetailLoading || (viewModel.selectedDocument == nil && viewModel.detailErrorMessage == nil) {
                LoadingView()
            } else if let errorMessage = viewModel.detailErrorMessage {
                ErrorView(message: errorMessage) {
                    viewModel.loadDocument(id: documentId)
                }
            } else if let document = viewModel.selectedDocument {
                ScrollView {
                    VStack(alignment: .leading, spacing: AppTheme.Spacing.md) {
                        if isEditing {
                            TextField("이름 *", text: $editName)
                                .textFieldStyle(.roundedBorder)
                                .accessibilityIdentifier("contract-detail-edit-name")
                            AppTextEditor(label: "설명", text: $editDescription, identifier: "contract-detail-edit-description")
                        } else {
                            Text(document.name)
                                .font(.appHeading3)
                                .fontWeight(.semibold)
                                .foregroundColor(.appForeground)
                            if let description = document.description_, !description.isEmpty {
                                detailRow(label: "설명", value: description)
                            }
                        }

                        detailRow(label: "분류", value: document.categoryLabel ?? document.categoryId)
                        detailRow(label: "형식", value: document.mimeType)
                        detailRow(label: "파일 크기", value: "\(document.fileSize) bytes")
                        detailRow(label: "공개 범위", value: document.visibilityScope)
                        if let createdAt = document.createdAt, !createdAt.isEmpty {
                            detailRow(label: "등록일", value: createdAt)
                        }

                        if let storageUrl = document.storageUrl,
                           !storageUrl.isEmpty,
                           let url = URL(string: storageUrl) {
                            Link(destination: url) {
                                Label("문서 열기", systemImage: "arrow.up.right.square")
                                    .frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.bordered)
                            .accessibilityIdentifier("contract-detail-open")
                        }

                        if document.canManage {
                            HStack(spacing: AppTheme.Spacing.sm) {
                                if isEditing {
                                    Button("취소") {
                                        isEditing = false
                                    }
                                    .buttonStyle(.bordered)
                                    .frame(maxWidth: .infinity)

                                    Button(viewModel.isUpdating ? "저장 중..." : "저장") {
                                        viewModel.updateDocument(
                                            id: document.id,
                                            name: editName,
                                            description: editDescription
                                        )
                                        isEditing = false
                                    }
                                    .buttonStyle(.borderedProminent)
                                    .disabled(viewModel.isUpdating || editName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                                    .frame(maxWidth: .infinity)
                                } else {
                                    Button {
                                        editName = document.name
                                        editDescription = document.description_ ?? ""
                                        isEditing = true
                                    } label: {
                                        Label("수정", systemImage: "pencil")
                                    }
                                    .buttonStyle(.bordered)
                                    .frame(maxWidth: .infinity)
                                    .accessibilityIdentifier("contract-detail-edit-button")

                                    Button {
                                        viewModel.deleteContract(document.id)
                                    } label: {
                                        Label(viewModel.isDeleting ? "삭제 중..." : "삭제", systemImage: "trash")
                                    }
                                    .buttonStyle(.bordered)
                                    .disabled(viewModel.isDeleting)
                                    .frame(maxWidth: .infinity)
                                    .accessibilityIdentifier("contract-detail-delete-button")
                                }
                            }
                        }
                    }
                    .padding(AppTheme.Spacing.lg)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.appCard)
                    .overlay(
                        RoundedRectangle(cornerRadius: AppTheme.Radius.lg)
                            .stroke(Color.appBorder, lineWidth: 1)
                    )
                    .cornerRadius(AppTheme.Radius.lg)
                }
            }
        }
        .padding(AppTheme.Spacing.lg)
        .background(Color.appBackground)
        .onAppear {
            viewModel.loadDocument(id: documentId)
        }
        .onChange(of: viewModel.deleteSuccess) { _, deleted in
            if deleted { onNavigateBack() }
        }
        .accessibilityIdentifier("contract-detail-screen")
    }

    private func detailRow(label: String, value: String) -> some View {
        HStack {
            Text(label)
                .font(.appBodySmall)
                .foregroundColor(.appMutedForeground)
            Spacer()
            Text(value)
                .font(.appBodySmall)
                .fontWeight(.medium)
                .multilineTextAlignment(.trailing)
        }
    }
}

private struct AppTextEditor: View {
    let label: String
    @Binding var text: String
    let identifier: String

    var body: some View {
        VStack(alignment: .leading, spacing: AppTheme.Spacing.xs) {
            Text(label)
                .font(.appLabel)
                .foregroundColor(.appForeground)
            TextEditor(text: $text)
                .frame(minHeight: 88)
                .padding(AppTheme.Spacing.sm)
                .background(Color.appBackground)
                .overlay(
                    RoundedRectangle(cornerRadius: AppTheme.Radius.md)
                        .stroke(Color.appBorder, lineWidth: 1)
                )
                .cornerRadius(AppTheme.Radius.md)
                .accessibilityIdentifier(identifier)
        }
    }
}
