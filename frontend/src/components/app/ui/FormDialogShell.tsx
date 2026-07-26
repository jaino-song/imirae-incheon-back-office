"use client";

import * as React from "react";
import { X } from "lucide-react";

import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  APP_DIALOG_BODY_CLASS_NAME,
  APP_DIALOG_CLOSE_ICON_CLASS_NAME,
  APP_DIALOG_EYEBROW_CLASS_NAME,
  APP_DIALOG_FLUSH_CONTENT_CLASS_NAME,
  APP_DIALOG_FOOTER_CLASS_NAME,
  APP_DIALOG_HEADER_CLASS_NAME,
  APP_DIALOG_HEADER_ROW_CLASS_NAME,
  APP_DIALOG_INLINE_CLOSE_BUTTON_CLASS_NAME,
  APP_DIALOG_TITLE_CLASS_NAME,
  APP_FORM_DIALOG_CONTENT_CLASS_NAME,
} from "@/components/ui/app-surface";

const SOURCE_COMPONENT = "FormDialogShell";

interface FormDialogShellProps {
  "data-component"?: string;
  dataComponent?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  eyebrow?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  contentClassName?: string;
  footerClassName?: string;
}

export function FormDialogShell({
  "data-component": canonicalDataComponent,
  dataComponent: legacyDataComponent,
  title,
  description,
  eyebrow,
  children,
  footer,
  contentClassName,
  footerClassName,
}: FormDialogShellProps) {
  const canonicalDataComponentBase = canonicalDataComponent || undefined;
  const dataComponent = canonicalDataComponentBase ?? legacyDataComponent;
  const sub = (suffix: string) => {
    if (canonicalDataComponentBase) return `${canonicalDataComponentBase}_${suffix}`;
    return legacyDataComponent ? `${legacyDataComponent}-${suffix}` : undefined;
  };

  return (
    <DialogContent
      data-component={dataComponent}
      data-source-component={SOURCE_COMPONENT}
      showCloseButton={false}
      className={cn(
        APP_DIALOG_FLUSH_CONTENT_CLASS_NAME,
        APP_FORM_DIALOG_CONTENT_CLASS_NAME,
      )}
    >
      <DialogHeader className={APP_DIALOG_HEADER_CLASS_NAME}>
        <div className={APP_DIALOG_HEADER_ROW_CLASS_NAME}>
          <div className="min-w-0">
            {eyebrow ? (
              <span className={APP_DIALOG_EYEBROW_CLASS_NAME}>
                {eyebrow}
              </span>
            ) : null}
            <DialogTitle className={APP_DIALOG_TITLE_CLASS_NAME}>
              {title}
            </DialogTitle>
          </div>

          <DialogClose asChild>
            <button
              type="button"
              className={APP_DIALOG_INLINE_CLOSE_BUTTON_CLASS_NAME}
            >
              <X className={APP_DIALOG_CLOSE_ICON_CLASS_NAME} />
              <span className="sr-only">Close</span>
            </button>
          </DialogClose>
        </div>
        {description ? <DialogDescription className="sr-only">{description}</DialogDescription> : null}
      </DialogHeader>

      <div
        data-component={sub("content")}
        className={cn(APP_DIALOG_BODY_CLASS_NAME, contentClassName)}
      >
        {children}
      </div>

      {footer ? (
        <DialogFooter
          data-component={sub("actions")}
          className={cn(APP_DIALOG_FOOTER_CLASS_NAME, footerClassName)}
        >
          {footer}
        </DialogFooter>
      ) : null}
    </DialogContent>
  );
}
