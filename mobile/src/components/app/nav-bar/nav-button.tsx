'use client';

import Link from "next/link";
import { cn } from "@/lib/utils";

interface NavButtonProps {
    href: string;
    label: string;
    icon: React.ReactNode;
    active?: boolean;
    onClick?: () => void;
    disabled?: boolean;
}

export const NavButton = ({
    href,
    label,
    icon,
    active = false,
    onClick,
    disabled = false,
}: NavButtonProps) => {
    return (
        <Link
            data-component="mobile_shell_app-header_drawer-nav_content_nav_button"
            href={href}
            onClick={disabled ? (e) => e.preventDefault() : onClick}
            className={cn(
                "flex items-center gap-3 px-3 py-3 rounded-2xl text-sm font-medium transition-colors",
                active
                    ? "bg-sidebar-primary/20 text-sidebar-primary"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground",
                disabled && "pointer-events-none opacity-50"
            )}
            aria-disabled={disabled}
        >
            <span className={cn(
                "flex items-center justify-center w-5 h-5",
                active && "text-sidebar-primary"
            )}>
                {icon}
            </span>
            <span>{label}</span>
            {active && (
                <span className="ml-auto w-1.5 h-1.5 rounded-full bg-sidebar-primary" />
            )}
        </Link>
    );
};
