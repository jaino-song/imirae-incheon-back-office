import * as React from "react";

import { Card, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface MobileAuthCardContainerProps {
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
  className?: string;
  contentClassName?: string;
  disableAnimation?: boolean;
  "data-component"?: string;
  dataComponents?: {
    container?: string;
    card?: string;
    header?: string;
    title?: string;
    subtitle?: string;
    content?: string;
  };
}

export function MobileAuthCardContainer({
  children,
  title,
  subtitle,
  className,
  contentClassName,
  disableAnimation = false,
  "data-component": dataComponent,
  dataComponents,
}: MobileAuthCardContainerProps) {
  const hasHeader = Boolean(title || subtitle);
  const componentName = dataComponent ?? "desktop_auth_card-container";
  const componentSlots = {
    container: dataComponents?.container ?? `${componentName}_container`,
    card: dataComponents?.card ?? `${componentName}_card`,
    header: dataComponents?.header ?? `${componentName}_header`,
    title: dataComponents?.title ?? `${componentName}_title`,
    subtitle: dataComponents?.subtitle ?? `${componentName}_subtitle`,
    content: dataComponents?.content ?? `${componentName}_content`,
  };

  return (
    <div
      data-component={componentSlots.container}
      className="flex min-h-[100dvh] w-full items-center justify-center py-4"
    >
      <Card
        data-component={componentSlots.card}
        className={cn(
          "flex flex-1 flex-col gap-6 overflow-hidden rounded-2xl border-none bg-white p-6 text-foreground shadow-v3",
          "w-full max-w-[440px]",
          "max-h-[85dvh] overflow-x-hidden overflow-y-auto lg:max-h-[85%]",
          !disableAnimation && "animate-scale-in",
          className,
        )}
      >
        {hasHeader ? (
          <CardHeader
            data-component={componentSlots.header}
            className="flex flex-col gap-1 p-0 text-center"
          >
            {title ? (
              <h2 data-component={componentSlots.title} className="text-2xl font-extrabold text-v3-dark md:text-xl">
                {title}
              </h2>
            ) : null}
            {subtitle ? (
              <p data-component={componentSlots.subtitle} className="break-keep text-xs text-v3-text-muted md:text-[0.8rem]">
                {subtitle}
              </p>
            ) : null}
          </CardHeader>
        ) : null}

        <div data-component={componentSlots.content} className={cn(contentClassName)}>
          {children}
        </div>
      </Card>
    </div>
  );
}
