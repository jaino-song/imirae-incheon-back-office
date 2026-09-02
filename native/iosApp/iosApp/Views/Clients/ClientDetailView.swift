import SwiftUI
import shared

struct ClientDetailView: View {
    let clientId: Int32
    @StateObject private var viewModel = ClientDetailViewModelWrapper()
    @State private var editName = ""
    @State private var editPhone = ""
    @State private var editAddress = ""

    var onNavigateBack: () -> Void = {}

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: AppTheme.Spacing.md) {
                HStack {
                    Button(action: onNavigateBack) {
                        Image(systemName: "chevron.left").font(.appHeading5)
                    }
                    .accessibilityIdentifier("client-detail-back")
                    Text(viewModel.client?.name ?? "고객 상세")
                        .font(.appHeading2)
                        .fontWeight(.bold)
                        .accessibilityIdentifier("client-detail-name")
                    Spacer()
                }

                if viewModel.isLoading && viewModel.client == nil {
                    LoadingView()
                        .frame(minHeight: 200)
                } else if let errorMessage = viewModel.errorMessage, viewModel.client == nil {
                    ErrorView(message: errorMessage) {
                        viewModel.loadClient(id: clientId)
                    }
                    .frame(minHeight: 200)
                } else if let client = viewModel.client {
                    if viewModel.isEditing {
                        editCard(client: client)
                    } else {
                        detailCard(client: client)
                    }

                    if let errorMessage = viewModel.errorMessage {
                        Text(errorMessage)
                            .font(.appBodySmall)
                            .foregroundColor(.appDestructive)
                            .accessibilityIdentifier("client-detail-error")
                    }

                    HStack(spacing: AppTheme.Spacing.sm) {
                        Button(action: beginEditing) {
                            Label("수정", systemImage: "pencil")
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, AppTheme.Spacing.sm)
                        }
                        .buttonStyle(.bordered)
                        .tint(.appPrimary)
                        .disabled(viewModel.isSaving || viewModel.isDeleting)
                        .accessibilityIdentifier("client-detail-edit-button")

                        Button(action: deleteClient) {
                            Label(viewModel.isDeleting ? "삭제 중..." : "삭제", systemImage: "trash")
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, AppTheme.Spacing.sm)
                        }
                        .buttonStyle(.bordered)
                        .tint(.appDestructive)
                        .disabled(viewModel.isSaving || viewModel.isDeleting)
                        .accessibilityIdentifier("client-detail-delete-button")
                    }
                } else {
                    EmptyView_(message: "고객을 찾을 수 없습니다")
                }
            }
            .padding(AppTheme.Spacing.lg)
        }
        .background(Color.appBackground)
        .onAppear {
            viewModel.loadClient(id: clientId)
        }
        .onChange(of: viewModel.deleteSuccess) { _, success in
            if success { onNavigateBack() }
        }
        .accessibilityIdentifier("client-detail-screen")
    }

    private func detailCard(client: Client) -> some View {
        VStack(alignment: .leading, spacing: AppTheme.Spacing.sm) {
            Text("기본 정보")
                .font(.appHeading4)
                .fontWeight(.semibold)
            InfoRow(label: "전화번호", value: client.phone ?? "-")
            InfoRow(label: "주소", value: client.address ?? "-")
            InfoRow(label: "상태", value: statusLabel(client.serviceStatus))
            InfoRow(label: "바우처 고객", value: client.voucherClient ? "예" : "아니오")
            InfoRow(label: "유축기", value: client.breastPump ? "예" : "아니오")
            InfoRow(label: "출산 예정일", value: client.dueDate ?? "-")
            if let employee = client.primaryEmployee {
                InfoRow(label: "담당 직원", value: employee.name)
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

    private func editCard(client: Client) -> some View {
        VStack(alignment: .leading, spacing: AppTheme.Spacing.sm) {
            Text("고객 정보 수정")
                .font(.appHeading4)
                .fontWeight(.semibold)
            AppFormField(label: "이름", text: $editName, identifier: "client-detail-edit-name")
            AppFormField(label: "전화번호", text: $editPhone, keyboardType: .phonePad, identifier: "client-detail-edit-phone")
            AppFormField(label: "주소", text: $editAddress, identifier: "client-detail-edit-address")
            HStack(spacing: AppTheme.Spacing.sm) {
                Button("취소", action: { viewModel.cancelEditing() })
                    .buttonStyle(.bordered)
                    .frame(maxWidth: .infinity)
                Button(action: saveClient) {
                    HStack {
                        if viewModel.isSaving { ProgressView() }
                        Text(viewModel.isSaving ? "저장 중..." : "저장")
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(.appPrimary)
                .disabled(viewModel.isSaving)
                .accessibilityIdentifier("client-detail-save-button")
            }
        }
        .padding(AppTheme.Spacing.lg)
        .background(Color.appCard)
        .overlay(
            RoundedRectangle(cornerRadius: AppTheme.Radius.lg)
                .stroke(Color.appBorder, lineWidth: 1)
        )
        .cornerRadius(AppTheme.Radius.lg)
    }

    private func beginEditing() {
        guard let client = viewModel.client else { return }
        editName = client.name
        editPhone = client.phone ?? ""
        editAddress = client.address ?? ""
        viewModel.startEditing()
    }

    private func saveClient() {
        viewModel.updateClient(
            id: clientId,
            request: UpdateClientRequest(
                name: editName.trimmingCharacters(in: .whitespacesAndNewlines),
                primaryEmployeeId: nil,
                secondaryEmployeeId: nil,
                address: editAddress.nilIfBlank,
                phone: editPhone.nilIfBlank,
                type: nil,
                duration: nil,
                fullPrice: nil,
                grant: nil,
                actualPrice: nil,
                startDate: nil,
                endDate: nil,
                careCenter: nil,
                voucherClient: nil,
                birthday: nil,
                dueDate: nil,
                birthDate: nil,
                serviceStatus: nil,
                breastPump: nil,
                eDocId: nil,
                areaId: nil
            )
        )
    }

    private func deleteClient() {
        viewModel.deleteClient(id: clientId)
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

private struct InfoRow: View {
    let label: String
    let value: String

    var body: some View {
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

@MainActor
final class ClientDetailViewModelWrapper: ObservableObject {
    private let viewModel: ClientDetailViewModel
    private var stateCollector: IOSStateFlowCollector?

    @Published var isLoading: Bool = true
    @Published var client: Client?
    @Published var errorMessage: String?
    @Published var isEditing: Bool = false
    @Published var isSaving: Bool = false
    @Published var isDeleting: Bool = false
    @Published var deleteSuccess: Bool = false

    init(viewModel: ClientDetailViewModel = KoinHelper.shared.clientDetailViewModel()) {
        self.viewModel = viewModel
        observeUiState()
    }

    deinit {
        stateCollector?.stop()
    }

    private func observeUiState() {
        let collector = IOSStateFlowCollector { [weak self] value in
            guard let state = value as? ClientDetailUiState else { return }
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.isLoading = state.isLoading
                self.client = state.client
                self.errorMessage = state.error
                self.isEditing = state.isEditing
                self.isSaving = state.isSaving
                self.isDeleting = state.isDeleting
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

    func loadClient(id: Int32) {
        viewModel.loadClient(clientId: id)
    }

    func startEditing() {
        viewModel.startEditing()
    }

    func cancelEditing() {
        viewModel.cancelEditing()
    }

    func updateClient(id: Int32, request: UpdateClientRequest) {
        viewModel.updateClient(clientId: id, request: request)
    }

    func deleteClient(id: Int32) {
        viewModel.deleteClient(clientId: id)
    }
}

private extension String {
    var nilIfBlank: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
