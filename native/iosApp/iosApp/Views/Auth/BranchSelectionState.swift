import shared

struct BranchItem: Identifiable, Equatable {
    let id: String
    let name: String
    let role: String
}

enum BranchSelectionState: Equatable {
    case idle
    case loading
    case loaded([BranchItem])
    case error

    static func from(_ state: BranchesUiState) -> BranchSelectionState {
        if state is BranchesUiState.Idle {
            return .idle
        }

        if state is BranchesUiState.Loading {
            return .loading
        }

        if let loaded = state as? BranchesUiState.Loaded {
            return .loaded(loaded.branches.map { branch in
                BranchItem(
                    id: branch.id,
                    name: branch.name,
                    role: roleLabel(for: branch.role)
                )
            })
        }

        // The shared layer already maps transport failures to a user message.
        // Keep that message out of the presentation state so response details
        // cannot accidentally be rendered by the iOS branch screen.
        return .error
    }

    private static func roleLabel(for role: String?) -> String {
        switch role {
        case "owner":
            return "소유자"
        case "admin":
            return "관리자"
        default:
            return "사용자"
        }
    }
}
