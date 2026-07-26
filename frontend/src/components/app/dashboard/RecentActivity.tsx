"use client";

import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { ContentPaper } from "../root/content-paper";
import { Fragment } from "react";

export interface ActivityItem {
  primary: string;
  secondary: string;
}

interface RecentActivityProps {
  items: ActivityItem[];
  title: string;
  actionLabel: string;
}

export const RecentActivity = ({ items, title, actionLabel }: RecentActivityProps) => {
  return (
    <ContentPaper data-component="desktop_dashboard_recent-activity" className="p-5 sm:p-6" disableAnimation>
      <div data-component="desktop_dashboard_recent-activity_header" className="flex flex-row justify-between items-center">
        <p className="text-base font-semibold">{title}</p>
        <Button variant="ghost" size="sm">
          {actionLabel}
          <ArrowRight className="h-4 w-4 ml-1" />
        </Button>
      </div>
      <div className="mt-4 space-y-0">
        {items.map((item, index) => (
          <Fragment key={item.primary}>
            <div data-component="desktop_dashboard_recent-activity_item" className="flex items-center gap-4 py-3">
              <Avatar className="bg-primary text-primary-foreground">
                <AvatarFallback className="bg-primary text-primary-foreground">
                  {item.primary.charAt(0)}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-base font-semibold truncate">{item.primary}</p>
                <p className="text-sm text-muted-foreground truncate">{item.secondary}</p>
              </div>
            </div>
            {index < items.length - 1 && <Separator className="ml-14" />}
          </Fragment>
        ))}
      </div>
    </ContentPaper>
  );
};
