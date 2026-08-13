import { render, screen } from "@testing-library/react";

import { MessageSectionNav } from "../MessageSectionNav";
import { useMessagesPermissionGuard } from "@/app/(shell)/messages/MessagesPermissionGuard";
import { useInitialUser } from "@/providers/UserProvider";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock("@/providers/UserProvider", () => ({
  useInitialUser: jest.fn(),
}));

jest.mock("@/app/(shell)/messages/MessagesPermissionGuard", () => ({
  useMessagesPermissionGuard: jest.fn(),
}));

const mockUseInitialUser = useInitialUser as jest.Mock;
const mockUseMessagesPermissionGuard = useMessagesPermissionGuard as jest.Mock;

const UNRELEASED_LABELS = ["템플릿", "자동 전송"];
const RELEASED_LABELS = ["전송하기", "설정"];
// 발송 기록 (the merged screen) is gated only by sender approval, not by
// owner status, so it behaves differently from both groups above: unlike
// UNRELEASED_LABELS it is never owner-gated, but unlike RELEASED_LABELS it
// is not exempt from the sender-approval check either.
const APPROVAL_GATED_LABEL = "발송 기록";

function renderNav() {
  render(<MessageSectionNav data-component="mobile_tests_message-section-nav" activeId="send" />);
}

describe("MessageSectionNav", () => {
  beforeEach(() => {
    mockUseInitialUser.mockReset();
    mockUseMessagesPermissionGuard.mockReset();
    mockUseMessagesPermissionGuard.mockReturnValue({
      isLoading: false,
      needsSenderApproval: false,
    });
  });

  it.each(["admin", "manager", "user"])("disables the unreleased sections for %s", (role) => {
    mockUseInitialUser.mockReturnValue({ role });

    renderNav();

    for (const label of UNRELEASED_LABELS) {
      expect(screen.getByRole("button", { name: label })).toBeDisabled();
    }
    for (const label of RELEASED_LABELS) {
      expect(screen.getByRole("button", { name: label })).toBeEnabled();
    }
    // Not owner-gated: a non-owner with sender approval already sorted
    // (needsSenderApproval: false, this suite's default mock) sees it enabled.
    expect(screen.getByRole("button", { name: APPROVAL_GATED_LABEL })).toBeEnabled();
  });

  it("gives the owner early access to the unreleased sections", () => {
    mockUseInitialUser.mockReturnValue({ role: "owner" });

    renderNav();

    for (const label of [...UNRELEASED_LABELS, ...RELEASED_LABELS, APPROVAL_GATED_LABEL]) {
      expect(screen.getByRole("button", { name: label })).toBeEnabled();
    }
  });

  it("keeps the unreleased sections disabled when there is no resolved user", () => {
    mockUseInitialUser.mockReturnValue(null);

    renderNav();

    for (const label of UNRELEASED_LABELS) {
      expect(screen.getByRole("button", { name: label })).toBeDisabled();
    }
    // Still not owner-gated even without a resolved user (isOwner is false
    // either way), so it stays enabled here too.
    expect(screen.getByRole("button", { name: APPROVAL_GATED_LABEL })).toBeEnabled();
  });

  it("disables every section except send and settings while sender approval is pending", () => {
    mockUseInitialUser.mockReturnValue({ role: "owner" });
    mockUseMessagesPermissionGuard.mockReturnValue({
      isLoading: false,
      needsSenderApproval: true,
    });

    renderNav();

    for (const label of [...UNRELEASED_LABELS, APPROVAL_GATED_LABEL]) {
      expect(screen.getByRole("button", { name: label })).toBeDisabled();
    }
    for (const label of RELEASED_LABELS) {
      expect(screen.getByRole("button", { name: label })).toBeEnabled();
    }
  });
});
