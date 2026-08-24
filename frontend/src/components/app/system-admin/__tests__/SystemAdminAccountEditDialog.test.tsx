import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { SystemAdminUser } from "@/lib/api/users";

import { SystemAdminAccountEditDialog } from "../SystemAdminAccountEditDialog";

const account: SystemAdminUser = {
  id: "approved-user",
  kakaoId: null,
  email: "approved@example.com",
  name: "승인된 계정",
  phone: "010-1111-1111",
  birthDate: "19900101",
  profileImage: null,
  role: "manager",
  createdAt: "2026-06-01T00:00:00.000Z",
  emailVerified: true,
  authProvider: "email",
  branches: [{ id: "branch-gangnam", name: "강남점", role: "manager" }],
  approvalStatus: "approved",
  requestedRole: "manager",
};

const inactiveOwnedAdminAccount: SystemAdminUser = {
  ...account,
  id: "approved-admin",
  name: "비활성 지점장",
  role: "admin",
  branches: [{ id: "branch-inactive", name: "서대문점", role: "admin" }],
  requestedRole: "admin",
};

describe("SystemAdminAccountEditDialog", () => {
  it("disables the form while saving, keeps the dialog open, and exposes a server error", () => {
    const onOpenChange = jest.fn();

    render(
      <SystemAdminAccountEditDialog
        open
        account={account}
        branches={[
          { id: "branch-gangnam", name: "강남점", isActive: true },
          { id: "branch-songdo", name: "송도점", isActive: true },
        ]}
        ownedBranchIds={[]}
        isPending
        errorMessage="서버에서 계정 수정을 거절했습니다."
        onOpenChange={onOpenChange}
        onSubmit={jest.fn()}
      />,
    );

    expect(screen.getByRole("combobox", { name: /^권한/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "강남점 지점 선택 해제" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "취소" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "저장 중…" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("서버에서 계정 수정을 거절했습니다.");

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "계정 수정" })).toBeInTheDocument();
  });

  it("requires an active branch when only an inactive owned branch is locked", async () => {
    const onSubmit = jest.fn();

    render(
      <SystemAdminAccountEditDialog
        open
        account={inactiveOwnedAdminAccount}
        branches={[
          { id: "branch-inactive", name: "서대문점", isActive: false },
          { id: "branch-active", name: "송도점", isActive: true },
        ]}
        ownedBranchIds={["branch-inactive"]}
        isPending={false}
        onOpenChange={jest.fn()}
        onSubmit={onSubmit}
      />,
    );

    expect(
      screen.getByRole("button", {
        name: "서대문점 (비활성) 지점: 지점장 임명으로 선택 고정",
      }),
    ).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    const error = await screen.findByRole("alert");
    const branchGroup = screen.getByRole("group", { name: "소속 지점" });
    expect(error).toHaveTextContent("활성 지점을 한 곳 이상 선택해 주세요.");
    expect(branchGroup).toHaveAttribute("aria-invalid", "true");
    expect(branchGroup).toHaveAttribute("aria-describedby", error.id);
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "송도점 지점 선택" }));
    await waitFor(() => expect(branchGroup).not.toHaveAttribute("aria-invalid"));
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        role: "admin",
        branchIds: ["branch-inactive", "branch-active"],
        expectedRole: "admin",
        expectedBranchIds: ["branch-inactive"],
      }),
    );
  });

  it("refuses submission when the initial role snapshot is unknown", async () => {
    const onSubmit = jest.fn();

    render(
      <SystemAdminAccountEditDialog
        open
        account={{ ...account, role: null }}
        branches={[{ id: "branch-gangnam", name: "강남점", isActive: true }]}
        ownedBranchIds={[]}
        isPending={false}
        onOpenChange={jest.fn()}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "현재 계정 권한을 확인할 수 없습니다. 목록을 새로고침해 주세요.",
    );

    fireEvent.change(screen.getByRole("combobox", { name: /^권한/ }), {
      target: { value: "manager" },
    });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "현재 계정 권한을 확인할 수 없습니다. 목록을 새로고침해 주세요.",
      ),
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("preserves hidden initial memberships across role changes and submission", async () => {
    const onSubmit = jest.fn();
    const partialAdminAccount: SystemAdminUser = {
      ...inactiveOwnedAdminAccount,
      branches: [
        { id: "branch-active", name: "마포점", role: "admin" },
        { id: "branch-inactive", name: "서대문점", role: "admin" },
        { id: "branch-hidden", name: "목록에 없는 지점", role: "admin" },
      ],
    };

    render(
      <SystemAdminAccountEditDialog
        open
        account={partialAdminAccount}
        branches={[
          { id: "branch-active", name: "마포점", isActive: true },
          { id: "branch-inactive", name: "서대문점", isActive: false },
        ]}
        ownedBranchIds={["branch-active", "branch-inactive"]}
        isPending={false}
        onOpenChange={jest.fn()}
        onSubmit={onSubmit}
      />,
    );

    expect(
      screen.getByText("현재 지점 목록에 표시되지 않는 기존 소속 1개를 보존 중입니다."),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: /^권한/ }), {
      target: { value: "manager" },
    });
    expect(
      screen.getByRole("button", {
        name: "서대문점 (비활성) 지점: 비활성으로 선택 불가",
      }),
    ).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        role: "manager",
        branchIds: ["branch-active", "branch-hidden"],
        expectedRole: "admin",
        expectedBranchIds: ["branch-active", "branch-inactive", "branch-hidden"],
      }),
    );
  });
});
