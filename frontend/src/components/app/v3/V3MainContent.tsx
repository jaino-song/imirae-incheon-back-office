"use client";

import { usePathname } from "next/navigation";
import { isLayoutExcluded } from "@/lib/constants/v3-layout";
import { cn } from "@/lib/utils";
import { FloatingQuickActions } from "./FloatingQuickActions";
import { useGlintUiScaleStyle } from "./useGlintUiScale";

const SOURCE_COMPONENT = "V3MainContent";

interface V3MainContentProps {
  children: React.ReactNode;
  "data-component": string;
}

export function V3MainContent({
  children,
  "data-component": dataComponent,
}: V3MainContentProps) {
  const pathname = usePathname();
  const excluded = isLayoutExcluded(pathname);
  const isSelectBranchPage = pathname === "/select-branch";
  const shouldApplyGlintUiScale = !excluded && !isSelectBranchPage;
  const scaledStyle = useGlintUiScaleStyle(shouldApplyGlintUiScale);
  const shouldRenderQuickActions = !excluded && !isSelectBranchPage;
  const paddingClassName = isSelectBranchPage
    ? "p-0 md:p-0"
    : excluded
      ? "px-[calc(16px*var(--glint-ui-scale,1))] py-[calc(16px*var(--glint-ui-scale,1))] md:px-[calc(32px*var(--glint-ui-scale,1))]"
      : "px-[calc(16px*var(--glint-ui-scale,1))] pb-[calc(80px*var(--glint-ui-scale,1))] pt-[calc(80px*var(--glint-ui-scale,1))] md:pb-[calc(32px*var(--glint-ui-scale,1))] md:pl-[calc(min(20vw,240px)*var(--glint-ui-scale,1)+16px*var(--glint-ui-scale,1))] md:pr-[calc(16px*var(--glint-ui-scale,1))] md:pt-[calc(32px*var(--glint-ui-scale,1))]";

  return (
    <main
      data-component={dataComponent}
      data-slot="main-content"
      data-source-component={SOURCE_COMPONENT}
      data-mode="desktop"
      style={scaledStyle}
      className={cn(
        "h-screen overflow-hidden bg-v3-dim-white",
        shouldRenderQuickActions && "md:flex md:flex-row md:items-stretch md:gap-[calc(16px*var(--glint-ui-scale,1))]",
        paddingClassName,
      )}
    >
      {shouldRenderQuickActions ? (
        <>
          <div
            data-component={`${dataComponent}_body`}
            data-slot="main-content-body"
            className="h-full min-h-0 min-w-0 flex-1 overflow-hidden"
          >
            {children}
          </div>
          <FloatingQuickActions data-component={`${dataComponent}_quick-actions`} />
        </>
      ) : (
        children
      )}
    </main>
  );
}
