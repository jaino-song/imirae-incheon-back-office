import * as React from "react";
import { Card, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface CardContainerProps {
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
  className?: string;
  contentClassName?: string;
  disableAnimation?: boolean;
  headerActionsLeft?: React.ReactNode;
  headerActionsRight?: React.ReactNode;
  /**
   * Canonical data-component base for the surface that renders this card. The
   * internal levels below are derived from it with `${base}_${suffix}` so the
   * rendered DOM keeps the full-parent-path contract.
   */
  "data-component": string;
  "data-slot"?: string;
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

export function CardContainer({
  children,
  title,
  subtitle,
  className,
  contentClassName,
  disableAnimation = false,
  headerActionsLeft,
  headerActionsRight,
  "data-component": dataComponent,
  "data-slot": dataSlot,
  dataComponents,
}: CardContainerProps) {
  const hasHeader = Boolean(title || subtitle);
  const hasHeaderActions = Boolean(headerActionsLeft || headerActionsRight);
  const componentName = dataComponent;
  const componentSlots = {
    container: dataComponents?.container ?? componentName,
    card: dataComponents?.card ?? `${componentName}_card`,
    headerActions: dataComponents?.headerActions ?? `${componentName}_card_header-actions`,
    header: dataComponents?.header ?? `${componentName}_card_header`,
    title: dataComponents?.title ?? `${componentName}_card_header_title`,
    subtitle: dataComponents?.subtitle ?? `${componentName}_card_header_subtitle`,
    content: dataComponents?.content ?? `${componentName}_card_content`,
  };

  return (
    <div
      data-component={componentSlots.container}
      data-slot={dataSlot}
      className="flex w-full flex-1 items-center justify-center"
    >
      <Card
        data-component={componentSlots.card}
        className={cn(
          "w-full max-w-[440px] flex-1 rounded-2xl border-none bg-white text-foreground shadow-v3 p-6",
          "flex flex-col overflow-hidden gap-6",
          !disableAnimation && "animate-scale-in",
          className
        )}
      >
        {hasHeaderActions && (
          <div
            data-component={componentSlots.headerActions}
            className="flex items-center justify-between"
          >
            <div>{headerActionsLeft}</div>
            <div>{headerActionsRight}</div>
          </div>
        )}

        {hasHeader && (
          <CardHeader
            data-component={componentSlots.header}
            className="p-0 flex flex-col gap-1 text-center"
          >
            {title && (
              <h2 data-component={componentSlots.title} className="text-2xl md:text-xl font-extrabold text-v3-dark">
                {title}
              </h2>
            )}
            {subtitle && (
              <p data-component={componentSlots.subtitle} className="break-keep text-xs text-v3-text-muted md:text-[0.8rem]">
                {subtitle}
              </p>
            )}
          </CardHeader>
        )}

        <div
          data-component={componentSlots.content}
          className={cn(contentClassName)}
        >
          {children}
        </div>
      </Card>
    </div>
  );
}
