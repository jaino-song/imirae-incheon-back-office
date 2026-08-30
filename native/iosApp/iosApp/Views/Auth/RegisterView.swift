import SwiftUI
import shared

struct RegisterView: View {
    @StateObject private var viewModel = AuthViewModelWrapper()
    @State private var name = ""
    @State private var email = ""
    @State private var password = ""
    @State private var confirmPassword = ""
    @State private var phone = ""
    @State private var birthDate = ""
    @State private var nameError: String?
    @State private var emailError: String?
    @State private var passwordError: String?
    @State private var confirmPasswordError: String?
    @State private var phoneError: String?
    @State private var birthDateError: String?
    @State private var passwordVisible = false
    @State private var isSuccess = false
    @State private var isSubmitting = false

    var onNavigateToLogin: () -> Void = {}

    private var hasMinLength: Bool { password.count >= 8 }
    private var hasUpperCase: Bool { password.rangeOfCharacter(from: .uppercaseLetters) != nil }
    private var hasLowerCase: Bool { password.rangeOfCharacter(from: .lowercaseLetters) != nil }
    private var hasDigit: Bool { password.rangeOfCharacter(from: .decimalDigits) != nil }
    private var hasSpecial: Bool { password.rangeOfCharacter(from: CharacterSet.alphanumerics.inverted) != nil }

    var body: some View {
        if isSuccess {
            successView
        } else {
            formView
        }
    }

    private var successView: some View {
        VStack(spacing: 16) {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 64))
                .foregroundColor(.appPrimary)

            Text("회원가입 완료!")
                .font(.appHeading2)
                .fontWeight(.bold)

            Text("인증 이메일이 발송되었습니다.\n이메일을 확인하여 계정을 활성화해 주세요.")
                .font(.appBody)
                .foregroundColor(.appMuted)
                .multilineTextAlignment(.center)

            Button(action: onNavigateToLogin) {
                Text("로그인 페이지로 이동")
                    .fontWeight(.semibold)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
            }
            .buttonStyle(.borderedProminent)
            .tint(.appPrimary)
            .cornerRadius(CGFloat(AppTheme.Radius.md))
        }
        .padding(24)
        .background(Color.appCard)
        .cornerRadius(CGFloat(AppTheme.Radius.lg))
        .shadow(color: .black.opacity(0.05), radius: 8, y: 4)
        .padding(16)
        .frame(maxWidth: 400)
    }

    private var formView: some View {
        ScrollView {
            VStack(spacing: 12) {
                Text("회원가입")
                    .font(.appHeading2)
                    .foregroundColor(.appForeground)
                    .accessibilityIdentifier("auth-register-title")

                if let error = viewModel.errorMessage {
                    HStack {
                        Image(systemName: "exclamationmark.triangle.fill").foregroundColor(.appDestructive)
                        Text(error).font(.appCaption).foregroundColor(.appDestructive)
                    }
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.appDestructive.opacity(0.1))
                    .cornerRadius(CGFloat(AppTheme.Radius.md))
                }

                // Name
                AuthTextField(label: "이름", text: $name, error: $nameError, icon: "person", identifier: "auth-register-name-field")

                // Email
                AuthTextField(label: "이메일", text: $email, error: $emailError, icon: "envelope", keyboardType: .emailAddress, identifier: "auth-register-email-field")

                // Password
                AuthSecureField(label: "비밀번호", text: $password, error: $passwordError, visible: $passwordVisible, identifier: "auth-register-password-field")

                // Password requirements
                if !password.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        PasswordReqRow(text: "8자 이상", met: hasMinLength)
                        PasswordReqRow(text: "대문자 포함", met: hasUpperCase)
                        PasswordReqRow(text: "소문자 포함", met: hasLowerCase)
                        PasswordReqRow(text: "숫자 포함", met: hasDigit)
                        PasswordReqRow(text: "특수문자 포함", met: hasSpecial)
                    }
                    .padding(.leading, 4)
                }

                // Confirm password
                VStack(alignment: .leading, spacing: 4) {
                    Text("비밀번호 확인").font(.appLabel).foregroundColor(.appForeground)
                    SecureField("비밀번호를 다시 입력하세요", text: $confirmPassword)
                        .padding(12)
                        .background(Color.appBackground)
                        .cornerRadius(CGFloat(AppTheme.Radius.md))
                        .overlay(RoundedRectangle(cornerRadius: CGFloat(AppTheme.Radius.md)).stroke(confirmPasswordError != nil ? Color.appDestructive : Color.appBorder, lineWidth: 1))
                        .accessibilityIdentifier("auth-register-confirm-password-field")
                    if let error = confirmPasswordError {
                        Text(error).font(.appCaption).foregroundColor(.appDestructive)
                    }
                }

                // Phone (required by the backend RegisterDto)
                AuthTextField(label: "전화번호", text: $phone, error: $phoneError, icon: "phone", keyboardType: .phonePad, placeholder: "010-XXXX-XXXX", identifier: "auth-register-phone-field")

                // Birth date (required by the backend RegisterDto)
                AuthTextField(label: "생년월일", text: $birthDate, error: $birthDateError, icon: "calendar", keyboardType: .numberPad, placeholder: "YYYY-MM-DD", identifier: "auth-register-birth-date-field")

                // Submit
                Button(action: validateAndSubmit) {
                    HStack {
                        if viewModel.isLoading { ProgressView().tint(.white) }
                        else { Text("회원가입").fontWeight(.semibold) }
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                }
                .buttonStyle(.borderedProminent)
                .tint(.appPrimary)
                .cornerRadius(CGFloat(AppTheme.Radius.md))
                .disabled(viewModel.isLoading)
                .accessibilityIdentifier("auth-register-submit-button")

                HStack(spacing: 4) {
                    Text("이미 계정이 있으신가요?").font(.appCaption).foregroundColor(.appMuted)
                    Button("로그인") { onNavigateToLogin() }
                        .font(.appCaption.weight(.semibold))
                        .foregroundColor(.appPrimary)
                        .accessibilityIdentifier("auth-register-login-link")
                }
            }
            .padding(24)
        }
        .background(Color.appCard)
        .cornerRadius(CGFloat(AppTheme.Radius.lg))
        .shadow(color: .black.opacity(0.05), radius: 8, y: 4)
        .padding(16)
        .frame(maxWidth: 400)
        .onChange(of: viewModel.authState) { _, newState in
            guard isSubmitting else {
                return
            }

            if newState is AuthState.Unauthenticated {
                isSubmitting = false
                isSuccess = true
            } else if newState is AuthState.Error {
                isSubmitting = false
            }
        }
    }

    private func validateAndSubmit() {
        nameError = nil; emailError = nil; passwordError = nil; confirmPasswordError = nil; phoneError = nil; birthDateError = nil
        if name.trimmingCharacters(in: .whitespaces).isEmpty { nameError = "이름을 입력해 주세요"; return }
        if name.count < 2 { nameError = "이름은 2자 이상이어야 합니다"; return }
        if email.trimmingCharacters(in: .whitespaces).isEmpty { emailError = "이메일을 입력해 주세요"; return }
        if !email.contains("@") { emailError = "유효한 이메일 형식이 아닙니다"; return }
        if password.count < 8 { passwordError = "비밀번호는 8자 이상이어야 합니다"; return }
        if !hasUpperCase { passwordError = "대문자를 포함해야 합니다"; return }
        if !hasLowerCase { passwordError = "소문자를 포함해야 합니다"; return }
        if !hasDigit { passwordError = "숫자를 포함해야 합니다"; return }
        if !hasSpecial { passwordError = "특수문자를 포함해야 합니다"; return }
        if password != confirmPassword { confirmPasswordError = "비밀번호가 일치하지 않습니다"; return }
        let phoneRegex = try? NSRegularExpression(pattern: "^01[016789]-?\\d{3,4}-?\\d{4}$")
        if phone.isEmpty {
            phoneError = "전화번호를 입력해 주세요"; return
        }
        if phoneRegex?.firstMatch(in: phone, range: NSRange(phone.startIndex..., in: phone)) == nil {
            phoneError = "유효한 전화번호를 입력해 주세요"; return
        }
        let birthDateRegex = try? NSRegularExpression(pattern: "^\\d{4}-\\d{2}-\\d{2}$")
        if birthDate.isEmpty {
            birthDateError = "생년월일을 입력해 주세요"; return
        }
        if birthDateRegex?.firstMatch(in: birthDate, range: NSRange(birthDate.startIndex..., in: birthDate)) == nil {
            birthDateError = "생년월일 형식: YYYY-MM-DD"; return
        }
        isSubmitting = true
        viewModel.register(name: name, email: email, password: password, phone: phone, birthDate: birthDate)
    }
}

// Reusable auth text field
struct AuthTextField: View {
    let label: String
    @Binding var text: String
    @Binding var error: String?
    var icon: String = ""
    var keyboardType: UIKeyboardType = .default
    var placeholder: String = ""
    var identifier: String = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.appLabel).foregroundColor(.appForeground)
            HStack {
                if !icon.isEmpty { Image(systemName: icon).foregroundColor(.appMuted) }
                TextField(placeholder.isEmpty ? "\(label)을(를) 입력하세요" : placeholder, text: $text)
                    .keyboardType(keyboardType)
                    .autocapitalization(.none)
                    .disableAutocorrection(true)
            }
            .padding(12)
            .background(Color.appBackground)
            .cornerRadius(CGFloat(AppTheme.Radius.md))
            .overlay(RoundedRectangle(cornerRadius: CGFloat(AppTheme.Radius.md)).stroke(error != nil ? Color.appDestructive : Color.appBorder, lineWidth: 1))
            .accessibilityIdentifier(identifier)
            if let error = error {
                Text(error).font(.appCaption).foregroundColor(.appDestructive)
            }
        }
    }
}

// Reusable auth secure field
struct AuthSecureField: View {
    let label: String
    @Binding var text: String
    @Binding var error: String?
    @Binding var visible: Bool
    var identifier: String = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.appLabel).foregroundColor(.appForeground)
            HStack {
                Image(systemName: "lock").foregroundColor(.appMuted)
                if visible {
                    TextField("비밀번호를 입력하세요", text: $text)
                } else {
                    SecureField("비밀번호를 입력하세요", text: $text)
                }
                Button(action: { visible.toggle() }) {
                    Image(systemName: visible ? "eye.slash" : "eye").foregroundColor(.appMuted)
                }
            }
            .padding(12)
            .background(Color.appBackground)
            .cornerRadius(CGFloat(AppTheme.Radius.md))
            .overlay(RoundedRectangle(cornerRadius: CGFloat(AppTheme.Radius.md)).stroke(error != nil ? Color.appDestructive : Color.appBorder, lineWidth: 1))
            .accessibilityIdentifier(identifier)
            if let error = error {
                Text(error).font(.appCaption).foregroundColor(.appDestructive)
            }
        }
    }
}

// Password requirement row
struct PasswordReqRow: View {
    let text: String
    let met: Bool

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: met ? "checkmark.circle.fill" : "xmark.circle")
                .font(.caption)
                .foregroundColor(met ? .appPrimary : .appMuted)
            Text(text)
                .font(.appCaption)
                .foregroundColor(met ? .appPrimary : .appMuted)
        }
    }
}
