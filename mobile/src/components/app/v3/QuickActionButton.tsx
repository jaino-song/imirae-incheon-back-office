import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import type { ComponentType } from "react";
import { cn } from "@/lib/utils";

export type QuickActionIcon = LucideIcon | ComponentType<{ className?: string }>;

export interface QuickActionItem {
    href: string;
    label: string;
    icon: QuickActionIcon;
}

export interface QuickActionColor {
    bg: string;
    text: string;
}

export const DEFAULT_QUICK_ACTION_COLORS: readonly QuickActionColor[] = [
    { bg: "bg-v3-primary-light", text: "text-v3-primary" },
    { bg: "bg-v3-orange-light", text: "text-v3-orange" },
    { bg: "bg-v3-green-light", text: "text-v3-green" },
    { bg: "bg-v3-burgundy-light", text: "text-v3-burgundy" },
] as const;

interface QuickActionButtonProps {
    /** Caller-context canonical value. Grids pass `${base}_item-N`. */
    "data-component"?: string;
    href: string;
    label: string;
    icon: QuickActionIcon;
    color?: QuickActionColor;
    /** Pop-up animation delay in seconds. `false` to disable animation. */
    animationDelay?: number | false;
    className?: string;
}

export function QuickActionButton({
    "data-component": dataComponent,
    href,
    label,
    icon: Icon,
    color = DEFAULT_QUICK_ACTION_COLORS[0],
    animationDelay = false,
    className,
}: QuickActionButtonProps) {
    const animated = animationDelay !== false;
    const IconComp = Icon as ComponentType<{
        className?: string;
        strokeWidth?: number;
    }>;

    return (
        <Link
            href={href}
            data-component={dataComponent}
            data-slot="quick-action-button"
            className={cn(
                "p-3 rounded-2xl w-full",
                "flex flex-col items-center gap-2",
                "hover:shadow-v3-hover hover:-translate-y-1 active:scale-95",
                "transition-[transform,box-shadow] duration-[500ms] will-change-transform",
                animated && "opacity-0 animate-v3-pop-up",
                className,
            )}
            style={
                animated
                    ? { animationDelay: `${animationDelay}s`, animationFillMode: "both" }
                    : undefined
            }
        >
            <div
                className={cn(
                    "w-10 h-10 rounded-2xl flex items-center justify-center",
                    color.bg,
                )}
            >
                <IconComp className={cn("w-5 h-5", color.text)} strokeWidth={2.5} />
            </div>
            <span className="text-xs font-bold text-v3-dark text-center leading-tight break-keep">
                {label}
            </span>
        </Link>
    );
}
