"use client";

import { Clock, User, CheckCircle2, Circle, PlayCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { todaySchedules } from "@/mocks/dashboard";

const statusConfig = {
  예정: {
    icon: Circle,
    className: "text-muted-foreground",
    badgeClassName: "bg-muted text-muted-foreground border-muted",
  },
  진행중: {
    icon: PlayCircle,
    className: "text-info animate-pulse-subtle",
    badgeClassName: "bg-info/10 text-info border-info/20",
  },
  완료: {
    icon: CheckCircle2,
    className: "text-success",
    badgeClassName: "bg-success/10 text-success border-success/20",
  },
};

export function TodayScheduleList() {
  return (
    <Card data-component="desktop_dashboard_schedule" className="opacity-0 animate-fade-in" style={{ animationDelay: "500ms" }}>
      <CardHeader data-component="desktop_dashboard_schedule_header" className="flex flex-row items-center justify-between">
        <CardTitle className="text-lg font-semibold">오늘의 일정</CardTitle>
        <Badge data-component="desktop_dashboard_schedule_header_count" variant="secondary" className="font-normal animate-scale-in" style={{ animationDelay: "600ms" }}>
          총 {todaySchedules.length}건
        </Badge>
      </CardHeader>
      <CardContent data-component="desktop_dashboard_schedule_content">
        <div data-component="desktop_dashboard_schedule_content_items" className="space-y-4">
          {todaySchedules.map((schedule, index) => {
            const config = statusConfig[schedule.status];
            const StatusIcon = config.icon;

            return (
              <div
                key={schedule.id}
                data-component="desktop_dashboard_schedule_content_items_item"
                className={cn(
                  "flex items-start gap-4 rounded-lg border p-3 cursor-pointer",
                  "transition-all duration-200 ease-out",
                  "hover:bg-muted/50 hover:border-l-2 hover:border-l-primary hover:translate-x-1",
                  "opacity-0 animate-slide-in-left"
                )}
                style={{ animationDelay: `${550 + index * 75}ms` }}
              >
                <div className={cn("mt-0.5 transition-transform duration-200 hover:scale-110", config.className)}>
                  <StatusIcon className="h-5 w-5" />
                </div>
                <div className="flex-1 space-y-1">
                  <div className="flex items-center justify-between">
                    <p className="font-medium">{schedule.clientName}</p>
                    <Badge variant="outline" className={cn(config.badgeClassName, "animate-scale-in")} style={{ animationDelay: `${600 + index * 75}ms` }}>
                      {schedule.status}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5" />
                      {schedule.time}
                    </span>
                    <span className="flex items-center gap-1">
                      <User className="h-3.5 w-3.5" />
                      {schedule.employeeName}
                    </span>
                    <span>{schedule.type}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
