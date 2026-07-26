"use client";

import { X, House, MessageCircle, File, Settings, FileText, Users, UserCog, ShieldCheck } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SheetClose } from "@/components/ui/sheet";
import { t } from "@/lib/i18n/translations";
import { usePathname } from "next/navigation";
import { NavButton } from "./nav-button";
import { LanguageSwitcher } from "./language-switcher";
import { useLocale } from "@/providers/LocaleProvider";
import { useGetAuthUser } from "@/hooks/useGetAuthUser";

interface NavBarProps {
    onClose: () => void;
}

export const NavBar = ({ onClose }: NavBarProps) => {
    const locale = useLocale();
    const pathname = usePathname();
    const { data: user } = useGetAuthUser();

    const isDashboard = pathname === "/dashboard";
    const isMessages = pathname === "/messages";
    const isFiles = pathname === "/files";
    const isContracts = pathname === "/contracts";
    const isClients = pathname === "/clients";
    const isSettings = pathname === "/notification" || pathname === "/settings";
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
        { href: "/notification", label: t(locale, "nav-bar.settings"), icon: <Settings className="h-4 w-4" />, active: isSettings },
    ];

    return (
        <div data-component="mobile_shell_app-header_drawer-nav" className="w-full h-full p-4 flex flex-col justify-between">
            {/* Main navigation section */}
            <div data-component="mobile_shell_app-header_drawer-nav_content" className="flex-1">
                {/* Close button */}
                <div data-component="mobile_shell_app-header_drawer-nav_content_close" className="flex justify-end mb-4">
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
                <nav data-component="mobile_shell_app-header_drawer-nav_content_nav" className="flex flex-col gap-1">
                    {navItems.map((item) => (
                        <NavButton
                            key={item.href}
                            href={item.href}
                            label={item.label}
                            icon={item.icon}
                            active={item.active}
                            onClick={onClose}
                        />
                    ))}

                    {/* Admin section - only for admin/owner */}
                    {isAdminOrOwner && (
                        <>
                            <Separator className="my-2 bg-sidebar-border" />
                            <NavButton
                                href="/admin/feedback"
                                label="관리자"
                                icon={<ShieldCheck className="h-4 w-4" />}
                                active={isAdmin}
                                onClick={onClose}
                            />
                        </>
                    )}
                </nav>
            </div>

            {/* Footer with language switcher */}
            <div data-component="mobile_shell_app-header_drawer-nav_footer" className="opacity-0 animate-fade-in" style={{ animationDelay: '500ms' }}>
                <LanguageSwitcher data-component="mobile_shell_app-header_drawer-nav_footer_language-switcher" />
            </div>
        </div>
    );
}
