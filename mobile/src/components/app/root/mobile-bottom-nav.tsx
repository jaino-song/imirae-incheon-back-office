"use client";

import { type CSSProperties, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { Home, User, FileText, MessageSquareText, Menu } from "lucide-react";
import { useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";
import { isLayoutExcluded } from "@/lib/constants/v3-layout";

const NAV_ITEMS: Array<{
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  kind?: "normal" | "chat";
  disabled?: boolean;
}> = [
  { href: "/dashboard", label: "홈", icon: Home, kind: "normal" },
  { href: "/clients", label: "고객", icon: User, kind: "normal" },
  { href: "/messages/new", label: "메시지", icon: MessageSquareText, kind: "normal" },
  { href: "/contracts", label: "계약", icon: FileText, kind: "normal" },
  { href: "/all", label: "전체", icon: Menu, kind: "normal" },
];
const ALL_NAV_INDEX = NAV_ITEMS.findIndex((item) => item.href === "/all");
const NAV_BASE = "mobile_shell_bottom-nav";
interface PressedNavItem {
  href: string;
  pathname: string;
}

function isNavItemActive(href: string, pathname: string): boolean {
  if (href === "/dashboard") return pathname === "/dashboard";
  if (href === "/messages/new") return pathname.startsWith("/messages");
  if (href === "/all") return pathname === "/all";
  return pathname.startsWith(href);
}

export function MobileBottomNav() {
  const pathname = usePathname();
  const safePathname = pathname ?? "";
  const prefersReducedMotion = useReducedMotion();
  const [pressedItem, setPressedItem] = useState<PressedNavItem | null>(null);
  const activeIndex = safePathname
    ? NAV_ITEMS.findIndex((item) => !item.disabled && isNavItemActive(item.href, safePathname))
    : -1;
  const activeItem = activeIndex >= 0 ? NAV_ITEMS[activeIndex] : null;
  const pressedHref = pressedItem?.pathname === safePathname ? pressedItem.href : null;

  const indicatorIndex = (() => {
    if (pressedHref) {
      const idx = NAV_ITEMS.findIndex((item) => item.href === pressedHref);
      if (idx >= 0) return idx;
    }
    return activeIndex >= 0 ? activeIndex : ALL_NAV_INDEX;
  })();

  const isChatRoute = safePathname.startsWith("/calls");
  const navGapPx = 2;
  const navPaddingPx = 5;
  const indicatorVisible = activeItem !== null || pressedHref !== null;
  const indicatorTransition = (() => {
    if (prefersReducedMotion) return "none";
    if (!indicatorVisible) return "opacity 140ms ease-out";
    return "transform 320ms cubic-bezier(0.32, 0.72, 0, 1), background 180ms ease-out, opacity 120ms ease-out";
  })();
  const indicatorStyle: CSSProperties = {
    position: "absolute",
    top: `${navPaddingPx}px`,
    right: "auto",
    bottom: `${navPaddingPx}px`,
    left: `${navPaddingPx}px`,
    display: "block",
    height: "auto",
    width: `calc((100% - ${(navPaddingPx * 2) + (navGapPx * (NAV_ITEMS.length - 1))}px) / ${NAV_ITEMS.length})`,
    padding: 0,
    borderRadius: "0.875rem",
    background: "hsl(var(--v3-primary))",
    opacity: indicatorVisible ? 1 : 0,
    pointerEvents: "none",
    transform: `translate3d(calc(${indicatorIndex * 100}% + ${indicatorIndex * navGapPx}px), 0, 0)`,
    transition: indicatorTransition,
    willChange: indicatorVisible ? "transform" : "opacity",
    zIndex: 0,
  };

  if (!pathname) return null;

  if (isLayoutExcluded(pathname)) return null;

  if (pathname.startsWith("/clients/new")) return null;

  return (
    <nav
      data-component={NAV_BASE}
      data-slot="mobile-bottom-nav"
      className={cn(
        isChatRoute
          ? "z-[var(--mobile-z-nav,30)]"
          : "fixed left-1/2 z-[var(--mobile-z-nav,30)] w-[calc(100%-2rem)] max-w-[398px] -translate-x-1/2",
        "grid grid-cols-5 items-end gap-[2px] p-[5px]",
        "bg-white/80 backdrop-blur-xl rounded-2xl",
        "shadow-v3-hover",
      )}
      style={{
        bottom: "max(calc(1rem + env(safe-area-inset-bottom)), calc(100dvh - var(--mobile-shell-max-height, 932px) + 1rem))",
      }}
    >
      {/*
        The indicator deliberately sits OUTSIDE the `mobile-bottom-nav-` slot
        namespace: CSS/tests use [data-slot^="mobile-bottom-nav-"] to select nav
        ITEMS only, and must never match the indicator.
      */}
      <span
        data-component={`${NAV_BASE}_indicator`}
        data-slot="mobile-bottom-indicator"
        role="presentation"
        style={indicatorStyle}
      />

      {NAV_ITEMS.map((item, index) => {
        const isActive = isNavItemActive(item.href, pathname);
        const isDisabled = item.disabled === true;
        const isIndicated = !isDisabled && indicatorVisible && index === indicatorIndex;
        const Icon = item.icon;
        const itemName =
          item.kind === "chat" ? "chat" : item.href.replace("/", "");
        const dataComponent = `${NAV_BASE}_${itemName}`;
        const dataSlot = `mobile-bottom-nav-${itemName}`;
        const itemClassName = cn(
          "relative z-10 flex h-10 flex-col items-center gap-[2px] rounded-[14px] px-1 py-[5px]",
          prefersReducedMotion ? null : "transition-colors duration-300 ease-out",
          isDisabled ? "cursor-not-allowed text-gray-300" : isIndicated ? "text-white" : "text-gray-500"
        );
        const itemContent = (
          <>
            <span className="relative">
              <Icon
                className="h-5 w-5 shrink-0"
                strokeWidth={2.5}
              />
            </span>
            <span className="text-[10px] font-medium leading-none">
              {item.label}
            </span>
          </>
        );

        if (isDisabled) {
          return (
            <span
              key={item.href}
              aria-disabled="true"
              data-component={dataComponent}
              data-slot={dataSlot}
              data-disabled="true"
              className={itemClassName}
            >
              {itemContent}
            </span>
          );
        }

        return (
          <Link
            key={item.href}
            href={item.href}
            prefetch={true}
            aria-current={isActive ? "page" : undefined}
            data-visual-active={isIndicated ? "true" : undefined}
            onClick={() => {
              if (!isActive) {
                setPressedItem({ href: item.href, pathname: safePathname });
              }
            }}
            data-component={dataComponent}
            data-slot={dataSlot}
            className={itemClassName}
          >
            {itemContent}
          </Link>
        );
      })}
    </nav>
  );
}
