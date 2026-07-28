"use client";

import * as React from "react";

import { V3_INPUT_CONTROL_HEIGHT_CLASS_NAME } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface FormCheckboxFieldProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "children" | "className" | "type"> {
  label: React.ReactNode;
  className?: string;
  inputClassName?: string;
  "data-component"?: string;
}

export const FormCheckboxField = React.forwardRef<HTMLInputElement, FormCheckboxFieldProps>(
  (
    {
      label,
      className,
      inputClassName,
      disabled,
      "data-component": dataComponent = "desktop_v3_form-checkbox-field",
      ...inputProps
    },
    ref,
  ) => (
    <label
      data-component={dataComponent}
      className={cn(
        V3_INPUT_CONTROL_HEIGHT_CLASS_NAME,
        "flex w-full cursor-pointer items-center gap-[calc(12px*var(--glint-ui-scale,1))] rounded-[13px] border-[1.35px] border-v3-border bg-white px-[calc(14px*var(--glint-ui-scale,1))] text-[calc(12px*var(--glint-ui-scale,1))] font-semibold text-v3-dark transition-colors",
        disabled && "cursor-not-allowed opacity-55",
        className,
      )}
    >
      <input
        {...inputProps}
        ref={ref}
        type="checkbox"
        disabled={disabled}
        data-component={`${dataComponent}-input`}
        className={cn(
          "h-[calc(16px*var(--glint-ui-scale,1))] w-[calc(16px*var(--glint-ui-scale,1))] shrink-0 accent-v3-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-v3-primary/20",
          inputClassName,
        )}
      />
      <span data-component={`${dataComponent}-label`}>{label}</span>
    </label>
  ),
);

FormCheckboxField.displayName = "FormCheckboxField";
