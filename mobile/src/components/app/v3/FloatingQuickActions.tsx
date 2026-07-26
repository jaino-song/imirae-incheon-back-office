"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType } from "react";
import { Send, MessageSquare, Calculator } from "lucide-react";
import { cn } from "@/lib/utils";
import { isLayoutExcluded } from "@/lib/constants/v3-layout";
import {
  DEFAULT_QUICK_ACTION_COLORS,
  type QuickActionIcon,
} from "./QuickActionButton";

interface FloatingAction {
  href: string;
  label: string;
  icon: QuickActionIcon;
}

const FLOATING_ACTIONS: FloatingAction[] = [
  { href: "/contracts/new", label: "계약 발송", icon: Send },
  { href: "/messages", label: "메시지", icon: MessageSquare },
  { href: "/messages", label: "비용계산기", icon: Calculator },
];

export function FloatingQuickActions() {
  const pathname = usePathname();

  if (isLayoutExcluded(pathname)) return null;

  return (
    <nav
      data-component="mobile_shell_quick-actions"
      data-slot="floating-quick-actions"
      className={cn(
        "fixed bottom-8 right-6 z-40",
        "hidden flex-col items-center gap-4",
      )}
    >
      {FLOATING_ACTIONS.map((action, idx) => {
        const color = DEFAULT_QUICK_ACTION_COLORS[idx % DEFAULT_QUICK_ACTION_COLORS.length];
        const IconComp = action.icon as ComponentType<{
          className?: string;
          strokeWidth?: number;
        }>;

        return (
          <Link
            key={action.href + action.label}
            href={action.href}
            className={cn(
              "group flex flex-col items-center gap-1",
              "transition-transform duration-200",
              "hover:-translate-y-0.5 active:scale-95",
            )}
          >
            <div
              className={cn(
                "w-12 h-12 rounded-full flex items-center justify-center",
                "shadow-lg",
                "transition-shadow duration-200 group-hover:shadow-xl",
                color.bg,
              )}
            >
              <IconComp className={cn("w-5 h-5", color.text)} strokeWidth={2.5} />
            </div>
            <span className="text-[10px] font-bold text-v3-text-muted group-hover:text-v3-dark transition-colors leading-tight text-center">
              {action.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
