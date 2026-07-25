import * as React from "react";

import { cn } from "@/lib/utils";

export const APP_DIALOG_SURFACE_CLASS_NAME =
  "rounded-[28px] border-none bg-v3-dim-white shadow-[0_20px_60px_hsla(214,50%,20%,0.15)]";

export const APP_DIALOG_CONTENT_CLASS_NAME = [
  "data-[state=open]:animate-in data-[state=closed]:animate-out",
  "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
  "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
  "fixed left-[50%] top-[50%] z-50 grid max-h-[80vh] w-[calc(100vw-1.5rem)] content-start",
  "-translate-x-1/2 -translate-y-1/2 gap-0 overflow-y-auto duration-200 outline-none sm:w-full",
  APP_DIALOG_SURFACE_CLASS_NAME,
].join(" ");

export const APP_DIALOG_PADDED_CONTENT_CLASS_NAME = "p-4";
export const APP_DIALOG_FLUSH_CONTENT_CLASS_NAME = "overflow-hidden p-0";
export const APP_FORM_DIALOG_CONTENT_CLASS_NAME =
  "h-[90vh] max-h-[calc(100vh-1.5rem)] w-[min(720px,calc(100vw-1.5rem))] max-w-[720px] grid-rows-[auto_minmax(0,1fr)_auto]";
export const APP_DIALOG_HEADER_CLASS_NAME = "border-b border-v3-border bg-white p-4 text-left";
export const APP_DIALOG_HEADER_ROW_CLASS_NAME = "flex items-center justify-between gap-4";
export const APP_DIALOG_TITLE_CLASS_NAME = "text-[calc(16px*var(--glint-ui-scale,1))] font-bold text-v3-dark";
export const APP_DIALOG_DESCRIPTION_CLASS_NAME =
  "mt-[calc(6px*var(--glint-ui-scale,1))] text-[calc(12px*var(--glint-ui-scale,1))] leading-[calc(20px*var(--glint-ui-scale,1))] text-v3-text-muted";
export const APP_DIALOG_EYEBROW_CLASS_NAME =
  "mb-[calc(12px*var(--glint-ui-scale,1))] inline-flex items-center rounded-full bg-white/80 px-[calc(12px*var(--glint-ui-scale,1))] py-[calc(4px*var(--glint-ui-scale,1))] text-[calc(10.88px*var(--glint-ui-scale,1))] font-semibold uppercase tracking-[0.12em] text-v3-primary shadow-sm";
export const APP_DIALOG_BODY_CLASS_NAME = "min-h-0 space-y-5 overflow-y-auto px-6 py-6";
export const APP_DIALOG_FOOTER_CLASS_NAME = "border-t border-v3-border bg-white p-4 sm:justify-end";
export const APP_DIALOG_INLINE_CLOSE_BUTTON_CLASS_NAME =
  "flex h-[calc(20px*var(--glint-ui-scale,1))] w-[calc(20px*var(--glint-ui-scale,1))] shrink-0 items-center justify-center rounded-full border-0 bg-transparent p-0 text-v3-text-muted shadow-none transition-colors hover:text-v3-dark";
export const APP_DIALOG_FLOATING_CLOSE_BUTTON_CLASS_NAME =
  "absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full border border-v3-border bg-white text-v3-text-muted transition-colors hover:bg-white hover:text-v3-dark focus:outline-none focus:ring-2 focus:ring-v3-primary/20 disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4";
export const APP_DIALOG_CLOSE_ICON_CLASS_NAME =
  "h-[calc(20px*var(--glint-ui-scale,1))] w-[calc(20px*var(--glint-ui-scale,1))]";

export const APP_CONTENT_CARD_CLASS_NAME =
  "rounded-[16px] bg-white p-[calc(16px*var(--glint-ui-scale,1))] shadow-[0_1px_8px_rgba(31,42,61,0.06)]";
export const APP_CONTENT_CARD_MUTED_CLASS_NAME =
  "rounded-[18px] bg-v3-dim-white p-[calc(16px*var(--glint-ui-scale,1))]";
export const APP_CONTENT_CARD_OUTLINED_CLASS_NAME =
  "rounded-[16px] border border-v3-border/70 bg-white p-[calc(16px*var(--glint-ui-scale,1))]";
export const APP_CONTENT_CARD_TITLE_CLASS_NAME =
  "m-0 text-[calc(12px*var(--glint-ui-scale,1))] font-bold leading-[1.3] text-v3-text";
export const APP_CONTENT_CARD_EYEBROW_TITLE_CLASS_NAME =
  "m-0 text-[calc(12px*var(--glint-ui-scale,1))] font-semibold uppercase tracking-[0.1em] text-v3-text-muted";
export const APP_CONTENT_CARD_DESCRIPTION_CLASS_NAME =
  "m-0 text-[calc(11.2px*var(--glint-ui-scale,1))] font-semibold leading-[1.4] text-v3-text-muted";
export const APP_CONTENT_CARD_BODY_CLASS_NAME = "grid gap-[calc(14px*var(--glint-ui-scale,1))]";
export const APP_CONTENT_BODY_CARD_CLASS_NAME =
  "rounded-[18px] bg-white p-[calc(16px*var(--glint-ui-scale,1))]";
export const APP_CONTENT_BODY_CARD_OUTLINED_CLASS_NAME =
  "rounded-[18px] border border-v3-border bg-white p-[calc(16px*var(--glint-ui-scale,1))]";
export const APP_SURFACE_CARD_CLASS_NAME =
  "relative w-full rounded-[28px] border-0 bg-white p-6 text-foreground shadow-v3 sm:p-7";

type AppContentCardElement = "div" | "section" | "article";
type AppContentCardVariant = "default" | "muted" | "outlined";
type AppContentCardTitleVariant = "default" | "eyebrow";
type AppContentCardTitleElement = "h2" | "h3";

export interface AppContentCardProps extends Omit<React.HTMLAttributes<HTMLElement>, "title"> {
  as?: AppContentCardElement;
  title?: React.ReactNode;
  description?: React.ReactNode;
  variant?: AppContentCardVariant;
  titleVariant?: AppContentCardTitleVariant;
  titleElement?: AppContentCardTitleElement;
  titleTrailing?: React.ReactNode;
  contentClassName?: string;
  headerClassName?: string;
  titleClassName?: string;
  descriptionClassName?: string;
  headerDataComponent?: string;
  titleDataComponent?: string;
  descriptionDataComponent?: string;
  bodyDataComponent?: string;
  "data-component": string;
  "data-source-component"?: string;
}

export function AppContentCard({
  as = "div",
  title,
  description,
  variant = "default",
  titleVariant = "default",
  titleElement = "h2",
  titleTrailing,
  className,
  contentClassName,
  headerClassName,
  titleClassName,
  descriptionClassName,
  headerDataComponent,
  titleDataComponent,
  descriptionDataComponent,
  bodyDataComponent,
  children,
  "data-component": dataComponent,
  "data-source-component": dataSourceComponent = "AppContentCard",
  ...props
}: AppContentCardProps) {
  const Component = as as React.ElementType;
  const variantClassName =
    variant === "muted"
      ? APP_CONTENT_CARD_MUTED_CLASS_NAME
      : variant === "outlined"
        ? APP_CONTENT_CARD_OUTLINED_CLASS_NAME
        : APP_CONTENT_CARD_CLASS_NAME;
  const titleClass =
    titleVariant === "eyebrow"
      ? APP_CONTENT_CARD_EYEBROW_TITLE_CLASS_NAME
      : APP_CONTENT_CARD_TITLE_CLASS_NAME;
  const TitleElement = titleElement;

  return (
    <Component
      data-component={dataComponent}
      data-source-component={dataSourceComponent}
      className={cn("grid gap-[calc(12px*var(--glint-ui-scale,1))]", variantClassName, className)}
      {...props}
    >
      {title || description ? (
        <div
          data-component={headerDataComponent ?? `${dataComponent}_head`}
          className={cn("grid gap-[calc(3px*var(--glint-ui-scale,1))]", headerClassName)}
        >
          {title ? (
            <div
              data-component={`${dataComponent}_head_title-row`}
              className="flex items-center gap-[calc(8px*var(--glint-ui-scale,1))]"
            >
              <TitleElement
                data-component={titleDataComponent ?? `${dataComponent}_head_title-row_title`}
                className={cn(titleClass, titleClassName)}
              >
                {title}
              </TitleElement>
              {titleTrailing}
            </div>
          ) : null}
          {description ? (
            <p
              data-component={descriptionDataComponent ?? `${dataComponent}_head_caption`}
              className={cn(APP_CONTENT_CARD_DESCRIPTION_CLASS_NAME, descriptionClassName)}
            >
              {description}
            </p>
          ) : null}
        </div>
      ) : null}

      <div
        data-component={bodyDataComponent ?? `${dataComponent}_body`}
        className={cn(APP_CONTENT_CARD_BODY_CLASS_NAME, contentClassName)}
      >
        {children}
      </div>
    </Component>
  );
}
