"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Building2, Check } from "lucide-react";

import { useInitialUser } from "@/providers/UserProvider";
import { useLocale } from "@/providers/LocaleProvider";
import { t } from "@/lib/i18n/translations";
import { logout } from "@/app/(shell)/logout/actions";
import { AUTH_USER_QUERY_KEY } from "@/hooks/useGetAuthUser";
import { eformsignQueryKeys } from "@/hooks/useEformsignDocuments";
import { getUserBranches, setCurrentBranch } from "./actions";
import "@/components/app/mobile-redesign/redesign.css";

interface Branch {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  role: string;
}

const BRANCH_ICON_COLORS = [
  "hsl(var(--v3-primary))",
  "hsl(267, 50%, 46%)",
  "hsl(var(--v3-orange))",
  "hsl(var(--v3-green))",
  "hsl(var(--v3-burgundy))",
];

/** Canonical data-component base for the /select-branch route. */
const SELECT_BRANCH_BASE = "mobile_select-branch_page";
const SELECT_BRANCH_ROW = `${SELECT_BRANCH_BASE}_list_row`;

export default function SelectBranchPage() {
  const router = useRouter();
  const locale = useLocale();
  const queryClient = useQueryClient();
  const user = useInitialUser();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const isPageBusy = submitting || loggingOut;

  const confirmSelectBranch = useCallback(async (branchId: string): Promise<boolean> => {
    setSubmitting(true);
    try {
      const result = await setCurrentBranch(branchId);
      if (!result.success) {
        setError(result.error || "지점 선택에 실패했습니다.");
        setSubmitting(false);
        return false;
      }

      // The auth user query caches branchId for 30 minutes, and eformsign
      // document caches are branch-scoped data under a branch-agnostic key.
      // Without this, the app would keep serving the previous branch's identity
      // (and its documents) long after the switch.
      queryClient.removeQueries({ queryKey: eformsignQueryKeys.documents() });
      // Not awaited: the cookie is already switched, so navigation must not wait
      // on /auth/me. `refetchType: "all"` starts the refetch immediately even
      // though this page has no mounted auth-user observer, so the cache holds
      // the new branchId within one round trip instead of up to 30 minutes.
      void queryClient.invalidateQueries({
        queryKey: AUTH_USER_QUERY_KEY,
        refetchType: "all",
      });

      router.replace("/dashboard");
      return true;
    } catch (err) {
      console.error("[Select Branch] Error selecting branch:", err);
      setError("지점 선택에 실패했습니다.");
      setSubmitting(false);
      return false;
    }
  }, [queryClient, router]);

  useEffect(() => {
    const fetchBranches = async () => {
      let keepLoadingForNavigation = false;
      try {
        const result = await getUserBranches();

        if (!result.success) {
          setError(result.error || "지점 목록을 불러오는데 실패했습니다.");
          return;
        }

        const isOwner = result.branches?.some((org) => org.role === "owner");
        if (result.branches?.length === 1 && !isOwner) {
          const org = result.branches[0];
          keepLoadingForNavigation = await confirmSelectBranch(org.id);
          return;
        }

        const fetched = result.branches || [];
        setBranches(fetched);
        setSelectedId((current) => current ?? fetched[0]?.id ?? null);
      } catch (err) {
        console.error("[Select Branch] Error fetching branches:", err);
        setError("지점 목록을 불러오는데 실패했습니다.");
      } finally {
        if (!keepLoadingForNavigation) {
          setLoading(false);
        }
      }
    };

    fetchBranches();
  }, [confirmSelectBranch]);

  const handleLogout = async () => {
    if (isPageBusy) return;
    setLoggingOut(true);
    // auth_token/refresh_token are httpOnly — document.cookie cannot clear
    // them, and the middleware bounces authenticated users straight back
    // from /login. The server action clears them properly.
    try {
      await logout();
      router.replace("/login");
    } catch (err) {
      console.error("[Select Branch] Error logging out:", err);
      setError("로그아웃에 실패했습니다.");
      setLoggingOut(false);
    }
  };

  const getRoleLabel = (role: string) => t(locale, `roles.${role}`) || t(locale, "roles.unknown");

  if (loading) {
    return (
      <div
        className="branch-page"
        data-component={SELECT_BRANCH_BASE}
        data-slot="select-branch-page"
        style={{ alignItems: "center", justifyContent: "center" }}
      >
        <div
          data-component={`${SELECT_BRANCH_BASE}_loading`}
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 16,
            color: "hsl(var(--v3-text-muted))",
            fontSize: "0.86rem",
          }}
        >
          <Building2 size={48} strokeWidth={1.5} />
          지점 목록을 불러오는 중...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="branch-page" data-component={SELECT_BRANCH_BASE} data-slot="select-branch-page">
        <div className="branch-header" data-component={`${SELECT_BRANCH_BASE}_header`}>
          <div className="branch-title" data-component={`${SELECT_BRANCH_BASE}_header_title`}>지점 선택</div>
        </div>
        <div className="auth-server-error" role="alert" data-component={`${SELECT_BRANCH_BASE}_error`}>
          {error}
        </div>
        <button
          type="button"
          className="branch-btn"
          style={{ marginTop: "auto" }}
          onClick={() => router.push("/login")}
        >
          로그인 페이지로 돌아가기
        </button>
      </div>
    );
  }

  if (branches.length === 0) {
    return (
      <div className="branch-page" data-component={SELECT_BRANCH_BASE} data-slot="select-branch-page">
        <div className="branch-header" data-component={`${SELECT_BRANCH_BASE}_header`}>
          <div className="branch-title" data-component={`${SELECT_BRANCH_BASE}_header_title`}>접근 가능한 지점이 없습니다</div>
        </div>
        <div
          data-component={`${SELECT_BRANCH_BASE}_empty`}
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 12,
            padding: "32px 16px",
            textAlign: "center",
            color: "hsl(var(--v3-text-muted))",
          }}
        >
          <Building2 size={48} strokeWidth={1.5} />
          <p style={{ fontSize: "0.86rem", lineHeight: 1.55, color: "hsl(var(--v3-dark))" }}>
            관리자에게 지점 접근 권한을 요청해주세요.
          </p>
          <p style={{ fontSize: "0.74rem" }}>권한이 부여되면 이 페이지를 새로고침하세요.</p>
        </div>
        <div className="branch-actions" data-component={`${SELECT_BRANCH_BASE}_actions`}>
          <button type="button" className="branch-btn" onClick={() => window.location.reload()}>
            새로고침
          </button>
          <button
            type="button"
            className="logout-link"
            onClick={handleLogout}
            disabled={isPageBusy}
          >
            <span>{loggingOut ? "로그아웃 중…" : "로그아웃"}</span>
          </button>
        </div>
      </div>
    );
  }

  const selectedBranch = branches.find((b) => b.id === selectedId);

  return (
    <div className="branch-page" data-component={SELECT_BRANCH_BASE} data-slot="select-branch-page">
      <div className="branch-header" data-component={`${SELECT_BRANCH_BASE}_header`}>
        <div className="branch-title" data-component={`${SELECT_BRANCH_BASE}_header_title`}>지점 선택</div>
      </div>

      {user && (
        <div className="branch-user" data-component={`${SELECT_BRANCH_BASE}_user`}>
          <div className="branch-user-avatar" data-component={`${SELECT_BRANCH_BASE}_user_avatar`}>
            {user.name?.charAt(0) || "?"}
          </div>
          <div className="branch-user-info" data-component={`${SELECT_BRANCH_BASE}_user_info`}>
            <div className="branch-user-name" data-component={`${SELECT_BRANCH_BASE}_user_info_name`}>
              {user.name || "사용자"}
            </div>
            {user.email && (
              <div className="branch-user-email" data-component={`${SELECT_BRANCH_BASE}_user_info_email`}>
                {user.email}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="branch-list" data-component={`${SELECT_BRANCH_BASE}_list`}>
        {branches.map((branch, idx) => {
          const iconColor = BRANCH_ICON_COLORS[idx % BRANCH_ICON_COLORS.length];
          const isSelected = branch.id === selectedId;
          return (
            <button
              key={branch.id}
              type="button"
              className={`branch-card ${isSelected ? "selected" : ""}`}
              onClick={() => setSelectedId(branch.id)}
              disabled={isPageBusy}
              data-component={`${SELECT_BRANCH_ROW}`}
            >
              <div
                className="branch-card-icon"
                data-component={`${SELECT_BRANCH_ROW}_icon`}
                style={{ background: iconColor }}
              >
                <Building2 size={20} strokeWidth={2.5} />
              </div>
              <div className="branch-card-info" data-component={`${SELECT_BRANCH_ROW}_info`}>
                <div className="branch-card-name" data-component={`${SELECT_BRANCH_ROW}_info_name`}>
                  {branch.name}
                  <span className="role-pill">{getRoleLabel(branch.role)}</span>
                </div>
              </div>
              {isSelected && (
                <Check className="branch-card-check" size={24} strokeWidth={3} />
              )}
            </button>
          );
        })}
      </div>

      <div className="branch-actions" data-component={`${SELECT_BRANCH_BASE}_actions`}>
        <button
          type="button"
          className="branch-btn"
          onClick={() => selectedId && confirmSelectBranch(selectedId)}
          disabled={!selectedId || isPageBusy}
        >
          {submitting
            ? "이동 중…"
            : selectedBranch
              ? `${selectedBranch.name}으로 이동`
              : "지점을 선택하세요"}
        </button>
        <button
          type="button"
          className="logout-link"
          onClick={handleLogout}
          disabled={isPageBusy}
        >
          <span>{loggingOut ? "로그아웃 중…" : "로그아웃"}</span>
        </button>
      </div>
    </div>
  );
}
