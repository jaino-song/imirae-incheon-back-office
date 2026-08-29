import SwiftUI
import shared

struct ChatView: View {
    @StateObject private var viewModel = ChatViewModelWrapper()
    @State private var inputText = ""

    var body: some View {
        VStack(spacing: 0) {
            header

            ScrollViewReader { proxy in
                if viewModel.isLoading && viewModel.messages.isEmpty {
                    LoadingView()
                } else if let errorMessage = viewModel.errorMessage, viewModel.messages.isEmpty {
                    ErrorView(message: errorMessage) {
                        viewModel.loadHistory()
                    }
                } else {
                    ScrollView {
                        LazyVStack(spacing: AppTheme.Spacing.sm) {
                            ForEach(viewModel.messages, id: \.id) { message in
                                ChatMessageRow(message: message)
                                    .accessibilityIdentifier("chat-message-\(message.id)")
                            }
                        }
                        .padding(.horizontal, AppTheme.Spacing.lg)
                        .padding(.vertical, AppTheme.Spacing.md)
                    }
                    .onChange(of: viewModel.messages.count) { _, count in
                        guard count > 0, let lastMessageId = viewModel.messages.last?.id else {
                            return
                        }

                        withAnimation {
                            proxy.scrollTo(lastMessageId, anchor: .bottom)
                        }
                    }
                }
            }

            Divider()
                .overlay(Color.appBorder)

            HStack(spacing: AppTheme.Spacing.sm) {
                TextField("메시지를 입력하세요...", text: $inputText)
                    .font(.appBody)
                    .padding(.horizontal, AppTheme.Spacing.md)
                    .padding(.vertical, AppTheme.Spacing.sm)
                    .background(Color.appCard)
                    .overlay(
                        RoundedRectangle(cornerRadius: AppTheme.Radius.pill)
                            .stroke(Color.appBorder, lineWidth: 1)
                    )
                    .cornerRadius(AppTheme.Radius.pill)
                    .disabled(viewModel.isSending)
                    .accessibilityIdentifier("chat-input")

                Button(action: sendMessage) {
                    if viewModel.isSending {
                        ProgressView()
                            .frame(width: 24, height: 24)
                    } else {
                        Image(systemName: "paperplane.fill")
                            .font(.appHeading6)
                            .foregroundColor(isSendEnabled ? .appPrimaryForeground : .appMutedForeground)
                            .frame(width: 40, height: 40)
                            .background(isSendEnabled ? Color.appPrimary : Color.appMuted)
                            .cornerRadius(AppTheme.Radius.pill)
                    }
                }
                .disabled(viewModel.isSending || !isSendEnabled)
                .accessibilityIdentifier("chat-send-button")
            }
            .padding(AppTheme.Spacing.lg)
            .background(Color.appBackground)
        }
        .background(Color.appBackground)
        .onAppear {
            viewModel.loadHistory()
        }
        .accessibilityIdentifier("chat-screen")
    }

    private var isSendEnabled: Bool {
        !inputText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var header: some View {
        HStack {
            Text("AI 채팅")
                .font(.appHeading2)
                .foregroundColor(.appForeground)
                .accessibilityIdentifier("chat-title")

            Spacer()

            Button(action: { viewModel.loadHistory() }) {
                Image(systemName: "arrow.clockwise")
                    .font(.appHeading6)
                    .foregroundColor(.appSecondaryForeground)
                    .frame(width: 36, height: 36)
                    .background(Color.appSecondary)
                    .cornerRadius(AppTheme.Radius.md)
            }
            .accessibilityIdentifier("chat-refresh")
        }
        .padding(AppTheme.Spacing.lg)
        .background(Color.appBackground)
    }

    private func sendMessage() {
        let trimmed = inputText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            return
        }

        viewModel.sendMessage(trimmed)
        inputText = ""
    }
}

private struct ChatMessageRow: View {
    let message: ChatMessage

    var body: some View {
        let isUser = message.role == "user"

        HStack {
            if isUser {
                Spacer(minLength: AppTheme.Spacing.xl)
            }

            VStack(alignment: .leading, spacing: AppTheme.Spacing.xs) {
                if isUser {
                    Text(message.content)
                        .font(.appBody)
                        .foregroundColor(.appPrimaryForeground)
                } else {
                    MarkdownText(text: message.content)
                }
            }
            .padding(AppTheme.Spacing.md)
            .background(isUser ? Color.appPrimary : Color.appCard)
            .overlay(
                RoundedRectangle(cornerRadius: AppTheme.Radius.lg)
                    .stroke(isUser ? Color.appPrimary : Color.appBorder, lineWidth: 1)
            )
            .cornerRadius(AppTheme.Radius.lg)
            .id(message.id)

            if !isUser {
                Spacer(minLength: AppTheme.Spacing.xl)
            }
        }
    }
}

private struct MarkdownText: View {
    let text: String

    var body: some View {
        if let attributed = try? AttributedString(markdown: text) {
            Text(attributed)
                .font(.appBody)
                .foregroundColor(.appForeground)
        } else {
            Text(text)
                .font(.appBody)
                .foregroundColor(.appForeground)
        }
    }
}

@MainActor
final class ChatViewModelWrapper: ObservableObject {
    private let viewModel: ChatViewModel
    private var stateCollector: IOSStateFlowCollector?

    @Published var isLoading: Bool = false
    @Published var isSending: Bool = false
    @Published var messages: [ChatMessage] = []
    @Published var errorMessage: String?

    init(viewModel: ChatViewModel = KoinHelper.shared.chatViewModel()) {
        self.viewModel = viewModel
        observeUiState()
    }

    deinit {
        stateCollector?.stop()
    }

    private func observeUiState() {
        let collector = IOSStateFlowCollector { [weak self] value in
            guard let state = value as? ChatUiState else { return }
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.isLoading = state.isLoading
                self.isSending = state.isSending
                self.messages = state.messages
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

    func loadHistory() {
        viewModel.loadHistory()
    }

    func sendMessage(_ text: String) {
        viewModel.sendMessage(message: text)
    }
}
