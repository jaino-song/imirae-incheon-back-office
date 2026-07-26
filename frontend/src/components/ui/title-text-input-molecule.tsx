"use client";

import * as React from "react";
import { useId } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export interface TitleTextInputMoleculeProps
  extends Omit<React.ComponentProps<typeof Input>, "id"> {
  id?: string;
  label: React.ReactNode;
  onValueChange?: (value: string) => void;
  required?: boolean;
  helperText?: React.ReactNode;
  helperTextClassName?: string;
  helperTextId?: string;
  containerClassName?: string;
  inputClassName?: string;
  labelRowClassName?: string;
  labelClassName?: string;
  labelTrailing?: React.ReactNode;
  dataComponent?: string;
  inputDataComponent?: string;
  labelRowDataComponent?: string;
  labelTrailingDataComponent?: string;
}

export const TitleTextInputMolecule = React.forwardRef<
  HTMLInputElement,
  TitleTextInputMoleculeProps
>(
  (
    {
      id,
      label,
      value,
      onChange,
      onValueChange,
      required = false,
      error = false,
      helperText,
      helperTextClassName,
      helperTextId,
      containerClassName,
      inputClassName,
      labelRowClassName,
      labelClassName,
      labelTrailing,
      variant = "v3",
      className,
      dataComponent = "desktop_v3_title-text-input-molecule",
      inputDataComponent,
      labelRowDataComponent,
      labelTrailingDataComponent,
      ...inputProps
    },
    ref
  ) => {
    const generatedId = useId();
    const fieldId = id ?? `title-text-input-${generatedId.replace(/:/g, "")}`;
    const helperElementId = helperText ? helperTextId ?? `${fieldId}-helper-text` : undefined;
    const describedBy = Array.from(
      new Set([inputProps["aria-describedby"], helperElementId].filter(Boolean))
    ).join(" ") || undefined;

    return (
      <div
        className={cn("grid gap-[calc(7px*var(--glint-ui-scale,1))]", containerClassName)}
        data-component={dataComponent}
      >
        <div
          data-component={labelRowDataComponent}
          className={cn("flex items-center justify-between gap-2", labelRowClassName)}
        >
          <Label
            htmlFor={fieldId}
            className={cn(
              "text-[calc(12px*var(--glint-ui-scale,1))] font-semibold leading-[1.3] text-v3-text-muted",
              labelClassName,
            )}
          >
            {label}
            {required && <span className="ml-1 text-destructive">*</span>}
          </Label>
          {labelTrailing ? (
            <div
              data-component={labelTrailingDataComponent}
              className="flex min-h-[0.6875rem] shrink-0 items-center"
            >
              {labelTrailing}
            </div>
          ) : null}
        </div>
        <Input
          {...inputProps}
          ref={ref}
          id={fieldId}
          value={value}
          variant={variant}
          required={required}
          error={error}
          data-component={inputDataComponent}
          aria-describedby={describedBy}
          onChange={(event) => {
            onChange?.(event);
            onValueChange?.(event.target.value);
          }}
          className={cn(className, inputClassName)}
        />
        {helperText ? (
          <p
            id={helperElementId}
            className={cn(
              "text-[calc(11.5px*var(--glint-ui-scale,1))] font-semibold text-destructive",
              helperTextClassName,
            )}
          >
            {helperText}
          </p>
        ) : null}
      </div>
    );
  }
);

TitleTextInputMolecule.displayName = "TitleTextInputMolecule";
