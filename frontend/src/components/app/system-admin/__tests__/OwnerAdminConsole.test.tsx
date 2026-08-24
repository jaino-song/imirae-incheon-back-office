import fs from "node:fs";

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { OwnerAdminConsole } from "../OwnerAdminConsole";

const source = fs.readFileSync(require.resolve("../OwnerAdminConsole"), "utf8");

jest.mock("@/components/app/settings/NotificationTestSection", () => ({
  NotificationTestSection: () => <div>알림 테스트 실행 도구</div>,
}));

jest.mock("@tanstack/react-query", () => ({
  useMutation: jest.fn(),
  useQuery: jest.fn(),
  useQueryClient: jest.fn(),
}));

const mockedUseQuery = jest.mocked(useQuery);
const mockedUseMutation = jest.mocked(useMutation);
const mockedUseQueryClient = jest.mocked(useQueryClient);
const approveMutate = jest.fn();
const resetMutation = jest.fn();
const invalidateQueries = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  mockedUseQueryClient.mockReturnValue({
    invalidateQueries,
  } as unknown as ReturnType<typeof useQueryClient>);
  mockedUseMutation.mockReturnValue({
    mutate: approveMutate,
    isPending: false,
    reset: resetMutation,
  } as unknown as ReturnType<typeof useMutation>);
  mockedUseQuery.mockImplementation(({ queryKey }) => {
    if (Array.isArray(queryKey) && queryKey[0] === "systemAdminUsers") {
      return {
        data: [
          {
            id: "owner-1",
            kakaoId: null,
            email: "owner@example.com",
            name: "김지점장",
            phone: "010-1111-2222",
            birthDate: "19800101",
            profileImage: null,
            role: "owner",
            createdAt: "2026-05-01T00:00:00.000Z",
            emailVerified: true,
            authProvider: "email",
            branches: [{ id: "branch-real-gangnam", name: "강남점", role: "owner" }],
            approvalStatus: "approved",
            requestedRole: "owner",
          },
          {
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
            branches: [{ id: "branch-real-gangnam", name: "강남점", role: "manager" }],
            approvalStatus: "approved",
            requestedRole: "manager",
          },
          {
            id: "approved-admin",
            kakaoId: null,
            email: "admin@example.com",
            name: "기존 지점장 계정",
            phone: "010-3333-3333",
            birthDate: "19850303",
            profileImage: null,
            role: "admin",
            createdAt: "2026-05-15T00:00:00.000Z",
            emailVerified: true,
            authProvider: "email",
            branches: [
              { id: "branch-admin-owned", name: "마포점", role: "admin" },
              { id: "branch-admin-inactive", name: "서대문점", role: "admin" },
            ],
            approvalStatus: "approved",
            requestedRole: "admin",
          },
          {
            id: "pending-user",
            kakaoId: null,
            email: "pending@example.com",
            name: "가입 대기 계정",
            phone: "010-2222-2222",
            birthDate: "19920202",
            profileImage: null,
            role: null,
            createdAt: "2026-06-04T00:00:00.000Z",
            emailVerified: true,
            authProvider: "email",
            branches: [],
            approvalStatus: "pending",
            requestedRole: "user",
          },
          {
            id: "rejected-user",
            kakaoId: null,
            email: "rejected@example.com",
            name: "가입 거절 계정",
            phone: "010-4444-4444",
            birthDate: "19940404",
            profileImage: null,
            role: null,
            createdAt: "2026-06-03T00:00:00.000Z",
            emailVerified: true,
            authProvider: "email",
            branches: [],
            approvalStatus: "rejected",
            requestedRole: "user",
          },
        ],
        error: null,
        isLoading: false,
      } as unknown as ReturnType<typeof useQuery>;
    }

    if (Array.isArray(queryKey) && queryKey[0] === "systemAdminBranchRequests") {
      return {
        data: [
          {
            id: "branch-real-gangnam",
            name: "강남점",
            slug: "gangnam",
            region: "서울",
            district: "강남구",
            address: "서울 강남구",
            phone: "02-1234-5678",
            email: "gangnam@example.com",
            isActive: true,
            createdAt: "2026-06-01T00:00:00.000Z",
            updatedAt: "2026-06-04T00:00:00.000Z",
            owner: {
              id: "owner-1",
              name: "김오너",
              email: "owner@example.com",
              phone: "010-1111-2222",
              role: "owner",
            },
            messageSenderApproval: {
              approvalStatus: "pending",
              requestedAt: "2026-06-04T09:00:00.000Z",
              approvedAt: null,
              requestedBy: {
                id: "manager-1",
                name: "박매니저",
                email: "manager@example.com",
                phone: "010-3333-4444",
                role: "manager",
              },
            },
          },
          {
            id: "branch-admin-owned",
            name: "마포점",
            slug: "mapo",
            region: "서울",
            district: "마포구",
            address: "서울 마포구",
            phone: "02-2222-2222",
            email: "mapo@example.com",
            isActive: true,
            createdAt: "2026-06-01T00:00:00.000Z",
            updatedAt: "2026-06-04T00:00:00.000Z",
            owner: {
              id: "approved-admin",
              name: "기존 지점장 계정",
              email: "admin@example.com",
              phone: "010-3333-3333",
              role: "admin",
            },
            messageSenderApproval: {
              approvalStatus: "not_requested",
              requestedAt: null,
              approvedAt: null,
              requestedBy: null,
            },
          },
          {
            id: "branch-songdo-ownerless",
            name: "송도점",
            slug: "songdo",
            region: "인천",
            district: "연수구",
            address: "인천 연수구",
            phone: "032-000-0000",
            email: "songdo@example.com",
            isActive: true,
            createdAt: "2026-06-01T00:00:00.000Z",
            updatedAt: "2026-06-04T00:00:00.000Z",
            owner: null,
            messageSenderApproval: {
              approvalStatus: "not_requested",
              requestedAt: null,
              approvedAt: null,
              requestedBy: null,
            },
          },
          {
            id: "branch-admin-inactive",
            name: "서대문점",
            slug: "seodaemun",
            region: "서울",
            district: "서대문구",
            address: "서울 서대문구",
            phone: "02-3333-3333",
            email: "seodaemun@example.com",
            isActive: false,
            createdAt: "2026-06-01T00:00:00.000Z",
            updatedAt: "2026-06-04T00:00:00.000Z",
            owner: {
              id: "approved-admin",
              name: "기존 지점장 계정",
              email: "admin@example.com",
              phone: "010-3333-3333",
              role: "admin",
            },
            messageSenderApproval: {
              approvalStatus: "not_requested",
              requestedAt: null,
              approvedAt: null,
              requestedBy: null,
            },
          },
        ],
        error: null,
        isLoading: false,
      } as unknown as ReturnType<typeof useQuery>;
    }

    return {
      data: [],
      error: null,
      isLoading: false,
    } as unknown as ReturnType<typeof useQuery>;
  });
});

describe("OwnerAdminConsole", () => {
  it("uses the warning color family for incomplete account information", () => {
    const incompleteStat = source.slice(
      source.indexOf('label: "추가 정보 필요"'),
      source.indexOf("];", source.indexOf('label: "추가 정보 필요"')),
    );

    expect(incompleteStat).toContain("colorIndex: 3");
  });

  it("starts with live branch data and omits mock-only sections", async () => {
    render(<OwnerAdminConsole />);

    await waitFor(() => {
      expect(screen.getAllByText("강남점").length).toBeGreaterThan(0);
    });
    expect(screen.queryByRole("button", { name: "회원가입 관리" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "정부지원금 관리" })).not.toBeInTheDocument();
    expect(screen.queryByText("김서윤")).not.toBeInTheDocument();
    expect(screen.queryByText("2026 돌봄 바우처 단가 반영")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "검색 열기" }));
    expect(screen.getByRole("textbox", { name: "지점 관리 검색" })).toBeInTheDocument();
  });

  it("renders branch management from API data instead of branch mock records", async () => {
    render(<OwnerAdminConsole />);

    await waitFor(() => {
      expect(screen.getAllByText("강남점").length).toBeGreaterThan(0);
    });
    expect(screen.getByText("지점장: 박매니저")).toBeInTheDocument();
    expect(screen.queryByText("신청인: 박매니저")).not.toBeInTheDocument();
    expect(screen.getAllByText("메시지 신청").length).toBeGreaterThan(0);
    expect(screen.queryByText("부평점")).not.toBeInTheDocument();
  });

  it("hides branch status pills on all branches and shows them on the message request tab", async () => {
    render(<OwnerAdminConsole />);

    await waitFor(() => {
      expect(screen.getAllByText("강남점").length).toBeGreaterThan(0);
    });
    expect(screen.getByRole("button", { name: "전체 지점" })).toBeInTheDocument();

    const allBranchesItem = screen.getByRole("button", { name: /강남점/ });
    expect(within(allBranchesItem).queryByText("서울 강남구")).not.toBeInTheDocument();
    expect(within(allBranchesItem).queryByText("메시지 승인 신청")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "메시지 신청" }));

    const messageRequestItem = screen.getByRole("button", { name: /강남점/ });
    expect(within(messageRequestItem).getByText("메시지 승인 신청")).toBeInTheDocument();
  });

  it("approves a pending message sender request from the branch detail", async () => {
    render(<OwnerAdminConsole />);

    await waitFor(() => {
      expect(screen.getAllByText("강남점").length).toBeGreaterThan(0);
    });
    // Select the 강남점 list item to open its detail panel (auto-selection now
    // requires desktop viewport; in tests splitLayoutMode stays null so we must
    // click explicitly).
    fireEvent.click(screen.getByRole("button", { name: /강남점/ }));
    fireEvent.click(screen.getByRole("button", { name: "승인" }));

    expect(approveMutate).toHaveBeenCalledWith("branch-real-gangnam");
  });

  it("opens branch forms and clears the edit detail when changing list tabs", async () => {
    render(<OwnerAdminConsole />);

    fireEvent.click(screen.getByRole("button", { name: "지점 추가" }));

    expect(screen.getByRole("heading", { name: "지점 추가" })).toBeInTheDocument();
    expect(screen.getByLabelText(/지점명/)).toHaveValue("");
    expect(screen.getByLabelText(/지점장/)).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /승인된 계정/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    fireEvent.click(screen.getByRole("button", { name: /강남점/ }));

    expect(screen.getByText("지점장")).toBeInTheDocument();
    expect(screen.queryByText("오너")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "수정" }));

    expect(screen.getByRole("heading", { name: "지점 정보 수정" })).toBeInTheDocument();
    expect(screen.getByLabelText(/지점명/)).toHaveValue("강남점");
    expect(screen.getByLabelText(/영문 지점 코드/)).toHaveValue("gangnam");
    expect(screen.queryByLabelText("구·군")).not.toBeInTheDocument();
    expect(screen.getByLabelText("사무실 주소")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "메시지 신청" }));

    expect(screen.queryByRole("heading", { name: "지점 정보 수정" })).not.toBeInTheDocument();
    expect(
      screen.getAllByText("지점을 선택하면 운영 정보와 승인 신청이 표시됩니다.").length,
    ).toBeGreaterThan(0);
  });

  it("manages pending accounts inside the same split layout as branch management", () => {
    const { container } = render(<OwnerAdminConsole />);

    fireEvent.click(screen.getAllByRole("button", { name: "계정 관리" })[0]);

    expect(container.querySelector('[data-slot="split-layout"]')).toBeInTheDocument();
    expect(
      container.querySelector('[data-component="desktop_system-admin_sections_pending-approvals"]'),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "가입 대기" }));
    fireEvent.click(screen.getByRole("button", { name: /가입 대기 계정/ }));

    const roleSelect = screen.getByRole("combobox", {
      name: "가입 대기 계정 승인 권한 선택",
    });
    expect(roleSelect).toHaveValue("user");
    expect(screen.getByRole("button", { name: "승인" })).toBeDisabled();
    fireEvent.change(screen.getByRole("combobox", {
      name: "가입 대기 계정 승인 지점 선택",
    }), { target: { value: "branch-real-gangnam" } });
    fireEvent.change(roleSelect, { target: { value: "admin" } });

    // Choosing 지점장 requires an additional 임명 지점 selection before 승인 unlocks.
    expect(screen.getByRole("button", { name: "승인" })).toBeDisabled();
    fireEvent.change(
      screen.getByRole("combobox", { name: "가입 대기 계정 임명 지점 선택" }),
      { target: { value: "branch-songdo-ownerless" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "승인" }));

    expect(approveMutate).toHaveBeenCalledWith({
      id: "pending-user",
      role: "admin",
      branchId: "branch-real-gangnam",
      ownerBranchId: "branch-songdo-ownerless",
    });
    expect(screen.getByRole("button", { name: "거절" })).toBeInTheDocument();
  });

  it("limits the 임명 지점 select to ownerless active branches when 지점장 is selected", () => {
    render(<OwnerAdminConsole />);

    fireEvent.click(screen.getAllByRole("button", { name: "계정 관리" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "가입 대기" }));
    fireEvent.click(screen.getByRole("button", { name: /가입 대기 계정/ }));

    fireEvent.change(
      screen.getByRole("combobox", { name: "가입 대기 계정 승인 권한 선택" }),
      { target: { value: "admin" } },
    );

    const ownerBranchSelect = screen.getByRole("combobox", {
      name: "가입 대기 계정 임명 지점 선택",
    });
    const optionLabels = within(ownerBranchSelect)
      .getAllByRole("option")
      .map((option) => option.textContent);

    expect(optionLabels).toEqual(["임명 지점 선택", "송도점"]);
    expect(screen.getByRole("button", { name: "승인" })).toBeDisabled();
  });

  it("edits an approved account's role and exact branch set inside a dialog", async () => {
    render(<OwnerAdminConsole />);

    fireEvent.click(screen.getAllByRole("button", { name: "계정 관리" })[0]);
    fireEvent.click(screen.getByRole("button", { name: /승인된 계정/ }));

    fireEvent.click(screen.getByRole("button", { name: "수정" }));

    expect(screen.getByRole("heading", { name: "계정 수정" })).toBeInTheDocument();
    const roleSelect = screen.getByRole("combobox", {
      name: /^권한/,
    });
    const optionLabels = within(roleSelect)
      .getAllByRole("option")
      .map((option) => option.textContent);

    expect(optionLabels).toEqual(["매니저", "직원"]);
    expect(roleSelect).toHaveValue("manager");
    expect(screen.getByRole("button", { name: "강남점 지점 선택 해제" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "송도점 지점 선택" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    fireEvent.click(screen.getByRole("button", { name: "강남점 지점 선택 해제" }));
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "지점을 한 곳 이상 선택해 주세요.",
    );
    expect(screen.getByRole("group", { name: "소속 지점" })).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(approveMutate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "송도점 지점 선택" }));
    fireEvent.change(roleSelect, { target: { value: "user" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() =>
      expect(approveMutate).toHaveBeenCalledWith({
        id: "approved-user",
        role: "user",
        branchIds: ["branch-songdo-ownerless"],
        expectedRole: "manager",
        expectedBranchIds: ["branch-real-gangnam"],
      }),
    );
  });

  it("does not expose an inert edit action for rejected accounts", () => {
    render(<OwnerAdminConsole />);

    fireEvent.click(screen.getAllByRole("button", { name: "계정 관리" })[0]);
    fireEvent.click(screen.getByRole("button", { name: /가입 거절 계정/ }));

    expect(screen.queryByRole("button", { name: "수정" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "계정 수정" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /승인된 계정/ }));
    fireEvent.click(screen.getByRole("button", { name: "수정" }));

    expect(screen.getByRole("heading", { name: "계정 수정" })).toBeInTheDocument();
  });

  it("reloads a stale account snapshot and explains a 409 conflict before retry", async () => {
    render(<OwnerAdminConsole />);

    fireEvent.click(screen.getAllByRole("button", { name: "계정 관리" })[0]);
    fireEvent.click(screen.getByRole("button", { name: /승인된 계정/ }));
    fireEvent.click(screen.getByRole("button", { name: "수정" }));

    const roleSelect = screen.getByRole("combobox", { name: /^권한/ });
    fireEvent.change(roleSelect, { target: { value: "user" } });
    expect(roleSelect).toHaveValue("user");

    const accountMutationOptions = mockedUseMutation.mock.calls[5]?.[0] as unknown as {
      onError?: (error: unknown) => Promise<void>;
    };
    expect(accountMutationOptions?.onError).toBeDefined();

    await act(async () => {
      await accountMutationOptions.onError?.({
        isAxiosError: true,
        response: { status: 409 },
      });
    });

    expect(invalidateQueries).toHaveBeenCalledWith(
      { queryKey: ["systemAdminUsers"] },
      { throwOnError: true },
    );
    expect(invalidateQueries).toHaveBeenCalledWith(
      { queryKey: ["systemAdminBranchRequests"] },
      { throwOnError: true },
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "다른 곳에서 계정 정보가 변경되어 최신 정보를 불러왔습니다. 내용을 다시 확인한 뒤 저장해 주세요.",
    );
    expect(screen.getByRole("combobox", { name: /^권한/ })).toHaveValue("manager");
  });

  it("keeps the draft and requests a manual refresh when stale-data refetch fails", async () => {
    render(<OwnerAdminConsole />);

    fireEvent.click(screen.getAllByRole("button", { name: "계정 관리" })[0]);
    fireEvent.click(screen.getByRole("button", { name: /승인된 계정/ }));
    fireEvent.click(screen.getByRole("button", { name: "수정" }));

    const roleSelect = screen.getByRole("combobox", { name: /^권한/ });
    fireEvent.change(roleSelect, { target: { value: "user" } });
    invalidateQueries
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(undefined);

    const accountMutationOptions = mockedUseMutation.mock.calls[5]?.[0] as unknown as {
      onError?: (error: unknown) => Promise<void>;
    };
    await act(async () => {
      await accountMutationOptions.onError?.({
        isAxiosError: true,
        response: { status: 409 },
      });
    });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "다른 곳에서 계정 정보가 변경되었습니다. 창을 닫고 목록을 새로고침한 뒤 다시 시도해 주세요.",
    );
    expect(screen.getByRole("combobox", { name: /^권한/ })).toHaveValue("user");
  });

  it("keeps an existing admin role while locking active and inactive owned branches", async () => {
    render(<OwnerAdminConsole />);

    fireEvent.click(screen.getAllByRole("button", { name: "계정 관리" })[0]);
    fireEvent.click(screen.getByRole("button", { name: /기존 지점장 계정/ }));
    fireEvent.click(screen.getByRole("button", { name: "수정" }));

    const roleSelect = screen.getByRole("combobox", { name: /^권한/ });
    expect(roleSelect).toHaveValue("admin");
    expect(
      within(roleSelect)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["지점장", "매니저", "직원"]);

    const lockedOwnedBranch = screen.getByRole("button", {
      name: "마포점 지점: 지점장 임명으로 선택 고정",
    });
    expect(lockedOwnedBranch).toBeDisabled();
    expect(lockedOwnedBranch).toHaveAttribute("aria-pressed", "true");
    const lockedInactiveOwnedBranch = screen.getByRole("button", {
      name: "서대문점 (비활성) 지점: 지점장 임명으로 선택 고정",
    });
    expect(lockedInactiveOwnedBranch).toBeDisabled();
    expect(lockedInactiveOwnedBranch).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("서대문점 (비활성)")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "송도점 지점 선택" }));
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() =>
      expect(approveMutate).toHaveBeenCalledWith({
        id: "approved-admin",
        role: "admin",
        branchIds: [
          "branch-admin-owned",
          "branch-songdo-ownerless",
          "branch-admin-inactive",
        ],
        expectedRole: "admin",
        expectedBranchIds: ["branch-admin-owned", "branch-admin-inactive"],
      }),
    );
  });

  it("drops inactive memberships and unlocks active owned branches on explicit demotion", async () => {
    render(<OwnerAdminConsole />);

    fireEvent.click(screen.getAllByRole("button", { name: "계정 관리" })[0]);
    fireEvent.click(screen.getByRole("button", { name: /기존 지점장 계정/ }));
    fireEvent.click(screen.getByRole("button", { name: "수정" }));

    const roleSelect = screen.getByRole("combobox", { name: /^권한/ });
    fireEvent.change(roleSelect, { target: { value: "manager" } });

    expect(screen.getByRole("button", { name: "마포점 지점 선택 해제" })).toBeEnabled();
    const inactiveBranch = screen.getByRole("button", {
      name: "서대문점 (비활성) 지점: 비활성으로 선택 불가",
    });
    expect(inactiveBranch).toBeDisabled();
    expect(inactiveBranch).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText(/저장하면 지점장 임명이 해제/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() =>
      expect(approveMutate).toHaveBeenCalledWith({
        id: "approved-admin",
        role: "manager",
        branchIds: ["branch-admin-owned"],
        expectedRole: "admin",
        expectedBranchIds: ["branch-admin-owned", "branch-admin-inactive"],
      }),
    );

    fireEvent.change(roleSelect, { target: { value: "admin" } });
    const restoredInactiveBranch = screen.getByRole("button", {
      name: "서대문점 (비활성) 지점: 지점장 임명으로 선택 고정",
    });
    expect(restoredInactiveBranch).toBeDisabled();
    expect(restoredInactiveBranch).toHaveAttribute("aria-pressed", "true");
  });

  it("shows the functional notification tool without placeholder approval actions", async () => {
    render(<OwnerAdminConsole />);

    fireEvent.click(screen.getAllByRole("button", { name: "알림 테스트" })[0]);
    fireEvent.click(screen.getByRole("button", { name: /브라우저 알림 테스트/ }));

    expect(screen.getByText("알림 테스트 실행 도구")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "승인" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "거부" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "더보기" })).not.toBeInTheDocument();
  });
});
