"use client";

import { UserPlus, FileSignature, MessageSquare, LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface QuickAction {
  label: string;
  icon: LucideIcon;
  href?: string;
  iconBgClass?: string;
  iconColor?: string;
}

const actions: QuickAction[] = [
  {
    label: "고객 등록",
    icon: UserPlus,
    iconBgClass: "bg-primary/10",
    iconColor: "text-primary",
  },
  {
    label: "계약서 전송",
    icon: FileSignature,
    iconBgClass: "bg-orange/10",
    iconColor: "text-orange",
  },
  {
    label: "메시지 작성",
    icon: MessageSquare,
    iconBgClass: "bg-success/10",
    iconColor: "text-success",
  },
  {
    label: "제공인력 추가",
    icon: UserPlus,
    iconBgClass: "bg-burgundy/10",
    iconColor: "text-burgundy",
  },
];

export function QuickActions() {
  return (
    <div data-component="desktop_dashboard_quick-actions" className="opacity-0 animate-fade-in" style={{ animationDelay: "400ms" }}>
      <div data-component="desktop_dashboard_quick-actions_grid" className="grid grid-cols-4 gap-2">
        {actions.map((action, index) => {
          const Icon = action.icon;
          return (
            <div
              key={action.label}
              data-component="desktop_dashboard_quick-actions_grid_card"
              className={cn(
                "aspect-square flex flex-col items-center justify-center rounded-xl border bg-card",
                "transition-all active:scale-[0.95] cursor-pointer hover:shadow-md",
                "opacity-0 animate-scale-in"
              )}
              style={{ animationDelay: `${450 + index * 50}ms` }}
              role="button"
              tabIndex={0}
            >
              <div className={cn("p-2 rounded-full mb-1.5", action.iconBgClass || "bg-primary/10")}>
                <Icon className={cn("h-4 w-4", action.iconColor || "text-primary")} />
              </div>
              <span className="text-xs font-medium text-center">{action.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
