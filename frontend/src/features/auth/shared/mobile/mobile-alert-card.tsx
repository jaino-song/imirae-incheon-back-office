import * as React from "react";
import Link from "next/link";

import { Alert, type AlertProps } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

interface MobileAlertCardProps
  extends Omit<AlertProps, "children" | "dataComponents" | "data-component"> {
  message: React.ReactNode;
  actionLabel?: React.ReactNode;
  actionHref?: string;
  actionOnClick?: () => void;
  "data-component"?: string;
}

export function MobileAlertCard({
  message,
  actionLabel,
  actionHref,
  actionOnClick,
  "data-component": dataComponent,
  ...alertProps
}: MobileAlertCardProps) {
  const componentName = dataComponent ?? "desktop_auth_alert-card";

  return (
    <Alert {...alertProps} data-component={componentName}>
      <div data-component={`${componentName}-message`}>{message}</div>
      {actionLabel ? (
        <div data-component={`${componentName}-action-container`} className="mt-1">
          {actionHref ? (
            <Link
              href={actionHref}
              data-component={`${componentName}-action-link`}
              className="text-destructive underline hover:no-underline"
            >
              {actionLabel}
            </Link>
          ) : (
            <button
              type="button"
              onClick={actionOnClick}
              data-component={`${componentName}-action-button`}
              className={cn("text-destructive underline hover:no-underline")}
            >
              {actionLabel}
            </button>
          )}
        </div>
      ) : null}
    </Alert>
  );
}
