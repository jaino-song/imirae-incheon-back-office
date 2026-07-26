"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { Home, Users, FileText, Sparkles, Menu } from "lucide-react";
import { cn } from "@/lib/utils";
import { isLayoutExcluded } from "@/lib/constants/v3-layout";

export function MobileBottomNav() {
  const pathname = usePathname();

  if (!pathname) return null;

  if (isLayoutExcluded(pathname)) return null;

  const navItems: Array<{
    href: string;
    label: string;
    icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
    kind?: "normal" | "chat";
  }> = [
      { href: "/dashboard", label: "홈", icon: Home, kind: "normal" },
      { href: "/clients", label: "고객", icon: Users, kind: "normal" },
      { href: "/chat", label: "어시스턴트", icon: Sparkles, kind: "chat" },
      { href: "/contracts", label: "계약", icon: FileText, kind: "normal" },
      { href: "/all", label: "전체", icon: Menu, kind: "normal" },
    ];

  return (
    <nav
      data-component="desktop_chrome_mobile-bottom-nav"
      className={cn(
        "fixed bottom-4 left-4 right-4 z-[1000]",
        "grid grid-cols-5 items-end gap-1 p-2",
        "bg-white/80 backdrop-blur-xl rounded-3xl",
        "shadow-v3-hover",
        "md:hidden"
      )}
    >
      {navItems.map((item) => {
        const isActive =
          item.href === "/dashboard"
            ? pathname === "/dashboard"
            : item.href === "/chat" || item.href === "/all"
              ? pathname === item.href
              : pathname.startsWith(item.href);
        const Icon = item.icon;

        return (
          <Link
            key={item.href}
            href={item.href}
            prefetch={false}
            data-component={
              item.kind === "chat"
                ? "desktop_chrome_mobile-bottom-nav_chat"
                : `mobile-bottom-nav-${item.href.replace("/", "")}`
            }
            className={cn(
              "flex flex-col items-center gap-1 p-2 rounded-2xl transition-all duration-200",
              item.kind === "chat"
                ? isActive
                  ? "bg-v3-primary-light text-v3-primary"
                  : "text-v3-primary hover:bg-v3-primary-light"
                : isActive
                  ? "bg-v3-primary text-white"
                  : "text-gray-500 hover:bg-v3-primary-light"
            )}
          >
            <Icon
              className={cn(
                item.kind === "chat"
                  ? "lucide lucide-sparkles h-5 w-5 text-navy shrink-0"
                  : "w-5 h-5"
              )}
              strokeWidth={item.kind === "chat" ? 2 : 2.5}
            />
            <span className="text-[10px] font-medium leading-none">
              {item.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
