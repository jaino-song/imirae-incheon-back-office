import * as React from "react";
import { cn } from "@/lib/utils";

const SOURCE_COMPONENT = "SurfaceFrame";

export interface SurfaceFrameProps {
  children: React.ReactNode;
  className?: string;
  innerClassName?: string;
  "data-component"?: string;
  dataComponents?: {
    container?: string;
    glow?: string;
    inner?: string;
  };
}

export function SurfaceFrame({
  children,
  className,
  innerClassName,
  "data-component": dataComponent,
  dataComponents,
}: SurfaceFrameProps) {
  const componentName = dataComponent ?? "desktop_v3_surface-frame";
  const componentSlots = {
    container: dataComponents?.container ?? `${componentName}_container`,
    glow: dataComponents?.glow ?? `${componentName}_glow`,
    inner: dataComponents?.inner ?? `${componentName}_inner`,
  };

  return (
    <div
      data-component={componentSlots.container}
      data-source-component={SOURCE_COMPONENT}
      className={cn(
        "relative flex !h-auto min-h-[100dvh] w-full items-center justify-center py-4 md:py-8",
        className,
      )}
    >
      <div
        aria-hidden="true"
        data-component={componentSlots.glow}
        className="pointer-events-none absolute inset-x-0 top-2 mx-auto h-40 w-full max-w-[640px] rounded-full bg-[radial-gradient(circle_at_top,_rgba(18,54,106,0.16),_transparent_72%)] blur-3xl"
      />

      <div
        data-component={componentSlots.inner}
        className={cn("relative flex min-h-0 w-[85%] max-w-[460px] flex-col", innerClassName)}
      >
        {children}
      </div>
    </div>
  );
}
