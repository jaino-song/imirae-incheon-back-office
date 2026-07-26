"use client";

import * as React from "react";
import { useId } from "react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export interface TitleSelectOption {
  value: string;
  label: React.ReactNode;
  disabled?: boolean;
}

export interface TitleSelectMoleculeProps {
  id?: string;
  label: React.ReactNode;
  value?: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  options: TitleSelectOption[];
  disabled?: boolean;
  required?: boolean;
  helperText?: React.ReactNode;
  helperTextClassName?: string;
  helperTextId?: string;
  containerClassName?: string;
  triggerClassName?: string;
  labelClassName?: string;
  labelRowClassName?: string;
  contentClassName?: string;
  itemClassName?: string;
  dataComponent?: string;
  triggerDataComponent?: string;
  contentDataComponent?: string;
  optionDataComponent?: string;
}

export function TitleSelectMolecule({
  id,
  label,
  value,
  onValueChange,
  placeholder,
  options,
  disabled = false,
  required = false,
  helperText,
  helperTextClassName,
  helperTextId,
  containerClassName,
  triggerClassName,
  labelClassName,
  labelRowClassName,
  contentClassName,
  itemClassName,
  dataComponent = "desktop_v3_title-select-molecule",
  triggerDataComponent,
  contentDataComponent,
  optionDataComponent,
}: TitleSelectMoleculeProps) {
  const generatedId = useId();
  const fieldId = id ?? `title-select-${generatedId.replace(/:/g, "")}`;
  const helperElementId = helperText ? helperTextId ?? `${fieldId}-helper-text` : undefined;

  return (
    <div
      className={cn("flex flex-col gap-2", containerClassName)}
      data-component={dataComponent}
    >
      <div className={cn("flex items-center justify-between gap-2", labelRowClassName)}>
        <Label htmlFor={fieldId} className={labelClassName}>
          {label}
          {required && <span className="ml-1 text-destructive">*</span>}
        </Label>
      </div>
      <Select
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        required={required}
      >
        <SelectTrigger
          id={fieldId}
          className={cn("w-full", triggerClassName)}
          data-component={triggerDataComponent}
          aria-describedby={helperElementId}
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent
          className={contentClassName}
          data-component={contentDataComponent}
        >
          {options.map((option) => (
            <SelectItem
              key={option.value}
              value={option.value}
              disabled={option.disabled}
              className={itemClassName}
              data-component={optionDataComponent}
            >
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {helperText ? (
        <p
          id={helperElementId}
          className={cn("text-xs text-destructive", helperTextClassName)}
        >
          {helperText}
        </p>
      ) : null}
    </div>
  );
}
