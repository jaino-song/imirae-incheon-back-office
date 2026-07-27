"use client";

import Link from "next/link";
import type { ComponentType } from "react";
import { Send, MessageSquare, UserPlus, Calculator } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DEFAULT_QUICK_ACTION_COLORS,
  type QuickActionIcon,
  type QuickActionColor,
} from "./QuickActionButton";

const SOURCE_COMPONENT = "FloatingQuickActions";

interface FloatingAction {
  href: string;
  label: string;
  icon: QuickActionIcon;
  color?: QuickActionColor;
}

const FLOATING_ACTIONS: FloatingAction[] = [
  { href: "/contracts?create=1", label: "계약 발송", icon: Send },
  { href: "/messages", label: "메시지", icon: MessageSquare },
  { href: "/clients?openClientForm=1", label: "고객 등록", icon: UserPlus },
  {
    href: "/prices",
    label: "가격표",
    icon: Calculator,
    color: { bg: "bg-v3-purple-light", text: "text-v3-purple" },
  },
];

interface FloatingQuickActionsProps {
  "data-component": string;
}

export function FloatingQuickActions({
  "data-component": dataComponent,
}: FloatingQuickActionsProps) {
  return (
    <nav
      data-component={dataComponent}
      data-slot="floating-quick-actions"
      data-source-component={SOURCE_COMPONENT}
      data-mode="desktop"
      className={cn(
        "hidden md:flex",
        "sticky top-[calc(16px*var(--glint-ui-scale,1))] z-20 h-full min-h-0 w-[calc(72px*var(--glint-ui-scale,1))] flex-none",
        "flex-col items-center justify-end gap-[calc(16px*var(--glint-ui-scale,1))] pb-[calc(16px*var(--glint-ui-scale,1))]",
      )}
    >
      {FLOATING_ACTIONS.map((action, idx) => {
        const color = action.color ?? DEFAULT_QUICK_ACTION_COLORS[idx % DEFAULT_QUICK_ACTION_COLORS.length];
        const IconComp = action.icon as ComponentType<{
          className?: string;
          strokeWidth?: number;
        }>;

        return (
          <Link
            key={action.href + action.label}
            href={action.href}
            className={cn(
              "group flex flex-col items-center gap-[calc(4px*var(--glint-ui-scale,1))]",
              "transition-transform duration-200",
              "hover:-translate-y-0.5 active:scale-95",
            )}
          >
            <div
              className={cn(
                "flex h-[calc(48px*var(--glint-ui-scale,1))] w-[calc(48px*var(--glint-ui-scale,1))] items-center justify-center rounded-full",
                "shadow-lg",
                "transition-shadow duration-200 group-hover:shadow-xl",
                color.bg,
              )}
            >
              <IconComp className={cn("h-[calc(20px*var(--glint-ui-scale,1))] w-[calc(20px*var(--glint-ui-scale,1))]", color.text)} strokeWidth={2.5} />
            </div>
            <span className="text-center text-[calc(10px*var(--glint-ui-scale,1))] font-bold leading-tight text-v3-text-muted transition-colors group-hover:text-v3-dark">
              {action.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
