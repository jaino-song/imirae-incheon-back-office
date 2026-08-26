import XCTest
import shared
@testable import iosApp

final class BranchSelectionStateTests: XCTestCase {
    func testLoadedStateUsesOnlyAuthenticatedBranchPayload() {
        let first = Branch(
            id: "branch-1",
            name: "본점",
            slug: nil,
            description: nil,
            role: "owner"
        )
        let second = Branch(
            id: "branch-2",
            name: "분점",
            slug: nil,
            description: nil,
            role: "admin"
        )

        let state = BranchSelectionState.from(
            BranchesUiState.Loaded(branches: [first, second])
        )

        XCTAssertEqual(
            state,
            .loaded([
                BranchItem(id: "branch-1", name: "본점", role: "소유자"),
                BranchItem(id: "branch-2", name: "분점", role: "관리자")
            ])
        )
    }

    func testEmptyLoadedStateRemainsLoadedAndDoesNotInventAnOption() {
        XCTAssertEqual(
            BranchSelectionState.from(BranchesUiState.Loaded(branches: [])),
            .loaded([])
        )
    }

    func testLoadingAndIdleStatesAreDistinct() {
        XCTAssertEqual(BranchSelectionState.from(BranchesUiState.Idle()), .idle)
        XCTAssertEqual(BranchSelectionState.from(BranchesUiState.Loading()), .loading)
    }

    func testErrorsDoNotExposeTheRawSharedMessage() {
        XCTAssertEqual(
            BranchSelectionState.from(
                BranchesUiState.Error(message: "private response body")
            ),
            .error
        )
    }
}
