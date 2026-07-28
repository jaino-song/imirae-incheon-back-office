"use client";

import React from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { 
  LayoutDashboard, 
  BarChart3, 
  Users, 
  UserCheck, 
  Calendar, 
  FileText, 
  FolderOpen, 
  Bell, 
  Settings,
  LucideIcon
} from "lucide-react";
import { useInitialUser } from "@/providers/UserProvider";
import { isLayoutExcluded } from "@/lib/constants/v3-layout";
import { useLocale } from "@/providers/LocaleProvider";
import { t } from "@/lib/i18n/translations";

interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  badge?: string;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

const NAV_SECTIONS: NavSection[] = [
  {
    title: "메인",
    items: [
      { label: "대시보드", href: "/dashboard", icon: LayoutDashboard },
      { label: "분석", href: "/dashboard/analytics", icon: BarChart3 },
    ],
  },
  {
    title: "관리",
    items: [
      { label: "고객", href: "/clients", icon: Users },
      { label: "직원", href: "/employees", icon: UserCheck },
      { label: "일정", href: "/employees/schedule", icon: Calendar },
    ],
  },
  {
    title: "문서",
    items: [
      { label: "계약", href: "/contracts", icon: FileText },
      { label: "파일", href: "/files", icon: FolderOpen },
    ],
  },
  {
    title: "시스템",
    items: [
      { label: "알림", href: "/messages", icon: Bell },
      { label: "설정", href: "/notification", icon: Settings },
    ],
  },
];

const SOURCE_COMPONENT = "V3Sidebar";

interface V3SidebarProps {
  /** Canonical caller-context base, e.g. "mobile_shell_sidebar". */
  "data-component": string;
}

export const V3Sidebar = ({
  "data-component": dataComponent,
}: V3SidebarProps) => {
  const pathname = usePathname();
  const locale = useLocale();
  const user = useInitialUser();
  const [isNavScrolling, setIsNavScrolling] = React.useState(false);
  const scrollResetTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const getNavItemName = (href: string) => {
    const segment = href.split("/").filter(Boolean).pop() || "";
    return segment.toLowerCase();
  };

  const isActive = (href: string) => {
    if (href === "/dashboard" && pathname === "/dashboard/analytics") return false;
    if (href === "/employees" && pathname === "/employees/schedule") return false;
    return pathname.startsWith(href);
  };

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
  
  if (isLayoutExcluded(pathname)) {
    return null;
  }

  const initials = user?.name 
    ? user.name.slice(0, 2).toUpperCase() 
    : "USER";
  const sub = (suffix: string) => `${dataComponent}_${suffix}`;

  return (
    <aside
      data-component={dataComponent}
      data-slot="sidebar"
      data-source-component={SOURCE_COMPONENT}
      className="hidden flex-col fixed left-0 top-0 h-full w-[280px] bg-white z-40 rounded-tr-2xl rounded-br-2xl shadow-v3 animate-v3-slide-right overflow-hidden"
      aria-label="Sidebar Navigation"
    >
      <div className="flex items-center gap-3 px-6 pt-8 pb-6" data-component={sub("brand")} data-slot="sidebar-brand">
        <Image src="/assets/logo.svg" alt="아가잼잼" width={48} height={48} className="w-12 h-12 rounded-2xl shrink-0 shadow-sm" />
        <span className="text-xl font-bold text-gray-900 tracking-tight">
          아가잼잼 관리자
        </span>
      </div>

      <nav
        className="flex-1 overflow-y-auto px-4 py-2 space-y-6 custom-scrollbar scrollbar-on-scroll"
        data-component={sub("nav")}
        data-slot="sidebar-nav"
        data-scroll-active={isNavScrolling ? "true" : "false"}
        onScroll={handleNavScroll}
      >
        {NAV_SECTIONS.map((section) => (
          <div key={section.title}>
            <h3 className="px-4 mb-2 text-[0.65rem] font-semibold text-v3-text-muted uppercase tracking-[0.15em]">
              {section.title}
            </h3>
            <ul className="space-y-1">
              {section.items.map((item) => {
                const active = isActive(item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      data-component={`${dataComponent}_nav_${getNavItemName(item.href)}`}
                      data-slot={`sidebar-nav-${getNavItemName(item.href)}`}
                      className={`
                        relative group flex items-center gap-3 px-4 py-2.5 rounded-2xl transition-colors overflow-hidden
                        ${active
                          ? "bg-v3-primary text-white shadow-md shadow-blue-500/20"
                          : "text-v3-text hover:bg-v3-primary-light hover:text-v3-primary"
                        }
                      `}
                    >
                      <item.icon 
                        className={`w-5 h-5 shrink-0 transition-colors ${active ? "text-white" : "group-hover:text-v3-primary"}`} 
                        strokeWidth={2} 
                      />
                      <span className="text-[0.85rem] font-medium leading-none pt-0.5">
                        {item.label}
                      </span>
                      
                      {item.badge && (
                         <span className="ml-auto text-[0.65rem] px-2 py-0.5 rounded-full bg-v3-primary-light text-v3-primary font-bold">
                           {item.badge}
                         </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="p-4 mt-auto" data-component={sub("profile")} data-slot="sidebar-profile">
        <div className="flex items-center gap-3 p-3 rounded-2xl bg-v3-dim-white/50 border border-v3-border/50 hover:bg-white hover:shadow-v3-hover transition-all cursor-pointer group">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-v3-primary to-blue-600 flex items-center justify-center shadow-inner shrink-0 text-white font-bold text-sm">
            {initials}
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-[0.85rem] font-semibold text-gray-900 truncate group-hover:text-v3-primary transition-colors">
              {user?.name || "GUEST"}
            </span>
            <span className="text-[0.7rem] text-v3-text-muted truncate">
              {user?.role ? t(locale, `roles.${user.role}`) || t(locale, "roles.unknown") : t(locale, "roles.unknown")}
            </span>
          </div>
        </div>
      </div>
    </aside>
  );
};
