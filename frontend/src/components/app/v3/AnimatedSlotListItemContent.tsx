"use client";

import { Children, Fragment, cloneElement, createElement, isValidElement, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

type AnimatedSlotListItemIcon = LucideIcon | ReactNode;

function getDirectStatusChildren(status: ReactNode) {
  if (
    isValidElement<{ children?: ReactNode }>(status) &&
    status.type === Fragment
  ) {
    return Children.toArray(status.props.children);
  }

  return Children.toArray(status);
}

export interface AnimatedSlotListItemContentProps {
  icon: AnimatedSlotListItemIcon;
  title: ReactNode;
  subtitle?: ReactNode;
  meta?: ReactNode;
  status?: ReactNode;
  "data-component"?: string;
  dataComponent?: string;
  iconContainerClassName?: string;
  iconClassName?: string;
  contentClassName?: string;
  titleClassName?: string;
  subtitleClassName?: string;
  metaClassName?: string;
  statusClassName?: string;
}

export function AnimatedSlotListItemContent({
  icon: Icon,
  title,
  subtitle,
  meta,
  status,
  "data-component": canonicalDataComponent,
  dataComponent: legacyDataComponent,
  iconContainerClassName,
  iconClassName,
  contentClassName,
  titleClassName,
  subtitleClassName,
  metaClassName,
  statusClassName,
}: AnimatedSlotListItemContentProps) {
  // TODO(data-component): Remove the legacy fallback after all callers migrate.
  const dataComponent =
    canonicalDataComponent ?? legacyDataComponent ?? "animated-slot-list-item-content";
  const sub = (suffix: string) =>
    canonicalDataComponent
      ? `${dataComponent}_${suffix}`
      : `${dataComponent}-${suffix}`;
  const hasSupportingContent = Boolean(subtitle || meta);
  const iconClassNames = cn(
    "h-[calc(20px*var(--glint-ui-scale,1))] w-[calc(20px*var(--glint-ui-scale,1))]",
    iconClassName
  );
  const isIconComponent =
    typeof Icon === "function" ||
    (typeof Icon === "object" &&
      Icon !== null &&
      ("render" in Icon || "type" in Icon));
  const iconNode = isValidElement<{ className?: string }>(Icon) ? (
    cloneElement(Icon, {
      className: cn(Icon.props.className, iconClassNames),
    })
  ) : isIconComponent ? (
    createElement(Icon as LucideIcon, { className: iconClassNames })
  ) : (
    <span className={cn("text-[calc(14px*var(--glint-ui-scale,1))] font-bold leading-none", iconClassName)}>
      {Icon}
    </span>
  );
  const statusChildren = status ? getDirectStatusChildren(status) : [];
  const shouldCompactStatus = statusChildren.length > 1;
  const renderedStatus = shouldCompactStatus ? (
    <>
      {statusChildren[0]}
      <span
        data-component={sub("status-more")}
        className="shrink-0 text-[calc(10.4px*var(--glint-ui-scale,1))] font-semibold text-v3-text-muted"
      >
        +{statusChildren.length - 1}
      </span>
    </>
  ) : (
    status
  );

  return (
    <>
      <div
        data-component={sub("icon")}
        className={cn(
          "flex h-[calc(44px*var(--glint-ui-scale,1))] w-[calc(44px*var(--glint-ui-scale,1))] shrink-0 items-center justify-center rounded-[14px] bg-v3-dim-white text-v3-text-muted shadow-md",
          iconContainerClassName
        )}
      >
        {iconNode}
      </div>

      <div
        data-component={sub("content")}
        className={cn("min-w-0 flex-1", contentClassName)}
      >
        <div
          data-component={sub("title-row")}
          className={cn(
            "flex items-center gap-[calc(8px*var(--glint-ui-scale,1))]",
            hasSupportingContent && "mb-[calc(2px*var(--glint-ui-scale,1))]"
          )}
        >
          <span
            data-component={sub("title")}
            className={cn(
              "truncate text-[calc(13.6px*var(--glint-ui-scale,1))] font-bold text-v3-dark",
              titleClassName
            )}
          >
            {title}
          </span>
        </div>

        {subtitle ? (
          <div
            data-component={sub("subtitle")}
            className={cn(
              "flex items-center gap-[calc(8px*var(--glint-ui-scale,1))] truncate text-[calc(11.2px*var(--glint-ui-scale,1))] text-v3-text-muted",
              subtitleClassName
            )}
          >
            {subtitle}
          </div>
        ) : null}

        {meta ? (
          <div
            data-component={sub("meta")}
            className={cn(
              "mt-[calc(6px*var(--glint-ui-scale,1))] flex items-center gap-[calc(12px*var(--glint-ui-scale,1))] overflow-hidden whitespace-nowrap text-[calc(10.4px*var(--glint-ui-scale,1))] leading-none text-v3-text-muted",
              metaClassName
            )}
          >
            {meta}
          </div>
        ) : null}
      </div>

      {status ? (
        <div
          data-component={sub("status")}
          className={cn(
            "shrink-0",
            shouldCompactStatus && "flex items-center justify-end gap-1",
            statusClassName
          )}
        >
          {renderedStatus}
        </div>
      ) : null}
    </>
  );
}
