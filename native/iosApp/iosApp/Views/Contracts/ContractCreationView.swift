import SwiftUI

struct ContractCreationView: View {
    var onNavigateBack: () -> Void = {}

    var body: some View {
        VStack(alignment: .leading, spacing: AppTheme.Spacing.md) {
            HStack {
                Button(action: onNavigateBack) {
                    Image(systemName: "chevron.left")
                        .font(.appHeading5)
                }
                .accessibilityIdentifier("contract-creation-back")

                Text("계약 생성")
                    .font(.appHeading2)
                    .fontWeight(.bold)
                    .accessibilityIdentifier("contract-creation-title")
            }

            EmptyView_(message: "계약 문서 업로드는 아직 지원되지 않습니다. 문서 목록과 수정·삭제는 사용할 수 있습니다.")
        }
        .padding(AppTheme.Spacing.lg)
        .background(Color.appBackground)
        .accessibilityIdentifier("contract-creation-screen")
    }
}
