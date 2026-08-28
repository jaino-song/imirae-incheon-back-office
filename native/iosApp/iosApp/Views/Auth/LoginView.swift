import SwiftUI
import shared

struct LoginView: View {
    @ObservedObject var viewModel: AuthViewModelWrapper
    @State private var email = ""
    @State private var password = ""
    @State private var emailError: String?
    @State private var passwordError: String?
    @State private var passwordVisible = false

    var onNavigateToRegister: () -> Void = {}
    var onNavigateToForgotPassword: () -> Void = {}
    var onNavigateToVerifyEmail: () -> Void = {}
    var onNavigateToDashboard: () -> Void = {}
    var onNavigateToSelectBranch: () -> Void = {}
    var shouldNavigateToDashboard: () -> Bool = { true }

    init(
        viewModel: AuthViewModelWrapper = AuthViewModelWrapper(),
        onNavigateToRegister: @escaping () -> Void = {},
        onNavigateToForgotPassword: @escaping () -> Void = {},
        onNavigateToVerifyEmail: @escaping () -> Void = {},
        onNavigateToDashboard: @escaping () -> Void = {},
        onNavigateToSelectBranch: @escaping () -> Void = {},
        shouldNavigateToDashboard: @escaping () -> Bool = { true }
    ) {
        _viewModel = ObservedObject(wrappedValue: viewModel)
        self.onNavigateToRegister = onNavigateToRegister
        self.onNavigateToForgotPassword = onNavigateToForgotPassword
        self.onNavigateToVerifyEmail = onNavigateToVerifyEmail
        self.onNavigateToDashboard = onNavigateToDashboard
        self.onNavigateToSelectBranch = onNavigateToSelectBranch
        self.shouldNavigateToDashboard = shouldNavigateToDashboard
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                // Title
                Text("로그인")
                    .font(.appHeading2)
                    .foregroundColor(.appForeground)
                    .accessibilityIdentifier("auth-login-title")

                Text("이미래 인천 서비스에 로그인하세요")
                    .font(.appBodySmall)
                    .foregroundColor(.appMuted)

                // Error
                if let error = viewModel.errorMessage {
                    HStack {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .foregroundColor(.appDestructive)
                        Text(error)
                            .font(.appCaption)
                            .foregroundColor(.appDestructive)
                    }
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.appDestructive.opacity(0.1))
                    .cornerRadius(CGFloat(AppTheme.Radius.md))
                    .accessibilityIdentifier("auth-login-error")
                }

                // Email
                VStack(alignment: .leading, spacing: 4) {
                    Text("이메일").font(.appLabel).foregroundColor(.appForeground)
                    HStack {
                        Image(systemName: "envelope").foregroundColor(.appMuted)
                        TextField("이메일을 입력하세요", text: $email)
                            .keyboardType(.emailAddress)
                            .textContentType(.emailAddress)
                            .autocapitalization(.none)
                            .disableAutocorrection(true)
                    }
                    .padding(12)
                    .background(Color.appBackground)
                    .cornerRadius(CGFloat(AppTheme.Radius.md))
                    .overlay(RoundedRectangle(cornerRadius: CGFloat(AppTheme.Radius.md)).stroke(emailError != nil ? Color.appDestructive : Color.appBorder, lineWidth: 1))
                    .accessibilityIdentifier("auth-login-email-field")

                    if let error = emailError {
                        Text(error).font(.appCaption).foregroundColor(.appDestructive)
                    }
                }

                // Password
                VStack(alignment: .leading, spacing: 4) {
                    Text("비밀번호").font(.appLabel).foregroundColor(.appForeground)
                    HStack {
                        Image(systemName: "lock").foregroundColor(.appMuted)
                        if passwordVisible {
                            TextField("비밀번호를 입력하세요", text: $password)
                                .textContentType(.password)
                        } else {
                            SecureField("비밀번호를 입력하세요", text: $password)
                                .textContentType(.password)
                        }
                        Button(action: { passwordVisible.toggle() }) {
                            Image(systemName: passwordVisible ? "eye.slash" : "eye")
                                .foregroundColor(.appMuted)
                        }
                    }
                    .padding(12)
                    .background(Color.appBackground)
                    .cornerRadius(CGFloat(AppTheme.Radius.md))
                    .overlay(RoundedRectangle(cornerRadius: CGFloat(AppTheme.Radius.md)).stroke(passwordError != nil ? Color.appDestructive : Color.appBorder, lineWidth: 1))
                    .accessibilityIdentifier("auth-login-password-field")

                    if let error = passwordError {
                        Text(error).font(.appCaption).foregroundColor(.appDestructive)
                    }
                }

                // Login button
                Button(action: validateAndSubmit) {
                    HStack {
                        if viewModel.isLoading {
                            ProgressView().tint(.white)
                        } else {
                            Text("로그인").fontWeight(.semibold)
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                }
                .buttonStyle(.borderedProminent)
                .tint(.appPrimary)
                .cornerRadius(CGFloat(AppTheme.Radius.md))
                .disabled(viewModel.isLoading)
                .accessibilityIdentifier("auth-login-submit-button")

                // Divider
                HStack {
                    Rectangle().fill(Color.appBorder).frame(height: 1)
                    Text("또는").font(.appCaption).foregroundColor(.appMuted)
                    Rectangle().fill(Color.appBorder).frame(height: 1)
                }

                // Kakao button
                Button(action: { /* TODO: Kakao OAuth */ }) {
                    Text("카카오로 로그인")
                        .fontWeight(.semibold)
                        .foregroundColor(Color(hex: "3C1E1E"))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                }
                .background(Color(hex: "FEE500"))
                .cornerRadius(CGFloat(AppTheme.Radius.md))
                .disabled(viewModel.isLoading)
                .accessibilityIdentifier("auth-login-kakao-button")

                // Forgot password
                HStack {
                    Spacer()
                    Button("비밀번호를 잊으셨나요?") { onNavigateToForgotPassword() }
                        .font(.appCaption)
                        .foregroundColor(.appMuted)
                        .accessibilityIdentifier("auth-login-forgot-password-link")
                }

                // Register link
                HStack(spacing: 4) {
                    Text("계정이 없으신가요?").font(.appCaption).foregroundColor(.appMuted)
                    Button("회원가입") { onNavigateToRegister() }
                        .font(.appCaption.weight(.semibold))
                        .foregroundColor(.appPrimary)
                        .accessibilityIdentifier("auth-login-register-link")
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
            if newState is AuthState.Authenticated, shouldNavigateToDashboard() { onNavigateToDashboard() }
            if newState is AuthState.RequiresBranchSelection { onNavigateToSelectBranch() }
        }
    }

    private func validateAndSubmit() {
        emailError = nil; passwordError = nil
        if email.trimmingCharacters(in: .whitespaces).isEmpty {
            emailError = "이메일을 입력해 주세요"; return
        }
        if !email.contains("@") {
            emailError = "유효한 이메일 형식이 아닙니다"; return
        }
        if password.isEmpty {
            passwordError = "비밀번호를 입력해 주세요"; return
        }
        viewModel.login(email: email, password: password)
    }
}
