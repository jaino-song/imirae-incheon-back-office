"use client";

import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { pendingClients } from "@/mocks/dashboard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const statusConfig = {
  waiting: {
    label: "대기중",
    badgeClass: "bg-warning/10 text-warning border-warning/30",
    avatarClass: "bg-success/10 text-success",
  },
  inProgress: {
    label: "진행중",
    badgeClass: "bg-success/10 text-success border-success/30",
    avatarClass: "bg-primary/10 text-primary",
  },
  completed: {
    label: "완료",
    badgeClass: "bg-primary text-primary-foreground border-primary",
    avatarClass: "bg-warning/10 text-warning",
  },
};

export function PendingClientsTable() {
  return (
    <Card variant="v3" data-component="desktop_dashboard_pending-clients" className="opacity-0 animate-pop-in h-full" style={{ animationDelay: "300ms" }}>
      <CardHeader variant="v3">
        <CardTitle className="text-lg">최근 고객 목록</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div data-component="desktop_dashboard_pending-clients-table" className="flex flex-col">
          {pendingClients.map((client, index) => {
            const statusKey = index === 0 ? "inProgress" : index === 1 ? "waiting" : "completed";
            const status = statusConfig[statusKey];
            const initials = client.name.slice(0, 2);

            return (
              <div
                key={client.id}
                data-component="desktop_dashboard_pending-clients-item"
                className={cn(
                  "flex items-center gap-3 px-6 py-4",
                  "transition-colors cursor-pointer hover:bg-muted/50",
                  index !== pendingClients.length - 1 && "border-b border-border/50"
                )}
              >
                <div
                  className={cn(
                    "h-10 w-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0",
                    status.avatarClass
                  )}
                >
                  {initials}
                </div>

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground truncate">{client.name}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {client.type} · {client.startDate}
                  </p>
                </div>

                <div
                  className={cn(
                    "px-2.5 py-1 rounded-full border text-xs font-medium shrink-0",
                    status.badgeClass
                  )}
                >
                  {status.label}
                </div>

                <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0" />
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
