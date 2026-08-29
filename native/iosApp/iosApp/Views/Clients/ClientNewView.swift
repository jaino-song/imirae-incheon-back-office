import SwiftUI
import shared

struct ClientNewView: View {
    @StateObject private var viewModel = ClientListViewModelWrapper()
    @State private var name = ""
    @State private var phone = ""
    @State private var address = ""
    @State private var dueDate = ""
    @State private var voucherClient = false
    @State private var breastPump = false
    @State private var nameError: String?

    var onNavigateBack: () -> Void = {}

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: AppTheme.Spacing.md) {
                HStack {
                    Button(action: onNavigateBack) {
                        Image(systemName: "chevron.left").font(.appHeading5)
                    }
                    .accessibilityIdentifier("client-new-back")
                    Text("고객 추가")
                        .font(.appHeading2)
                        .fontWeight(.bold)
                        .accessibilityIdentifier("client-new-title")
                }

                if let errorMessage = viewModel.errorMessage {
                    Text(errorMessage)
                        .font(.appBodySmall)
                        .foregroundColor(.appDestructive)
                        .accessibilityIdentifier("client-new-error")
                }

                VStack(alignment: .leading, spacing: AppTheme.Spacing.md) {
                    AppFormField(label: "이름 *", text: $name, error: nameError, identifier: "client-new-name")
                    AppFormField(label: "전화번호", text: $phone, keyboardType: .phonePad, identifier: "client-new-phone")
                    AppFormField(label: "주소", text: $address, identifier: "client-new-address")
                    AppFormField(label: "출산 예정일 (YYYY-MM-DD)", text: $dueDate, identifier: "client-new-due-date")
                    Toggle("바우처 고객", isOn: $voucherClient)
                        .tint(.appPrimary)
                        .accessibilityIdentifier("client-new-voucher-client")
                    Toggle("유축기", isOn: $breastPump)
                        .tint(.appPrimary)
                        .accessibilityIdentifier("client-new-breast-pump")
                }
                .padding(AppTheme.Spacing.lg)
                .background(Color.appCard)
                .overlay(
                    RoundedRectangle(cornerRadius: AppTheme.Radius.lg)
                        .stroke(Color.appBorder, lineWidth: 1)
                )
                .cornerRadius(AppTheme.Radius.lg)

                Button(action: submit) {
                    HStack {
                        if viewModel.isCreating {
                            ProgressView().tint(.white)
                        } else {
                            Text("저장").fontWeight(.semibold)
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, AppTheme.Spacing.md)
                }
                .buttonStyle(.borderedProminent)
                .tint(.appPrimary)
                .disabled(viewModel.isCreating)
                .accessibilityIdentifier("client-new-submit")
            }
            .padding(AppTheme.Spacing.lg)
        }
        .background(Color.appBackground)
        .onChange(of: viewModel.createSuccess) { _, success in
            if success { onNavigateBack() }
        }
        .accessibilityIdentifier("client-new-screen")
    }

    private func submit() {
        nameError = name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "이름을 입력해 주세요" : nil
        guard nameError == nil else { return }

        let request = CreateClientRequest(
            name: name.trimmingCharacters(in: .whitespacesAndNewlines),
            voucherClient: voucherClient,
            breastPump: breastPump,
            primaryEmployeeId: nil,
            secondaryEmployeeId: nil,
            address: address.nilIfBlank,
            phone: phone.nilIfBlank,
            type: nil,
            duration: nil,
            fullPrice: nil,
            grant: nil,
            actualPrice: nil,
            startDate: nil,
            endDate: nil,
            careCenter: nil,
            birthday: nil,
            dueDate: dueDate.nilIfBlank,
            birthDate: nil,
            serviceStatus: nil,
            eDocId: nil,
            areaId: nil,
            suppressGreetingSms: nil,
            applyMessageAutomation: nil,
            reuseExistingClient: nil,
            source: nil
        )
        viewModel.createClient(request)
    }
}

private extension String {
    var nilIfBlank: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
