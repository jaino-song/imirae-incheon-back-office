import * as React from "react";
import { CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface AuthPanelHeaderProps {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  className?: string;
  titleClassName?: string;
  subtitleClassName?: string;
  dataComponent?: string;
  titleDataComponent?: string;
  subtitleDataComponent?: string;
}

export function AuthPanelHeader({
  title,
  subtitle,
  className,
  titleClassName,
  subtitleClassName,
  dataComponent = "desktop_auth_panel_header",
  titleDataComponent = "desktop_auth_panel_header_title",
  subtitleDataComponent = "desktop_auth_panel_header_subtitle",
}: AuthPanelHeaderProps) {
  if (!title && !subtitle) {
    return null;
  }

  return (
    <CardHeader
      data-component={dataComponent}
      className={cn("p-0 flex flex-col gap-2 text-center", className)}
    >
      {title ? (
        <h2
          data-component={titleDataComponent}
          className={cn(
            "text-[1.9rem] font-extrabold tracking-[-0.03em] text-v3-dark md:text-[1.65rem]",
            titleClassName
          )}
        >
          {title}
        </h2>
      ) : null}
      {subtitle ? (
        <p
          data-component={subtitleDataComponent}
          className={cn(
            "mx-auto max-w-[32ch] break-keep text-sm leading-5 text-v3-text-muted md:text-[0.84rem]",
            subtitleClassName
          )}
        >
          {subtitle}
        </p>
      ) : null}
    </CardHeader>
  );
}
