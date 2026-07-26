"use client";

import React from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  UserCheck,
  UserKey,
  Globe,
  FileText,
  FolderOpen,
  Settings,
  LucideIcon,
  Calculator,
  Headset,
  MessageCircle,
  BarChart3,
} from "lucide-react";
import { useInitialUser } from "@/providers/UserProvider";
import { isLayoutExcluded } from "@/lib/constants/v3-layout";
import { useLocale } from "@/providers/LocaleProvider";
import { t } from "@/lib/i18n/translations";
import { ROLES } from "@/lib/constants/roles";
import { SidebarNotifications } from "@/components/app/v3/SidebarNotifications";
import { SidebarAccountMenu } from "@/components/app/v3/SidebarAccountMenu";
import { useConsultationInquiries } from "@/hooks/useConsultationInquiries";
import { useGlintUiScaleStyle } from "./useGlintUiScale";

interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon | React.ElementType;
  badge?: string;
  disabled?: boolean;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

const BASE_NAV_SECTIONS: NavSection[] = [
  {
    title: "메인",
    items: [
      { label: "대시보드", href: "/dashboard", icon: LayoutDashboard },
      // { label: "서비스 일정", href: "/schedule", icon: Calendar },
    ],
  },
  {
    title: "지점 관리",
    items: [
      { label: "상담", href: "/consultations", icon: Headset },
      { label: "고객", href: "/clients", icon: Users },
      { label: "직원", href: "/employees", icon: UserCheck },
      // { label: "통계", href: "/analytics", icon: BarChart3 },
    ],
  },
  {
    title: "서비스 관리",
    items: [
      { label: "메시지", href: "/messages", icon: MessageCircle },
      { label: "가격표", href: "/prices", icon: Calculator },
    ],
  },
  {
    title: "문서 관리",
    items: [
      { label: "전자문서", href: "/contracts", icon: FileText },
      { label: "파일 저장소", href: "/files", icon: FolderOpen },
    ],
  },
  {
    title: "시스템 관리",
    items: [
      { label: "통계", href: "/stats", icon: BarChart3 },
      { label: "설정", href: "/settings", icon: Settings },
    ],
  },
];

export const V3Sidebar = () => {
  const pathname = usePathname();
  const user = useInitialUser();
  const locale = useLocale();
  const isOwner = user?.role === ROLES.owner;
  const isExcluded = isLayoutExcluded(pathname);
  const scaledStyle = useGlintUiScaleStyle(!isExcluded);
  const [isNavScrolling, setIsNavScrolling] = React.useState(false);
  const scrollResetTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const consultationUnreadParams = React.useMemo(
    () => ({ page: 1, limit: 1, readState: "unread" }),
    []
  );
  const { data: consultationUnreadData } = useConsultationInquiries(
    consultationUnreadParams,
    Boolean(user) && !isExcluded
  );
  const consultationUnreadCount = consultationUnreadData?.total ?? 0;
  const consultationUnreadBadge =
    consultationUnreadCount > 99 ? "99+" : consultationUnreadCount > 0 ? String(consultationUnreadCount) : null;

  const getNavItemName = (href: string) => {
    const segment = href.split("/").filter(Boolean).pop() || "";
    return segment.toLowerCase();
  };

  const isActive = (href: string) => {
    if (href === "/dashboard" && pathname === "/dashboard/analytics") return false;
    if (href === "/employees" && pathname === "/employees/schedule") return false;
    return pathname.startsWith(href);
  };

  const navSections = React.useMemo<NavSection[]>(
    () => BASE_NAV_SECTIONS.map((section) => {
      if (section.title !== "시스템 관리") {
        return section;
      }

      const [statsItem, ...rest] = section.items;
      return {
        ...section,
        items: isOwner
          ? [
              statsItem,
              { label: "관리자", href: "/system-admin", icon: UserKey },
              { label: "홈페이지 관리", href: "/website-admin", icon: Globe },
              ...rest,
            ]
          : [{ ...statsItem, href: "/stats/inquiries" }, ...rest],
      };
    }),
    [isOwner]
  );

  React.useEffect(() => {
    return () => {
      if (scrollResetTimeoutRef.current !== null) {
        clearTimeout(scrollResetTimeoutRef.current);
      }
    };
  }, []);

  const handleNavScroll = () => {
    setIsNavScrolling(true);

    if (scrollResetTimeoutRef.current !== null) {
      clearTimeout(scrollResetTimeoutRef.current);
    }

    scrollResetTimeoutRef.current = setTimeout(() => {
      setIsNavScrolling(false);
    }, 450);
  };

  if (isExcluded) {
    return null;
  }

  const initials = user?.name
    ? user.name.slice(0, 2).toUpperCase()
    : "USER";

  return (
    <aside
      className="hidden md:flex flex-col fixed left-0 top-0 h-full w-[calc(min(20vw,240px)*var(--glint-ui-scale,1))] bg-white z-40 rounded-tr-[32px] rounded-br-[32px] shadow-v3 animate-v3-slide-right overflow-hidden"
      aria-label="Sidebar Navigation"
      data-component="desktop_chrome_sidebar"
      style={scaledStyle}
    >
      <div className="flex items-center justify-between gap-[calc(12px*var(--glint-ui-scale,1))] px-[calc(24px*var(--glint-ui-scale,1))] pt-[calc(32px*var(--glint-ui-scale,1))] pb-[calc(24px*var(--glint-ui-scale,1))]" data-component="desktop_chrome_sidebar_brand">
        <div className="flex min-w-0 items-center gap-[calc(12px*var(--glint-ui-scale,1))]">
          <div className="flex h-[calc(48px*var(--glint-ui-scale,1))] w-[calc(48px*var(--glint-ui-scale,1))] shrink-0 items-center justify-center overflow-hidden rounded-xl shadow-sm">
            <Image src="/assets/logo.svg" alt="아가잼잼 로고" width={48} height={48} className="w-full h-full object-cover" />
          </div>
          <div className="min-w-0">
            <span className="block truncate text-[calc(20px*var(--glint-ui-scale,1))] font-bold text-v3-primary tracking-tight">
              아가잼잼
            </span>
            {user?.branchName && (
              <span className="mt-[calc(2px*var(--glint-ui-scale,1))] block truncate text-[calc(11.52px*var(--glint-ui-scale,1))] font-medium leading-none text-v3-text-muted">
                {user.branchName}
              </span>
            )}
          </div>
        </div>
        <SidebarNotifications />
      </div>

      <nav
        className="custom-scrollbar scrollbar-on-scroll flex-1 space-y-[calc(24px*var(--glint-ui-scale,1))] overflow-y-auto px-[calc(16px*var(--glint-ui-scale,1))] py-[calc(8px*var(--glint-ui-scale,1))]"
        data-component="desktop_chrome_sidebar_nav"
        data-scroll-active={isNavScrolling ? "true" : "false"}
        onScroll={handleNavScroll}
      >
        {navSections.map((section, idx) => (
          <div key={section.title + idx}>
            <h3 className="mb-[calc(8px*var(--glint-ui-scale,1))] px-[calc(16px*var(--glint-ui-scale,1))] text-[calc(10.4px*var(--glint-ui-scale,1))] font-semibold text-v3-text-muted uppercase tracking-[0.15em]">
              {section.title}
            </h3>
            <ul className="space-y-[calc(4px*var(--glint-ui-scale,1))]">
              {section.items.map((item) => {
                const disabled = item.disabled === true;
                const active = !disabled && isActive(item.href);
                const badge = item.href === "/consultations" ? consultationUnreadBadge : item.badge;
                const itemName = getNavItemName(item.href);
                const navItemClassName = `
                  relative group flex items-center gap-[calc(12px*var(--glint-ui-scale,1))] px-[calc(16px*var(--glint-ui-scale,1))] py-[calc(10px*var(--glint-ui-scale,1))] rounded-2xl transition-all duration-200 overflow-hidden
                  ${disabled
                    ? "cursor-not-allowed bg-transparent text-v3-text-muted/60"
                    : active
                      ? "bg-v3-primary text-white shadow-md shadow-blue-500/20"
                      : "text-v3-text hover:bg-v3-primary-light hover:text-v3-primary"
                  }
                `;
                const iconClassName = `h-[calc(20px*var(--glint-ui-scale,1))] w-[calc(20px*var(--glint-ui-scale,1))] shrink-0 transition-colors ${
                  disabled ? "opacity-50" : active ? "text-white" : "group-hover:text-v3-primary"
                }`;
                const content = (
                  <>
                    <item.icon
                      className={iconClassName}
                      strokeWidth={2}
                    />
                    <span className="pt-[calc(2px*var(--glint-ui-scale,1))] text-[calc(14px*var(--glint-ui-scale,1))] font-medium leading-none">
                      {item.label}
                    </span>

                    {badge && (
                      <span
                        data-component={`sidebar-nav-${itemName}-badge`}
                        className={`
                          ml-auto inline-flex h-[calc(20px*var(--glint-ui-scale,1))] min-w-[calc(20px*var(--glint-ui-scale,1))] items-center justify-center rounded-full px-[calc(8px*var(--glint-ui-scale,1))] text-center text-[calc(10.4px*var(--glint-ui-scale,1))] font-bold leading-none
                          bg-v3-burgundy text-white
                        `}
                      >
                        {badge}
                      </span>
                    )}
                  </>
                );

                return (
                  <li key={item.href}>
                    {disabled ? (
                      <span
                        aria-disabled="true"
                        data-component={`sidebar-nav-${itemName}`}
                        data-disabled="true"
                        className={navItemClassName}
                      >
                        {content}
                      </span>
                    ) : (
                      <Link
                        href={item.href}
                        prefetch={false}
                        data-component={`sidebar-nav-${itemName}`}
                        className={navItemClassName}
                      >
                        {content}
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="mt-auto p-[calc(16px*var(--glint-ui-scale,1))]" data-component="desktop_chrome_sidebar_profile">
        <SidebarAccountMenu
          name={user?.name || "GUEST"}
          roleLabel={
            user?.role
              ? t(locale, `roles.${user.role}`) || t(locale, "roles.unknown")
              : t(locale, "roles.unknown")
          }
          profileImage={user?.profileImage}
          initials={initials}
        />
      </div>
    </aside>
  );
};
