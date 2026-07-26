import { type ComponentPropsWithoutRef } from "react";

import { cn } from "@/lib/utils";

const TEMPLATE_FIELD_GRID_CLASS =
  "grid grid-cols-[repeat(auto-fill,minmax(min(100%,max(10rem,calc((100%_-_2rem)_/_3))),1fr))] items-center gap-4";
const TEMPLATE_FIELD_STACK_CLASS = "flex flex-col gap-4";
const TEMPLATE_FIELD_GRID_ITEM_CLASS = "min-w-0 space-y-2";

interface TemplateFieldGridProps extends ComponentPropsWithoutRef<"div"> {
  dataComponent?: string;
  layout?: "grid" | "stack";
}

interface TemplateFieldGridItemProps extends ComponentPropsWithoutRef<"div"> {
  dataComponent?: string;
}

export function TemplateFieldGrid({
  children,
  className,
  dataComponent = "desktop_messages_sections_template-field-grid",
  layout = "grid",
  ...props
}: TemplateFieldGridProps) {
  return (
    <div
      data-component={dataComponent}
      className={cn(
        layout === "stack" ? TEMPLATE_FIELD_STACK_CLASS : TEMPLATE_FIELD_GRID_CLASS,
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function TemplateFieldGridItem({
  children,
  className,
  dataComponent = "desktop_messages_sections_template-field-grid-item",
  ...props
}: TemplateFieldGridItemProps) {
  return (
    <div
      data-component={dataComponent}
      className={cn(TEMPLATE_FIELD_GRID_ITEM_CLASS, className)}
      {...props}
    >
      {children}
    </div>
  );
}
