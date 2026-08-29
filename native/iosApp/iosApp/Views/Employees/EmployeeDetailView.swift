import SwiftUI
import shared

struct EmployeeDetailView: View {
    let employeeId: Int32
    @StateObject private var viewModel = EmployeeDetailViewModelWrapper()
    @State private var editName = ""
    @State private var editPhone = ""
    @State private var editGrade = ""
    @State private var editWorkArea = ""
    @State private var editBirthday = ""
    @State private var editOpenToNextWork = false

    var onNavigateBack: () -> Void = {}

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: AppTheme.Spacing.md) {
                HStack {
                    Button(action: onNavigateBack) {
                        Image(systemName: "chevron.left").font(.appHeading5)
                    }
                    .accessibilityIdentifier("employee-detail-back")
                    Text(viewModel.employee?.name ?? "직원 상세")
                        .font(.appHeading2)
                        .fontWeight(.bold)
                        .accessibilityIdentifier("employee-detail-name")
                    Spacer()
                }

                if viewModel.isLoading && viewModel.employee == nil {
                    LoadingView()
                        .frame(minHeight: 200)
                } else if let errorMessage = viewModel.errorMessage, viewModel.employee == nil {
                    ErrorView(message: errorMessage) {
                        viewModel.loadEmployee(id: employeeId)
                    }
                    .frame(minHeight: 200)
                } else if let employee = viewModel.employee {
                    if viewModel.isEditing {
                        editCard(employee: employee)
                    } else {
                        detailCard(employee: employee)
                    }

                    if let errorMessage = viewModel.errorMessage {
                        Text(errorMessage)
                            .font(.appBodySmall)
                            .foregroundColor(.appDestructive)
                            .accessibilityIdentifier("employee-detail-error")
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
                        .accessibilityIdentifier("employee-detail-edit-button")

                        Button(action: deleteEmployee) {
                            Label(viewModel.isDeleting ? "삭제 중..." : "삭제", systemImage: "trash")
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, AppTheme.Spacing.sm)
                        }
                        .buttonStyle(.bordered)
                        .tint(.appDestructive)
                        .disabled(viewModel.isSaving || viewModel.isDeleting)
                        .accessibilityIdentifier("employee-detail-delete-button")
                    }
                } else {
                    EmptyView_(message: "직원을 찾을 수 없습니다")
                }
            }
            .padding(AppTheme.Spacing.lg)
        }
        .background(Color.appBackground)
        .onAppear {
            viewModel.loadEmployee(id: employeeId)
        }
        .onChange(of: viewModel.deleteSuccess) { _, success in
            if success { onNavigateBack() }
        }
        .accessibilityIdentifier("employee-detail-screen")
    }

    private func detailCard(employee: Employee) -> some View {
        VStack(alignment: .leading, spacing: AppTheme.Spacing.sm) {
            Text("직원 정보")
                .font(.appHeading4)
                .fontWeight(.semibold)
            InfoRow(label: "전화번호", value: employee.phone)
            InfoRow(label: "직급", value: employee.grade)
            InfoRow(label: "근무 지역", value: employee.workArea.joined(separator: " · ").nilIfBlank ?? "-")
            InfoRow(label: "생년월일", value: employee.birthday ?? "-")
            InfoRow(label: "등록일", value: employee.registeredDate ?? "-")
            InfoRow(label: "다음 업무 가능", value: employee.openToNextWork ? "예" : "아니오")
            InfoRow(label: "상태", value: statusLabel(employee.status, openToNextWork: employee.openToNextWork))
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

    private func editCard(employee: Employee) -> some View {
        VStack(alignment: .leading, spacing: AppTheme.Spacing.sm) {
            Text("직원 정보 수정")
                .font(.appHeading4)
                .fontWeight(.semibold)
            AppFormField(label: "이름", text: $editName, identifier: "employee-detail-edit-name")
            AppFormField(label: "전화번호", text: $editPhone, keyboardType: .phonePad, identifier: "employee-detail-edit-phone")
            AppFormField(label: "직급", text: $editGrade, identifier: "employee-detail-edit-grade")
            AppFormField(label: "근무 지역 (쉼표로 구분)", text: $editWorkArea, identifier: "employee-detail-edit-work-area")
            AppFormField(label: "생년월일", text: $editBirthday, identifier: "employee-detail-edit-birthday")
            Toggle("다음 업무 가능", isOn: $editOpenToNextWork)
            HStack(spacing: AppTheme.Spacing.sm) {
                Button("취소", action: { viewModel.cancelEditing() })
                    .buttonStyle(.bordered)
                    .frame(maxWidth: .infinity)
                Button(action: saveEmployee) {
                    HStack {
                        if viewModel.isSaving { ProgressView() }
                        Text(viewModel.isSaving ? "저장 중..." : "저장")
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(.appPrimary)
                .disabled(viewModel.isSaving || editName.nilIfBlank == nil || editPhone.nilIfBlank == nil)
                .accessibilityIdentifier("employee-detail-save-button")
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
        guard let employee = viewModel.employee else { return }
        editName = employee.name
        editPhone = employee.phone
        editGrade = employee.grade
        editWorkArea = employee.workArea.joined(separator: ", ")
        editBirthday = employee.birthday ?? ""
        editOpenToNextWork = employee.openToNextWork
        viewModel.startEditing()
    }

    private func saveEmployee() {
        viewModel.updateEmployee(
            id: employeeId,
            request: UpdateEmployeeRequest(
                name: editName.nilIfBlank,
                workArea: editWorkArea
                    .split(separator: ",")
                    .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                    .filter { !$0.isEmpty },
                phone: editPhone.nilIfBlank,
                grade: editGrade.nilIfBlank,
                openToNextWork: KotlinBoolean(bool: editOpenToNextWork),
                birthday: editBirthday.nilIfBlank
            )
        )
    }

    private func deleteEmployee() {
        viewModel.deleteEmployee(id: employeeId)
    }

    private func statusLabel(_ status: String?, openToNextWork: Bool) -> String {
        switch status {
        case "available": return "가능"
        case "working": return "근무 중"
        case "unavailable": return "불가"
        default: return openToNextWork ? "가능" : "불가"
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
final class EmployeeDetailViewModelWrapper: ObservableObject {
    private let viewModel: EmployeeDetailViewModel
    private var stateCollector: IOSStateFlowCollector?

    @Published var isLoading: Bool = true
    @Published var employee: Employee?
    @Published var errorMessage: String?
    @Published var isEditing: Bool = false
    @Published var isSaving: Bool = false
    @Published var isDeleting: Bool = false
    @Published var deleteSuccess: Bool = false

    init(viewModel: EmployeeDetailViewModel = KoinHelper.shared.employeeDetailViewModel()) {
        self.viewModel = viewModel
        observeUiState()
    }

    deinit {
        stateCollector?.stop()
    }

    private func observeUiState() {
        let collector = IOSStateFlowCollector { [weak self] value in
            guard let state = value as? EmployeeDetailUiState else { return }
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.isLoading = state.isLoading
                self.employee = state.employee
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

    func loadEmployee(id: Int32) {
        viewModel.loadEmployee(employeeId: id)
    }

    func startEditing() {
        viewModel.startEditing()
    }

    func cancelEditing() {
        viewModel.cancelEditing()
    }

    func updateEmployee(id: Int32, request: UpdateEmployeeRequest) {
        viewModel.updateEmployee(employeeId: id, request: request)
    }

    func deleteEmployee(id: Int32) {
        viewModel.deleteEmployee(employeeId: id)
    }
}

private extension String {
    var nilIfBlank: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
