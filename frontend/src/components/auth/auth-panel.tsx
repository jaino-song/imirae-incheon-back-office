import * as React from "react";
import { SurfaceCard } from "@/components/ui/surface-card";
import { SurfaceFrame } from "@/components/ui/surface-frame";
import { cn } from "@/lib/utils";

export interface AuthPanelProps {
  children: React.ReactNode;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  containerClassName?: string;
  className?: string;
  contentClassName?: string;
  disableAnimation?: boolean;
  headerActionsLeft?: React.ReactNode;
  headerActionsRight?: React.ReactNode;
  "data-component"?: string;
  dataComponents?: {
    container?: string;
    card?: string;
    headerActions?: string;
    header?: string;
    title?: string;
    subtitle?: string;
    content?: string;
  };
}

export function AuthPanel({
  children,
  title,
  subtitle,
  containerClassName,
  className,
  contentClassName,
  disableAnimation = false,
  headerActionsLeft,
  headerActionsRight,
  "data-component": dataComponent,
  dataComponents,
}: AuthPanelProps) {
  const hasHeaderActions = Boolean(headerActionsLeft || headerActionsRight);
  const componentName = dataComponent ?? "desktop_auth_panel";
  const componentSlots = {
    container: dataComponents?.container ?? `${componentName}_container`,
    card: dataComponents?.card ?? `${componentName}_card`,
    headerActions: dataComponents?.headerActions ?? `${componentName}_header-actions`,
    header: dataComponents?.header ?? `${componentName}_header`,
    title: dataComponents?.title ?? `${componentName}_title`,
    subtitle: dataComponents?.subtitle ?? `${componentName}_subtitle`,
    content: dataComponents?.content ?? `${componentName}_content`,
  };

  return (
    <SurfaceFrame
      data-component={componentName}
      dataComponents={{
        container: componentSlots.container,
        glow: `${componentName}_glow`,
        inner: `${componentName}_inner`,
      }}
      className={containerClassName}
    >
        <SurfaceCard
          data-component={componentName}
          dataComponents={{
            card: componentSlots.card,
            header: componentSlots.header,
            title: componentSlots.title,
            subtitle: componentSlots.subtitle,
            content: componentSlots.content,
          }}
          title={title}
          subtitle={subtitle}
          animated={!disableAnimation}
          className={cn(
            "max-h-[85dvh] overflow-x-hidden overflow-y-auto lg:max-h-[85%]",
            className,
          )}
          contentClassName={contentClassName}
        >
          {hasHeaderActions ? (
            <div
              data-component={componentSlots.headerActions}
              className="flex items-center justify-between"
            >
              <div>{headerActionsLeft}</div>
              <div>{headerActionsRight}</div>
            </div>
          ) : null}

          {children}
        </SurfaceCard>
    </SurfaceFrame>
  );
}
