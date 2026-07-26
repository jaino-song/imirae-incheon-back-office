"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { Building2, ChevronUp, LogOut } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

interface SidebarAccountMenuProps {
  name: string;
  roleLabel: string;
  profileImage?: string | null;
  initials: string;
}

const ITEM_BASE =
  "group flex w-full cursor-pointer items-center gap-[calc(12px*var(--glint-ui-scale,1))] rounded-xl px-[calc(10px*var(--glint-ui-scale,1))] py-[calc(9px*var(--glint-ui-scale,1))] text-left transition-colors";
const ICON_WRAP =
  "flex h-[calc(36px*var(--glint-ui-scale,1))] w-[calc(36px*var(--glint-ui-scale,1))] shrink-0 items-center justify-center rounded-xl";
const ICON_SIZE = "h-[calc(18px*var(--glint-ui-scale,1))] w-[calc(18px*var(--glint-ui-scale,1))]";
const ITEM_LABEL =
  "truncate text-[calc(13.6px*var(--glint-ui-scale,1))] font-semibold text-gray-900 transition-colors";
const ITEM_SUB = "truncate text-[calc(11.2px*var(--glint-ui-scale,1))] text-v3-text-muted";

/**
 * Account menu in the sidebar footer. The profile card is the trigger; the menu
 * (지점 변경 / 로그아웃) lives in the *same* container and expands upward —
 * the footer sits in `mt-auto` of a flex column, so growing the container pushes
 * the menu up into the freed nav space.
 */
export function SidebarAccountMenu({
  name,
  roleLabel,
  profileImage,
  initials,
}: SidebarAccountMenuProps) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;

    const handleOutside = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const navigate = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  return (
    <div
      ref={containerRef}
      data-component="desktop_chrome_sidebar_account-menu"
      data-state={open ? "open" : "closed"}
      className={cn(
        "flex flex-col gap-[calc(2px*var(--glint-ui-scale,1))] rounded-2xl border transition-all",
        open
          ? "border-v3-border bg-white shadow-v3-hover"
          : "border-v3-border/50 bg-v3-dim-white/50"
      )}
    >
      {/* Menu list — collapses upward via grid-rows 0fr→1fr */}
      <div
        role="menu"
        aria-label="계정 메뉴"
        aria-hidden={!open}
        className={cn(
          "grid transition-all duration-300 ease-out",
          open ? "grid-rows-[1fr] opacity-100" : "pointer-events-none grid-rows-[0fr] opacity-0"
        )}
      >
        <div className="flex min-h-0 flex-col gap-[calc(2px*var(--glint-ui-scale,1))] overflow-hidden">
          <button
            type="button"
            role="menuitem"
            tabIndex={open ? 0 : -1}
            onClick={() => navigate("/select-branch")}
            className={ITEM_BASE}
          >
            <span className={cn(ICON_WRAP, "bg-v3-primary-light text-v3-primary")}>
              <Building2 className={ICON_SIZE} strokeWidth={2} />
            </span>
            <span className="flex min-w-0 flex-col">
              <span className={cn(ITEM_LABEL, "group-hover:text-v3-primary")}>지점 변경</span>
              <span className={ITEM_SUB}>다른 지점으로 전환</span>
            </span>
          </button>

          <button
            type="button"
            role="menuitem"
            tabIndex={open ? 0 : -1}
            onClick={() => navigate("/logout")}
            className={cn(ITEM_BASE, "group/logout")}
          >
            <span className={cn(ICON_WRAP, "bg-v3-burgundy/10 text-v3-burgundy")}>
              <LogOut className={ICON_SIZE} strokeWidth={2} />
            </span>
            <span className="flex min-w-0 flex-col">
              <span className={cn(ITEM_LABEL, "group-hover/logout:text-v3-burgundy")}>로그아웃</span>
              <span className={ITEM_SUB}>계정에서 나가기</span>
            </span>
          </button>

          <div
            aria-hidden="true"
            className="mx-[calc(8px*var(--glint-ui-scale,1))] mb-[calc(3px*var(--glint-ui-scale,1))] mt-[calc(5px*var(--glint-ui-scale,1))] h-px bg-v3-border"
          />
        </div>
      </div>

      {/* Trigger — the profile card */}
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="group flex w-full cursor-pointer items-center gap-[calc(12px*var(--glint-ui-scale,1))] rounded-xl px-[calc(10px*var(--glint-ui-scale,1))] py-[calc(9px*var(--glint-ui-scale,1))] text-left transition-colors hover:bg-white"
      >
        <Avatar className="h-[calc(40px*var(--glint-ui-scale,1))] w-[calc(40px*var(--glint-ui-scale,1))] shrink-0 rounded-full shadow-inner">
          <AvatarImage src={profileImage || ""} alt="" />
          <AvatarFallback className="bg-gradient-to-br from-v3-primary to-blue-600 text-[calc(14px*var(--glint-ui-scale,1))] font-bold text-white">
            {initials}
          </AvatarFallback>
        </Avatar>
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-[calc(13.6px*var(--glint-ui-scale,1))] font-semibold text-gray-900 transition-colors group-hover:text-v3-primary">
            {name}
          </span>
          <span className="truncate text-[calc(11.2px*var(--glint-ui-scale,1))] text-v3-text-muted">
            {roleLabel}
          </span>
        </span>
        <ChevronUp
          className={cn(
            "ml-auto shrink-0 transition-transform duration-300",
            ICON_SIZE,
            open ? "rotate-180 text-v3-primary" : "rotate-0 text-v3-text-muted"
          )}
          strokeWidth={2}
        />
      </button>
    </div>
  );
}
