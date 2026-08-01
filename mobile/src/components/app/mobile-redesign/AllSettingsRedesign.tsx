"use client";

import "./redesign.css";

import { useEffect } from "react";
import { Building2, LogOut, PenLine } from "lucide-react";
import { useRouter } from "next/navigation";

import { menuGroups as defaultMenuGroups } from "./mockup-data";
import type { MenuGroup } from "./mockup-data";
import { MenuGroups } from "./primitives";
import { t } from "@/lib/i18n/translations";
import type { Locale } from "@/app/actions/locale";
import { APP_VERSION } from "@/lib/env";
import { useLocale } from "@/providers/LocaleProvider";
import { useInitialUser } from "@/providers/UserProvider";

const ALL_SETTINGS_SOURCE_COMPONENT = "AllSettingsRedesign";

/**
 * Canonical data-component base for the /all route menu. AllSettingsRedesign is
 * rendered only by `app/(shell)/all/page.tsx` (root `mobile_all_page`), so the
 * base lives here instead of being threaded through a prop.
 */
const ALL_MENU_BASE = "mobile_all_page_menu";

const DEFAULT_PROFILE_NAME = "사용자";
const DEFAULT_PROFILE_ROLE = "스태프";

function getAppVersion() {
  return `아가잼잼 어드민 v${APP_VERSION}`;
}

function getRoleLabel(locale: Locale, role: string | undefined) {
  if (!role) {
    return DEFAULT_PROFILE_ROLE;
  }

  const key = `roles.${role}`;
  const label = t(locale, key);
  return label === key ? DEFAULT_PROFILE_ROLE : label;
}

function getAvatarInitial(name: string) {
  return name.trim().charAt(0) || DEFAULT_PROFILE_NAME.charAt(0);
}

export interface AllSettingsRedesignProps {
  menuGroups?: MenuGroup[];
}

export function AllSettingsRedesign({ menuGroups = defaultMenuGroups }: AllSettingsRedesignProps) {
  const router = useRouter();
  const locale = useLocale();
  const user = useInitialUser();
  const profileName = user?.name ?? DEFAULT_PROFILE_NAME;
  const profileRole = getRoleLabel(locale, user?.role);
  const isOwner = user?.role === "owner";

  useEffect(() => {
    document.body.classList.add("mobile-all-route");

    return () => {
      document.body.classList.remove("mobile-all-route");
    };
  }, []);

  return (
    <div
      data-component={ALL_MENU_BASE}
      data-source-component={ALL_SETTINGS_SOURCE_COMPONENT}
      className="menu-content"
      style={{ paddingBottom: 76 }}
    >
      <div className="profile-card pop-up" data-component={`${ALL_MENU_BASE}_profile-card`}>
        <div className="profile-avatar">{getAvatarInitial(profileName)}</div>
        <div className="profile-info">
          <div className="profile-name">{profileName}</div>
          <div className="profile-role">
            <span>{profileRole}</span>
          </div>
        </div>
        <button
          type="button"
          className="profile-edit"
          aria-label="프로필 편집"
          hidden
          onClick={() => router.push("/select-branch")}
        >
          <PenLine size={14} strokeWidth={2.5} />
        </button>
      </div>

      <MenuGroups groups={menuGroups} dataComponent={ALL_MENU_BASE} />

      {isOwner && (
        <button
          type="button"
          className="branch-switch-btn"
          data-component={`${ALL_MENU_BASE}_branch-switch`}
          onClick={() => router.push("/select-branch")}
        >
          <Building2 size={16} strokeWidth={2.5} />
          지점 변경
        </button>
      )}

      <button
        type="button"
        className="logout-btn"
        data-component={`${ALL_MENU_BASE}_logout`}
        onClick={() => router.push("/logout")}
      >
        <LogOut size={16} strokeWidth={2.5} />
        로그아웃
      </button>
      <div className="app-version">{getAppVersion()}</div>
    </div>
  );
}
