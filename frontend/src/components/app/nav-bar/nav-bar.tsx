"use client";

import { useEffect } from "react";
import { X, House, MessageCircle, File, Settings, FileText, Users, UserCog, ShieldCheck } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SheetClose } from "@/components/ui/sheet";
import { t } from "@/lib/i18n/translations";
import { usePathname } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { NavButton } from "./nav-button";
import { LanguageSwitcher } from "./language-switcher";
import { useLocale } from "@/providers/LocaleProvider";
import { eformsignQueryKeys } from "@/hooks/useEformsignDocuments";
import { eformsignApi } from "@/services/api";
import { useGetAuthUser } from "@/hooks/useGetAuthUser";
import { safeStorageGetItem } from "@/lib/safe-storage";

interface NavBarProps {
    onClose: () => void;
}

function isEformsignAuthenticated(): boolean {
    if (typeof window === "undefined") return false;
    const authTimeStr = safeStorageGetItem("session", "eformsign_auth_time");
    if (!authTimeStr) return false;
    const authTime = parseInt(authTimeStr, 10);
    const tokenExpiryMs = 60 * 60 * 1000;
    const bufferMs = 5 * 60 * 1000;
    return Date.now() - authTime < tokenExpiryMs - bufferMs;
}

export const NavBar = ({ onClose }: NavBarProps) => {
    const locale = useLocale();
    const pathname = usePathname();
    const queryClient = useQueryClient();
    const { data: user } = useGetAuthUser();

    useEffect(() => {
        let cancelled = false;

        const prefetchDocuments = async () => {
            try {
                if (!isEformsignAuthenticated()) return;

                const authStatus = await eformsignApi.getAuthStatus();
                if (!authStatus.hasAppAuthToken || !authStatus.hasAccessToken || cancelled) {
                    return;
                }

                void queryClient.prefetchQuery({
                    queryKey: eformsignQueryKeys.allDocuments(),
                    queryFn: () => eformsignApi.getAllDocuments(),
                    staleTime: 1000 * 60 * 5,
                });
            } catch (error) {
                console.error("[NavBar] Failed to verify eformsign auth status before prefetch:", error);
            }
        };

        void prefetchDocuments();
        return () => {
            cancelled = true;
        };
    }, [queryClient]);

    const isDashboard = pathname === "/dashboard";
    const isMessages = pathname === "/messages";
    const isFiles = pathname === "/files";
    const isContracts = pathname === "/contracts";
    const isClients = pathname === "/clients";
    const isSettings = pathname === "/settings";
    const isEmployees = pathname === "/employees";
    const isAdminOrOwner = user?.role === 'admin' || user?.role === 'owner';
    const isAdmin = pathname === '/admin' || pathname?.startsWith('/admin/');

    const navItems = [
        { href: "/dashboard", label: t(locale, "nav-bar.dashboard"), icon: <House className="h-4 w-4" />, active: isDashboard },
        { href: "/messages", label: t(locale, "nav-bar.messages"), icon: <MessageCircle className="h-4 w-4" />, active: isMessages },
        { href: "/contracts", label: t(locale, "nav-bar.contracts"), icon: <File className="h-4 w-4" />, active: isContracts },
        { href: "/clients", label: t(locale, "nav-bar.clients"), icon: <Users className="h-4 w-4" />, active: isClients },
        { href: "/employees", label: t(locale, "nav-bar.employees"), icon: <UserCog className="h-4 w-4" />, active: isEmployees },
        { href: "/files", label: t(locale, "nav-bar.files"), icon: <FileText className="h-4 w-4" />, active: isFiles },
        { href: "/settings", label: t(locale, "nav-bar.settings"), icon: <Settings className="h-4 w-4" />, active: isSettings },
    ];

    return (
        <div data-component="desktop_chrome_nav-bar" className="w-full h-full p-4 flex flex-col justify-between">
            {/* Main navigation section */}
            <div data-component="desktop_chrome_nav-bar_content" className="flex-1">
                {/* Close button */}
                <div data-component="desktop_chrome_nav-bar_content_close" className="flex justify-end mb-4">
                    <SheetClose asChild>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="opacity-0 animate-fade-in text-sidebar-foreground/80 hover:text-sidebar-foreground hover:bg-sidebar-accent"
                        >
                            <X className="h-5 w-5" />
                            <span className="sr-only">Close navigation</span>
                        </Button>
                    </SheetClose>
                </div>

                {/* Navigation items */}
                <nav data-component="desktop_chrome_nav-bar_content_nav" className="flex flex-col gap-1">
                    {navItems.map((item, index) => (
                        <NavButton
                            key={item.href}
                            href={item.href}
                            label={item.label}
                            icon={item.icon}
                            active={item.active}
                            onClick={onClose}
                            index={index}
                        />
                    ))}

                    {/* Admin section - only for admin/owner */}
                    {isAdminOrOwner && (
                        <>
                            <Separator className="my-2 opacity-0 animate-fade-in bg-sidebar-border" style={{ animationDelay: '400ms' }} />
                            <NavButton
                                href="/admin"
                                label="관리자"
                                icon={<ShieldCheck className="h-4 w-4" />}
                                active={isAdmin}
                                onClick={onClose}
                                index={navItems.length}
                            />
                        </>
                    )}
                </nav>
            </div>

            {/* Footer with language switcher */}
            <div data-component="desktop_chrome_nav-bar_footer" className="opacity-0 animate-fade-in" style={{ animationDelay: '500ms' }}>
                <LanguageSwitcher />
            </div>
        </div>
    );
}
