"use client";

import { useEffect, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  FileText,
  FolderOpen,
  MessageCircle,
  Settings,
  LogOut,
  ShieldCheck,
  Send,
  Sparkles,
  UserCog,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useGetAuthUser } from "@/hooks/useGetAuthUser";
import { ShortcutGrid } from "@/components/app/v3/ShortcutGrid";

function initials(name?: string | null) {
  if (!name) return "U";
  const parts = name.split(" ").filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return (parts[0].slice(0, 1) + parts[parts.length - 1].slice(0, 1)).toUpperCase();
}

export default function AllMenuPage() {
  const router = useRouter();
  const { data: user, isLoading } = useGetAuthUser();

  // Desktop should remain unchanged. If someone navigates here on desktop, bounce back.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(min-width: 768px)").matches) {
      router.replace("/dashboard");
    }
  }, [router]);

  const isAdminOrOwner = user?.role === "admin" || user?.role === "owner";

  const shortcuts = useMemo(
    () => [
      { href: "/chat", label: "AI 어시스턴트", icon: Sparkles },
      { href: "/contracts", label: "계약 발송", icon: Send },
      { href: "/clients", label: "고객", icon: Users },
      { href: "/messages", label: "메시지", icon: MessageCircle },
    ],
    []
  );

  const navItems = useMemo(() => {
    const base = [
      { href: "/dashboard", label: "대시보드", desc: "업무 현황", icon: LayoutDashboard },
      { href: "/clients", label: "고객", desc: "산모/이용자 관리", icon: Users },
      { href: "/contracts", label: "계약", desc: "계약서 발송/상태", icon: FileText },
      { href: "/employees", label: "직원", desc: "제공인력 관리", icon: UserCog },
      { href: "/files", label: "파일", desc: "문서 보관함", icon: FolderOpen },
      { href: "/messages", label: "메시지", desc: "문자/알림", icon: MessageCircle },
      { href: "/settings", label: "설정", desc: "서비스 환경", icon: Settings },
    ];
    if (isAdminOrOwner) {
      base.push({ href: "/admin", label: "관리자", desc: "피드백/관리", icon: ShieldCheck });
    }
    base.push({ href: "/logout", label: "로그아웃", desc: "계정 로그아웃", icon: LogOut });
    return base;
  }, [isAdminOrOwner]);

  return (
    <div data-component="desktop_all_menu" className="md:hidden space-y-6">
      {/* Profile */}
      <section
        data-component="desktop_all_menu_profile"
        className={cn(
          "bg-white rounded-[28px] shadow-v3 p-5",
          "border border-black/5",
          "opacity-0 animate-v3-slide-up"
        )}
        style={{ animationFillMode: "both" }}
      >
        <div data-component="desktop_all_menu_profile_content" className="flex items-center gap-4">
          {isLoading ? (
            <Skeleton className="h-14 w-14 rounded-2xl bg-v3-dim-white" />
          ) : (
            <Avatar className="h-14 w-14 rounded-2xl">
              <AvatarImage src={user?.profileImage || ""} alt={user?.name || "User"} />
              <AvatarFallback className="rounded-2xl bg-v3-primary text-white font-bold">
                {initials(user?.name)}
              </AvatarFallback>
            </Avatar>
          )}

          <div data-component="desktop_all_menu_profile_content_text" className="min-w-0 flex-1">
            {isLoading ? (
              <div data-component="desktop_all_menu_profile_content_text_skeleton" className="space-y-2">
                <Skeleton className="h-4 w-32 bg-v3-dim-white" />
                <Skeleton className="h-3 w-44 bg-v3-dim-white" />
              </div>
            ) : (
              <>
                <div data-component="desktop_all_menu_profile_content_text_name-row" className="flex items-center gap-2">
                  <p className="text-[1.05rem] font-extrabold text-v3-dark truncate">
                    {user?.name ?? "사용자"}
                  </p>
                  {user?.role && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-v3-primary-light text-v3-primary shrink-0">
                      {user.role}
                    </span>
                  )}
                </div>
                <p className="text-[0.8rem] text-v3-text-muted truncate">{user?.email ?? ""}</p>
              </>
            )}
          </div>

          <Link href="/settings" className="shrink-0">
            <Button
              variant="outline"
              className="rounded-2xl border-v3-border text-[0.8rem] px-3"
            >
              설정
            </Button>
          </Link>
        </div>
      </section>

      <div
        data-component="desktop_all_menu_content"
        className="bg-white rounded-tl-[28px] rounded-tr-[28px] -mx-4 p-4 opacity-0 animate-v3-slide-up"
        style={{ animationDelay: "0.1s", animationFillMode: "both" }}
      >
        <ShortcutGrid shortcuts={shortcuts} className="mb-4" />

        {/* Full nav stack */}
        <section data-component="desktop_all_menu_content_nav" className="space-y-3 pb-2">
          <h2 className="px-1 text-lg font-extrabold tracking-tight text-v3-dark">
            전체 메뉴
          </h2>
          <div data-component="desktop_all_menu_content_nav_list" className="flex flex-col gap-2">
            {navItems.map((item, idx) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  data-component="desktop_all_menu_content_nav_list_item"
                  className={cn(
                    "flex items-center gap-3 px-3 py-1",
                    "rounded-[18px]",
                    "active:scale-[0.98] transition-all",
                    "opacity-0 animate-v3-pop-up"
                  )}
                  style={{ animationDelay: `${0.35 + idx * 0.04}s`, animationFillMode: "both" }}
                >
                  <div data-component="desktop_all_menu_content_nav_list_item_icon" className="w-11 h-11 rounded-[14px] bg-v3-dim-white flex items-center justify-center shrink-0">
                    <Icon className="w-5 h-5 text-v3-text-muted" strokeWidth={2.5} />
                  </div>
                  <div data-component="desktop_all_menu_content_nav_list_item_content" className="min-w-0 flex-1 flex items-center justify-between">
                    <p className="text-md font-extrabold text-v3-dark truncate">
                      {item.label}
                    </p>
                    <p className="text-sm text-v3-text-muted truncate">{item.desc}</p>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
