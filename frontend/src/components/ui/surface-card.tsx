import * as React from "react";
import { CardShell } from "@/components/ui/card-shell";
import { AuthPanelHeader } from "@/components/auth/auth-panel-header";
import { cn } from "@/lib/utils";

const SOURCE_COMPONENT = "SurfaceCard";

export interface SurfaceCardProps {
  children: React.ReactNode;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  className?: string;
  contentClassName?: string;
  headerClassName?: string;
  titleClassName?: string;
  subtitleClassName?: string;
  animated?: boolean;
  "data-component"?: string;
  dataComponents?: {
    card?: string;
    header?: string;
    title?: string;
    subtitle?: string;
    content?: string;
  };
}

export function SurfaceCard({
  children,
  title,
  subtitle,
  className,
  contentClassName,
  headerClassName,
  titleClassName,
  subtitleClassName,
  animated = true,
  "data-component": dataComponent,
  dataComponents,
}: SurfaceCardProps) {
  const componentName = dataComponent ?? "surface-card";
  const componentSlots = {
    card: dataComponents?.card ?? `${componentName}-card`,
    header: dataComponents?.header ?? `${componentName}-header`,
    title: dataComponents?.title ?? `${componentName}-title`,
    subtitle: dataComponents?.subtitle ?? `${componentName}-subtitle`,
    content: dataComponents?.content ?? `${componentName}-content`,
  };

  return (
    <CardShell
      data-component={componentSlots.card}
      sourceComponent={SOURCE_COMPONENT}
      animated={animated}
      className={className}
    >
      <AuthPanelHeader
        title={title}
        subtitle={subtitle}
        className={headerClassName}
        titleClassName={titleClassName}
        subtitleClassName={subtitleClassName}
        dataComponent={componentSlots.header}
        titleDataComponent={componentSlots.title}
        subtitleDataComponent={componentSlots.subtitle}
      />

      <div
        data-component={componentSlots.content}
        className={cn("flex flex-col gap-6", contentClassName)}
      >
        {children}
      </div>
    </CardShell>
  );
}
