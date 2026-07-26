"use client";

import { usePathname } from "next/navigation";
import { isLayoutExcluded } from "@/lib/constants/v3-layout";
import { NotificationBell } from "@/components/app/notifications/NotificationBell";
import { useInitialUser } from "@/providers/UserProvider";
import "@/components/app/mobile-redesign/redesign.css";

const DEFAULT_USER_LABEL = "사용자";
const DEFAULT_BRANCH_LABEL = "지점 미선택";
const SOURCE_COMPONENT = "V3MobileHeader";

interface V3MobileHeaderProps {
  /** Canonical caller-context base, e.g. "mobile_shell_header". */
  "data-component": string;
}

export function V3MobileHeader({
  "data-component": dataComponent,
}: V3MobileHeaderProps) {
  const pathname = usePathname();
  const user = useInitialUser();

  if (!pathname || isLayoutExcluded(pathname)) return null;

  const userLabel = user?.name ? `${user.name} 님` : DEFAULT_USER_LABEL;
  const branchLabel = user?.branchName ?? DEFAULT_BRANCH_LABEL;
  const sub = (suffix: string) => `${dataComponent}_${suffix}`;

  return (
    <header
      data-component={dataComponent}
      data-slot="mobile-header"
      data-source-component={SOURCE_COMPONENT}
      className="existing-navbar fixed top-0 left-1/2 z-40 w-full max-w-[430px] -translate-x-1/2"
    >
      <div className="navbar-identity" data-component={sub("identity")} data-slot="mobile-header-identity">
        <div className="navbar-text" data-component={sub("text")} data-slot="mobile-header-text">
          <span className="navbar-user">{userLabel}</span>
          <span className="navbar-branch">{branchLabel}</span>
        </div>
      </div>
      <div className="navbar-icons" data-component={sub("icons")} data-slot="mobile-header-icons">
        <NotificationBell data-component={`${sub("icons")}_notification-bell`} className="!h-[44px] !w-[44px] !rounded-xl bg-transparent hover:bg-transparent hover:scale-100 active:scale-100 text-v3-text" />
      </div>
    </header>
  );
}
